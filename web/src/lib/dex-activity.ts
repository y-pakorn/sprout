// Live Sui DEX-activity feed — data layer. Pure (no React).
//
// Source: Suiscan's DEX-activity firehose, relayed (and signed) by our server
// proxy at /api/dex-activity. We only request swaps ({ actions: ["SWAP"] }).
// See app/api/dex-activity/route.ts for the upstream contract + signing.

/** A coin leg of a swap (amounts arrive pre-decimalized as decimal strings). */
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

/** One leg of a normalized swap. */
export type SwapLeg = {
  symbol: string;
  amount: number;
  iconUrl?: string;
  coinType: string;
};

/** A normalized DEX swap — the "dex" arm of the feed's FeedItem union. */
export type DexSwapEvent = {
  source: "dex";
  /** Stable dedupe key. */
  id: string;
  /** Tx sender (the trader). */
  sender: string;
  /** SuiNS name of the sender, if any. */
  senderName: string | null;
  /** Coin sold (coinSeq 0). */
  soldLeg: SwapLeg;
  /** Coin bought (coinSeq 1). */
  boughtLeg: SwapLeg;
  /** DEX/protocol the swap routed through. */
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

/** Maps one raw activity row to a DexSwapEvent (or null if not a clean swap). */
function normalizeSwap(row: RawDexActivity): DexSwapEvent | null {
  if (!row.txHash) return null;
  const coins = [...row.coins].sort((a, b) => a.coinSeq - b.coinSeq);
  if (coins.length < 2) return null;
  const sold = toLeg(coins[0]); // coinSeq 0 = input (verified via RPC balance changes)
  const bought = toLeg(coins[1]); // coinSeq 1 = output

  return {
    source: "dex",
    id: `${row.txHash}:${sold.coinType}:${bought.coinType}`,
    sender: row.sender,
    senderName: row.senderName,
    soldLeg: sold,
    boughtLeg: bought,
    projectName: row.projectName,
    projectImg: row.projectImg,
    timestampMs: Number.isFinite(row.timestamp) ? row.timestamp : 0,
    digest: row.txHash,
  };
}

/** Fetches one page of swaps from the proxy, normalized newest-first. */
export async function fetchDexActivity(opts: {
  page: number;
  size: number;
  signal?: AbortSignal;
}): Promise<{ events: DexSwapEvent[]; totalPages: number }> {
  const res = await fetch(
    `/api/dex-activity?page=${opts.page}&size=${opts.size}`,
    { signal: opts.signal },
  );
  if (!res.ok) throw new Error(`dex activity failed: ${res.status}`);
  const body = (await res.json()) as DexActivityResponse & { error?: string };
  if (body.error) throw new Error(body.error);
  const events: DexSwapEvent[] = [];
  for (const row of body.content ?? []) {
    const ev = normalizeSwap(row);
    if (ev) events.push(ev);
  }
  return { events, totalPages: body.totalPages ?? 0 };
}
