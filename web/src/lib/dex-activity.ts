// Live Sui DEX-activity feed — data layer. Pure (no React).
//
// Source: Suiscan's DEX-activity firehose, relayed (and signed) by our server
// proxy at /api/dex-activity. Supports swaps + liquidity (SWAP / ADD_LIQUIDITY
// / REMOVE_LIQUIDITY). See app/api/dex-activity/route.ts for the signing.

/** A coin leg (amounts arrive pre-decimalized; liquidity amounts are signed). */
type RawDexCoin = {
  amount: number;
  coinType: string;
  iconUrl: string | null;
  symbol: string | null;
  coinSeq: number;
};

type RawDexActivity = {
  sender: string;
  senderName: string | null;
  senderImg: string | null;
  activity: string;
  txHash: string;
  timestamp: number; // ms
  projectName: string | null;
  projectImg: string | null;
  coins: RawDexCoin[];
};

type DexActivityResponse = {
  content: RawDexActivity[];
  totalPages: number;
  totalCount: number;
};

/** One coin leg of a DEX event. */
export type SwapLeg = {
  symbol: string;
  amount: number;
  iconUrl?: string;
  coinType: string;
};

export type DexKind = "swap" | "add_liquidity" | "remove_liquidity";

/** A normalized DEX event — the "dex" arm of the feed's FeedItem union. */
export type DexEvent = {
  source: "dex";
  /** Stable dedupe key. */
  id: string;
  /** Tx sender (the trader / LP). */
  sender: string;
  /** SuiNS name of the sender, if any. */
  senderName: string | null;
  kind: DexKind;
  /** Coins involved. Swap = [sold, bought]. Liquidity = the tokens added
   *  (positive) or removed (negative). Zero-amount legs are dropped. */
  coins: SwapLeg[];
  /** DEX/protocol the event routed through. */
  projectName: string | null;
  projectImg: string | null;
  timestampMs: number;
  digest: string;
};

function tickerOf(coin: RawDexCoin): string {
  if (coin.symbol) return coin.symbol;
  const tail = coin.coinType.split("::").pop();
  return tail || "?";
}

function toLeg(coin: RawDexCoin): SwapLeg {
  return {
    symbol: tickerOf(coin),
    amount: Number.isFinite(coin.amount) ? coin.amount : 0,
    iconUrl: coin.iconUrl ?? undefined,
    coinType: coin.coinType,
  };
}

function kindOf(activity: string): DexKind {
  const a = (activity ?? "").toLowerCase();
  if (a.includes("add")) return "add_liquidity";
  if (a.includes("remove")) return "remove_liquidity";
  return "swap";
}

/** Maps one raw activity row to a DexEvent (or null if unusable). */
function normalizeDex(row: RawDexActivity): DexEvent | null {
  if (!row.txHash) return null;
  const kind = kindOf(row.activity);
  const coins = [...(row.coins ?? [])]
    .sort((a, b) => a.coinSeq - b.coinSeq)
    .map(toLeg)
    .filter((c) => c.amount !== 0); // drop single-sided zero legs
  if (coins.length === 0) return null;
  // A swap needs both sides (coinSeq 0 = sold, 1 = bought).
  if (kind === "swap" && coins.length < 2) return null;

  return {
    source: "dex",
    id: `${row.txHash}:${kind}:${coins.map((c) => c.coinType).join("|")}`,
    sender: row.sender,
    senderName: row.senderName,
    kind,
    coins,
    projectName: row.projectName,
    projectImg: row.projectImg,
    timestampMs: Number.isFinite(row.timestamp) ? row.timestamp : 0,
    digest: row.txHash,
  };
}

/** Fetches one page of DEX activity from the proxy, normalized newest-first. */
export async function fetchDexActivity(opts: {
  page: number;
  size: number;
  /** Which actions to include. Default ["SWAP"]. */
  actions?: string[];
  signal?: AbortSignal;
}): Promise<{ events: DexEvent[]; totalPages: number }> {
  const actions = (opts.actions ?? ["SWAP"]).join(",");
  const res = await fetch(
    `/api/dex-activity?page=${opts.page}&size=${opts.size}&actions=${actions}`,
    { signal: opts.signal },
  );
  if (!res.ok) throw new Error(`dex activity failed: ${res.status}`);
  const body = (await res.json()) as DexActivityResponse & { error?: string };
  if (body.error) throw new Error(body.error);
  const events: DexEvent[] = [];
  for (const row of body.content ?? []) {
    const ev = normalizeDex(row);
    if (ev) events.push(ev);
  }
  return { events, totalPages: body.totalPages ?? 0 };
}
