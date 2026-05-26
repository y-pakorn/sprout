// Account transaction-history types + normalizer for Blockberry's
// getAccountActivity endpoint. Pure (no React, no secrets) — shared by the
// proxy route (app/api/tx-history) and the TxHistoryCard renderer.

/** A single coin movement in an activity. `amount` is SIGNED: negative = out,
 *  positive = in (verified against live data). */
export type TxCoin = {
  symbol: string;
  amount: number;
  iconUrl?: string;
};

export type TxKind = "swap" | "send" | "receive" | "stake" | "other";

/** One normalized activity row. */
export type TxActivity = {
  digest: string;
  timestampMs: number;
  /** "SUCCESS" | "FAILURE" | … (upstream txStatus). */
  status: string;
  /** Human label — the upstream activityType(s) joined, e.g. "Swap". */
  activity: string;
  kind: TxKind;
  coins: TxCoin[];
  /** Primary counterparty / protocol the tx interacted with, if identifiable. */
  protocol?: { name?: string; img?: string };
  gasFee: number;
};

export type TxHistoryResult = {
  address: string;
  count: number;
  hasNextPage: boolean;
  items: TxActivity[];
  error?: string;
};

// ---- raw upstream shapes (subset we use) -----------------------------------

type RawCoin = {
  amount: number;
  coinType: string;
  iconUrl: string | null;
  symbol: string | null;
  coinSeq: number;
};

type RawCounterparty = {
  objectType: string | null;
  id: string | null;
  name: string | null;
  imgUrl: string | null;
  projectName: string | null;
  projectImg: string | null;
};

export type RawActivity = {
  activityType: string[] | null;
  details: { type?: string; detailsDto?: { coins?: RawCoin[] } } | null;
  activityWith: RawCounterparty[] | null;
  timestamp: number;
  digest: string;
  txStatus: string;
  gasFee: number;
};

export type RawActivityResponse = {
  content: RawActivity[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

// ---- normalization ---------------------------------------------------------

function kindOf(types: string[]): TxKind {
  const t = (types[0] ?? "").toLowerCase();
  if (t.includes("swap")) return "swap";
  if (t.includes("send")) return "send";
  if (t.includes("receive")) return "receive";
  if (t.includes("stake")) return "stake"; // covers Stake / Unstake
  return "other";
}

function tickerOf(coin: RawCoin): string {
  if (coin.symbol) return coin.symbol;
  const tail = coin.coinType?.split("::").pop();
  return tail || "?";
}

/** Pick the most informative counterparty (a named protocol if any). */
function protocolOf(
  withList: RawCounterparty[],
): TxActivity["protocol"] | undefined {
  const named =
    withList.find((w) => w.projectName && w.projectImg) ??
    withList.find((w) => w.projectName) ??
    withList.find((w) => w.name);
  if (!named) return undefined;
  return {
    name: named.projectName ?? named.name ?? undefined,
    img: named.projectImg ?? named.imgUrl ?? undefined,
  };
}

export function normalizeActivity(raw: RawActivity): TxActivity {
  const types = raw.activityType ?? [];
  const rawCoins = raw.details?.detailsDto?.coins ?? [];
  const coins: TxCoin[] = [...rawCoins]
    .sort((a, b) => a.coinSeq - b.coinSeq)
    .map((c) => ({
      symbol: tickerOf(c),
      amount: Number.isFinite(c.amount) ? c.amount : 0,
      iconUrl: c.iconUrl ?? undefined,
    }));

  return {
    digest: raw.digest,
    timestampMs: Number.isFinite(raw.timestamp) ? raw.timestamp : 0,
    status: raw.txStatus ?? "",
    activity: types.length ? types.join(" / ") : "Activity",
    kind: kindOf(types),
    coins,
    protocol: protocolOf(raw.activityWith ?? []),
    gasFee: Number.isFinite(raw.gasFee) ? raw.gasFee : 0,
  };
}
