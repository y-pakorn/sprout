// Live on-chain event feed — data layer. Pure (no React).
//
// Queries the Sui GraphQL API for vault events. CORS is open on this endpoint
// (Access-Control-Allow-Origin: *, verified), so we call it directly from the
// browser — no proxy route needed.
//
// EXTENSIBILITY: to add a new event type to the feed, add one entry to
// EVENT_DEFS. The query, parsing, polling and pagination all derive from it.

import {
  canonicalCoinType,
  type ClientCoin,
  type CoinMap,
} from "@/lib/client-coins";

export const SUI_GRAPHQL_URL = "https://graphql.mainnet.sui.io/graphql";

const VAULT_PKG =
  "0xc83d5406fd355f34d3ce87b35ab2c0b099af9d309ba96c17e40309502a49976f";

export type FeedEventKind = "deposit" | "redeem";

export type EventDef = {
  /** Alias used as the GraphQL field name + variable suffix. [a-z]+ only. */
  key: string;
  /** Fully-qualified move type to filter on (no generic params). */
  typeStr: string;
  kind: FeedEventKind;
  /** Human verb shown on the card. */
  label: string;
  /** StatusDisk / Tag tone. */
  tone: "green" | "gold";
};

export const EVENT_DEFS: EventDef[] = [
  {
    key: "deposit",
    typeStr: `${VAULT_PKG}::events::VaultDepositEvent`,
    kind: "deposit",
    label: "deposited",
    tone: "green",
  },
  {
    key: "redeem",
    typeStr: `${VAULT_PKG}::events::RequestRedeemedEvent`,
    kind: "redeem",
    label: "requested redeem",
    tone: "gold",
  },
];

/** Per-event-type cursor map keyed by EventDef.key. */
export type CursorMap = Record<string, string | null>;

/** A normalized, render-ready feed item. */
export type FeedEvent = {
  /** Stable dedupe key. */
  id: string;
  kind: FeedEventKind;
  label: string;
  tone: "green" | "gold";
  /** Tx sender address. */
  sender: string;
  /** SuiNS name of the sender, if any. */
  senderName: string | null;
  /** json.owner — the depositor / redeemer. */
  owner: string;
  /** Underlying coin type parsed from the event's generic param. */
  coinType: string;
  symbol: string;
  iconUrl?: string;
  /** Deposit amount in human units (deposit events only). */
  amountHuman?: number;
  /** Shares in human units (redeem events only). */
  sharesHuman?: number;
  /** json.vault_id. */
  vaultId: string;
  timestampMs: number;
  digest: string;
};

// ---- raw GraphQL shapes ----------------------------------------------------

type RawEventNode = {
  sender: {
    address: string;
    defaultNameRecord: { domain: string } | null;
  } | null;
  contents: {
    json: Record<string, string>;
    type: { repr: string };
  };
  timestamp: string;
  transaction: { digest: string } | null;
};

type RawConnection = {
  nodes: RawEventNode[];
  pageInfo: { startCursor: string | null; hasPreviousPage: boolean };
};

export type FeedConnection = {
  nodes: RawEventNode[];
  startCursor: string | null;
  hasPreviousPage: boolean;
};

export type FeedPage = Record<string, FeedConnection>;

// ---- query -----------------------------------------------------------------

/** Builds one aliased `events()` field per def, each with its own cursor. */
export function buildFeedQuery(defs: EventDef[]): string {
  const varDecls = defs
    .map((d) => `$last_${d.key}: Int, $before_${d.key}: String`)
    .join(", ");
  const fields = defs
    .map(
      (d) => `  ${d.key}: events(
    filter: { type: ${JSON.stringify(d.typeStr)} }
    last: $last_${d.key}
    before: $before_${d.key}
  ) {
    nodes {
      sender { address defaultNameRecord { domain } }
      contents { json type { repr } }
      timestamp
      transaction { digest }
    }
    pageInfo { startCursor hasPreviousPage }
  }`
    )
    .join("\n");
  return `query Feed(${varDecls}) {\n${fields}\n}`;
}

/**
 * Fetches one page for every event def in a single request.
 * `before` maps def.key → cursor (null for the newest page).
 */
export async function fetchFeedPage(opts: {
  before: CursorMap;
  limit: number;
  defs?: EventDef[];
  signal?: AbortSignal;
}): Promise<FeedPage> {
  const defs = opts.defs ?? EVENT_DEFS;
  const variables: Record<string, number | string | null> = {};
  for (const d of defs) {
    variables[`last_${d.key}`] = opts.limit;
    variables[`before_${d.key}`] = opts.before[d.key] ?? null;
  }
  const res = await fetch(SUI_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildFeedQuery(defs), variables }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`events query failed: ${res.status}`);
  const body = (await res.json()) as {
    data?: Record<string, RawConnection>;
    errors?: { message: string }[];
  };
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  if (!body.data) throw new Error("events query returned no data");
  const page: FeedPage = {};
  for (const d of defs) {
    const conn = body.data[d.key];
    page[d.key] = {
      nodes: conn?.nodes ?? [],
      startCursor: conn?.pageInfo?.startCursor ?? null,
      hasPreviousPage: conn?.pageInfo?.hasPreviousPage ?? false,
    };
  }
  return page;
}

// ---- normalization ---------------------------------------------------------

/** coinType (canonical) → ClientCoin, for resolving symbol/decimals/icon. */
export type CoinIndex = Map<string, ClientCoin>;

export function buildCoinIndex(coinMap: CoinMap | null): CoinIndex {
  const idx: CoinIndex = new Map();
  if (!coinMap) return idx;
  for (const coin of Object.values(coinMap)) {
    idx.set(canonicalCoinType(coin.coin_type), coin);
  }
  return idx;
}

/** Extracts the first generic param from a move type repr, or "". */
function parseGeneric(repr: string): string {
  const lt = repr.indexOf("<");
  const gt = repr.lastIndexOf(">");
  if (lt === -1 || gt === -1 || gt <= lt) return "";
  return repr.slice(lt + 1, gt).trim();
}

function toHuman(raw: string | undefined, decimals: number): number | undefined {
  if (!raw) return undefined;
  try {
    return Number(BigInt(raw)) / 10 ** decimals;
  } catch {
    const n = Number(raw);
    return Number.isFinite(n) ? n / 10 ** decimals : undefined;
  }
}

/** Maps a raw GraphQL node to a render-ready FeedEvent. */
export function normalizeEvent(
  node: RawEventNode,
  def: EventDef,
  coinIndex: CoinIndex
): FeedEvent | null {
  const json = node.contents?.json ?? {};
  const digest = node.transaction?.digest ?? "";
  const seq = json.sequence_number ?? "";
  // Skip anything we can't key stably — guards against malformed nodes.
  if (!digest && !seq) return null;

  const coinType = parseGeneric(node.contents?.type?.repr ?? "");
  const canon = coinType ? canonicalCoinType(coinType) : "";
  const coin = canon ? coinIndex.get(canon) : undefined;
  const decimals = coin?.decimals ?? 9;
  const symbol =
    coin?.name ?? (coinType ? coinType.split("::").pop() ?? "?" : "?");

  const timestampMs = new Date(node.timestamp).getTime();

  return {
    id: `${digest}:${def.kind}:${seq}`,
    kind: def.kind,
    label: def.label,
    tone: def.tone,
    sender: node.sender?.address ?? json.owner ?? "",
    senderName: node.sender?.defaultNameRecord?.domain ?? null,
    owner: json.owner ?? node.sender?.address ?? "",
    coinType: canon,
    symbol,
    iconUrl: coin?.icon_url,
    amountHuman:
      def.kind === "deposit" ? toHuman(json.total_amount, decimals) : undefined,
    sharesHuman:
      def.kind === "redeem" ? toHuman(json.shares, decimals) : undefined,
    vaultId: json.vault_id ?? "",
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
    digest,
  };
}

/** Newest-first comparator. The server returns ascending — always re-sort. */
export function byNewest(a: FeedEvent, b: FeedEvent): number {
  return b.timestampMs - a.timestampMs;
}
