import type { CoinMap } from "@/lib/client-coins";
import { resolveSymbol, canonicalCoinType } from "@/lib/client-coins";
import { dcaPriceBand, slippageFromScaled } from "@/lib/seven-k-dca";

/**
 * DCA order shapes from `lod-dca.7k.ag` + the humanized views the cards render.
 *
 * Amounts arrive as raw integer strings; `payCoinName` / `targetCoinName` are
 * resolved through the coin map (handling BOTH a full coin type and a plain
 * symbol, since the upstream field form isn't contractually guaranteed).
 */

/** Raw open/active order (subset of the upstream `DcaOrder` we consume). */
export type RawDcaOrder = {
  orderId: string;
  owner?: string;
  payCoinName: string;
  targetCoinName: string;
  totalPayAmount: string;
  paidAmount: string;
  obtainedAmount: string;
  claimedAmount?: string;
  amountPerOrder: string;
  numOrders: number;
  filled: number;
  /** Interval between executions, in milliseconds. */
  interval: number;
  createdTs: number;
  expireTs?: number;
  lastExecutedTs?: number;
  status: string;
  slippage: number | string;
  minRate: string;
  maxRate: string;
  digest?: string | null;
};

/** Raw execution row (one filled leg). */
export type RawDcaExecution = {
  orderId: string;
  digest: string;
  payCoinName: string;
  targetCoinName: string;
  payAmount: string;
  obtainedAmount: string;
  executedTs: number;
  status: string;
};

export type DcaOrderView = {
  orderId: string;
  payCoinType: string;
  paySymbol: string;
  payDecimals: number;
  payIcon?: string;
  targetCoinType: string;
  targetSymbol: string;
  targetDecimals: number;
  targetIcon?: string;
  amountPerOrderHuman: number;
  numOrders: number;
  filled: number;
  /** 0..100 — share of the schedule executed. */
  progressPct: number;
  intervalMs: number;
  totalPayHuman: number;
  paidHuman: number;
  obtainedHuman: number;
  /** Unspent pay still escrowed — reclaimed on cancel. */
  remainingHuman: number;
  slippagePct: number;
  status: string;
  isActive: boolean;
  createdTs: number;
  expireTs?: number;
  lastExecutedTs?: number;
  /** Estimated next execution time (ms). */
  nextExecTs?: number;
  /** Price band (PAY units per 1 TARGET), decoded from min/maxRate. */
  minPrice?: number;
  maxPrice?: number;
};

export type DcaOrderExecutionView = {
  orderId: string;
  digest: string;
  paySymbol: string;
  payCoinType: string;
  payIcon?: string;
  targetSymbol: string;
  targetCoinType: string;
  targetIcon?: string;
  payHuman: number;
  obtainedHuman: number;
  executedTs: number;
  status: string;
};

type ResolvedCoin = {
  coinType: string;
  symbol: string;
  decimals: number;
  icon?: string;
};

/** Build a coin_type → ClientCoin index once per enrich pass (the map is
 *  keyed by symbol; DCA coin names may arrive as full coin types). */
function buildTypeIndex(map: CoinMap) {
  const byType = new Map<string, { symbol: string; decimals: number; icon?: string }>();
  for (const [symbol, c] of Object.entries(map)) {
    byType.set(canonicalCoinType(c.coin_type), {
      symbol,
      decimals: c.decimals,
      icon: c.icon_url,
    });
  }
  return byType;
}

/** Resolve a `payCoinName` / `targetCoinName` (coin type OR symbol). */
function resolveCoin(
  name: string,
  map: CoinMap,
  byType: ReturnType<typeof buildTypeIndex>,
): ResolvedCoin {
  if (name.includes("::")) {
    const coinType = canonicalCoinType(name);
    const hit = byType.get(coinType);
    if (hit) {
      return { coinType, symbol: hit.symbol, decimals: hit.decimals, icon: hit.icon };
    }
    // Unknown token — fall back to the type's TYPE segment as the symbol.
    const seg = name.split("::");
    return { coinType, symbol: seg[seg.length - 1] || "?", decimals: 9 };
  }
  const c = resolveSymbol(map, name);
  if (c) {
    return {
      coinType: canonicalCoinType(c.coin_type),
      symbol: name.toUpperCase(),
      decimals: c.decimals,
      icon: c.icon_url,
    };
  }
  return { coinType: name, symbol: name.toUpperCase(), decimals: 9 };
}

const human = (raw: string | number, decimals: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** decimals;
};

export function enrichDcaOrders(
  raw: RawDcaOrder[],
  map: CoinMap,
): DcaOrderView[] {
  const byType = buildTypeIndex(map);
  return raw.map((o): DcaOrderView => {
    const pay = resolveCoin(o.payCoinName, map, byType);
    const target = resolveCoin(o.targetCoinName, map, byType);
    const totalPayHuman = human(o.totalPayAmount, pay.decimals);
    const paidHuman = human(o.paidAmount, pay.decimals);
    const numOrders = Number(o.numOrders) || 0;
    const filled = Number(o.filled) || 0;
    const band = dcaPriceBand({
      minRate: o.minRate,
      maxRate: o.maxRate,
      payDecimals: pay.decimals,
      targetDecimals: target.decimals,
    });
    const lastTs = o.lastExecutedTs && o.lastExecutedTs > 0 ? o.lastExecutedTs : o.createdTs;
    return {
      orderId: o.orderId,
      payCoinType: pay.coinType,
      paySymbol: pay.symbol,
      payDecimals: pay.decimals,
      payIcon: pay.icon,
      targetCoinType: target.coinType,
      targetSymbol: target.symbol,
      targetDecimals: target.decimals,
      targetIcon: target.icon,
      amountPerOrderHuman: human(o.amountPerOrder, pay.decimals),
      numOrders,
      filled,
      progressPct: numOrders > 0 ? Math.min(100, (filled / numOrders) * 100) : 0,
      intervalMs: Number(o.interval) || 0,
      totalPayHuman,
      paidHuman,
      obtainedHuman: human(o.obtainedAmount, target.decimals),
      remainingHuman: Math.max(0, totalPayHuman - paidHuman),
      slippagePct: slippageFromScaled(o.slippage),
      status: o.status,
      isActive: /active/i.test(o.status),
      createdTs: o.createdTs,
      expireTs: o.expireTs,
      lastExecutedTs: o.lastExecutedTs,
      nextExecTs: o.interval ? lastTs + Number(o.interval) : undefined,
      minPrice: band.minPrice,
      maxPrice: band.maxPrice,
    };
  });
}

export function enrichDcaExecutions(
  raw: RawDcaExecution[],
  map: CoinMap,
): DcaOrderExecutionView[] {
  const byType = buildTypeIndex(map);
  return raw.map((e): DcaOrderExecutionView => {
    const pay = resolveCoin(e.payCoinName, map, byType);
    const target = resolveCoin(e.targetCoinName, map, byType);
    return {
      orderId: e.orderId,
      digest: e.digest,
      paySymbol: pay.symbol,
      payCoinType: pay.coinType,
      payIcon: pay.icon,
      targetSymbol: target.symbol,
      targetCoinType: target.coinType,
      targetIcon: target.icon,
      payHuman: human(e.payAmount, pay.decimals),
      obtainedHuman: human(e.obtainedAmount, target.decimals),
      executedTs: e.executedTs,
      status: e.status,
    };
  });
}
