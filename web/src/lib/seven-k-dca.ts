"use client";

import { placeDcaOrder, cancelDcaOrder } from "@7kprotocol/sdk-ts";
import type { Transaction } from "@mysten/sui/transactions";

/**
 * 7K DCA (dollar-cost averaging) helpers. The SDK's `placeDcaOrder` /
 * `cancelDcaOrder` each build and return their OWN `Transaction` (they do not
 * compose into a shared PTB the way `MetaAg.swap` does), so DCA is a
 * standalone action — wired like `sendStablecoin`, not `executePlan`.
 *
 * `placeDcaOrder` locks the FULL `payCoinAmountEach × numOrders` up front into
 * the order escrow (it splits the pay token into `numOrders` portions via
 * coinWithBalance + makeMoveVec and hands them to `dca_order::place_dca_order`).
 */

/** u64 max — the "no upper bound" maxRate for an unbounded (pure time-based)
 *  DCA order (and the sentinel an open order carries when it has no price floor). */
export const U64_MAX = BigInt("18446744073709551615");

/** 7K's universal rate scale: ×10^12 (see `dcaRateBounds`). */
const RATE_SCALE = 1_000_000_000_000;

/** Default per-execution slippage for a DCA leg (percent). */
export const DEFAULT_DCA_SLIPPAGE_PCT = 1;

export type IntervalUnit = "minute" | "hour" | "day" | "week";

const UNIT_MS: Record<IntervalUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

/** Schedule interval in milliseconds (7K's `interval` unit). */
export function intervalMs(unit: IntervalUnit, count = 1): number {
  return UNIT_MS[unit] * Math.max(1, Math.round(count));
}

/** Human label for an interval in ms ("1 day", "6 hours", "1 week"). */
export function fmtInterval(ms: number): string {
  const units: [IntervalUnit, number][] = [
    ["week", UNIT_MS.week],
    ["day", UNIT_MS.day],
    ["hour", UNIT_MS.hour],
    ["minute", UNIT_MS.minute],
  ];
  for (const [unit, size] of units) {
    if (ms >= size && ms % size === 0) {
      const n = ms / size;
      return `${n} ${unit}${n === 1 ? "" : "s"}`;
    }
  }
  const mins = Math.max(1, Math.round(ms / 60_000));
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

/** Slippage (percent) → 7K's ×10^4 bigint (1% → 100n). */
export function slippageToScaled(pct: number): bigint {
  return BigInt(Math.max(0, Math.round(pct * 100)));
}

/** 7K's ×10^4 slippage → percent. */
export function slippageFromScaled(scaled: number | string): number {
  return Number(scaled) / 100;
}

/**
 * Convert a human exchange rate (TARGET received per 1 PAY) into 7K's
 * decimal-adjusted, 10^12-scaled u64 `rate`:
 *
 *   rate = targetPerPay × 10^(targetDecimals − payDecimals) × 10^12
 *
 * Worked example from the 7K docs: 1 USDC = 0.25 SUI (pay USDC dec 6, target
 * SUI dec 9) → 0.25 × 10^3 × 10^12 = 250000000000000.
 */
export function rateFromTargetPerPay(
  targetPerPay: number,
  payDecimals: number,
  targetDecimals: number,
): bigint {
  if (!Number.isFinite(targetPerPay) || targetPerPay <= 0) return BigInt(0);
  const scaled =
    targetPerPay * 10 ** (targetDecimals - payDecimals) * RATE_SCALE;
  if (!Number.isFinite(scaled) || scaled <= 0) return BigInt(0);
  const v = BigInt(Math.floor(scaled));
  return v > U64_MAX ? U64_MAX : v;
}

/** Inverse of {@link rateFromTargetPerPay}: scaled `rate` → human target-per-pay. */
export function targetPerPayFromRate(
  rate: number | string | bigint,
  payDecimals: number,
  targetDecimals: number,
): number {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return r / RATE_SCALE / 10 ** (targetDecimals - payDecimals);
}

/**
 * Price guards → 7K `minRate` / `maxRate`.
 *
 * Prices are expressed as PAY units per 1 TARGET (e.g. "USDC per SUI"; for a
 * stablecoin pay token this ≈ the target's USD price). Since `rate` is
 * target-per-pay (the inverse of price):
 *   - `maxPrice` ("don't pay more than X per target") → a FLOOR on target-per-pay → `minRate`.
 *   - `minPrice` ("don't buy below Y per target")     → a CEILING on target-per-pay → `maxRate`.
 *   - neither → minRate 0, maxRate U64_MAX (pure time-based DCA).
 */
export function dcaRateBounds(args: {
  payDecimals: number;
  targetDecimals: number;
  maxPrice?: number;
  minPrice?: number;
}): { minRate: bigint; maxRate: bigint } {
  const { payDecimals, targetDecimals, maxPrice, minPrice } = args;
  let minRate = BigInt(0);
  let maxRate = U64_MAX;
  if (maxPrice != null && maxPrice > 0) {
    minRate = rateFromTargetPerPay(1 / maxPrice, payDecimals, targetDecimals);
  }
  if (minPrice != null && minPrice > 0) {
    maxRate = rateFromTargetPerPay(1 / minPrice, payDecimals, targetDecimals);
  }
  return { minRate, maxRate };
}

/**
 * Decode an order's scaled `minRate`/`maxRate` back to the human price band
 * (PAY units per 1 TARGET). minRate → maxPrice, maxRate → minPrice. The
 * U64_MAX sentinel (and 0) decode to "unbounded" (undefined).
 */
export function dcaPriceBand(args: {
  minRate: number | string;
  maxRate: number | string;
  payDecimals: number;
  targetDecimals: number;
}): { minPrice?: number; maxPrice?: number } {
  const { minRate, maxRate, payDecimals, targetDecimals } = args;
  const out: { minPrice?: number; maxPrice?: number } = {};
  const minR = Number(minRate);
  const maxR = Number(maxRate);
  if (minR > 0) {
    const tpp = targetPerPayFromRate(minR, payDecimals, targetDecimals);
    if (tpp > 0) out.maxPrice = 1 / tpp;
  }
  // A maxRate at/above the u64 sentinel means "no floor" → leave minPrice unset.
  if (maxR > 0 && maxR < Number(U64_MAX)) {
    const tpp = targetPerPayFromRate(maxR, payDecimals, targetDecimals);
    if (tpp > 0) out.minPrice = 1 / tpp;
  }
  return out;
}

/** Build a `place_dca_order` PTB. The full `payCoinAmountEach × numOrders` is
 *  drawn from the wallet and escrowed when the user signs. */
export async function buildPlaceDcaTx(args: {
  payCoinType: string;
  targetCoinType: string;
  payCoinAmountEach: bigint;
  numOrders: number;
  interval: number;
  slippagePct: number;
  minRate: bigint;
  maxRate: bigint;
}): Promise<Transaction> {
  const tx = await placeDcaOrder({
    payCoinType: args.payCoinType,
    targetCoinType: args.targetCoinType,
    payCoinAmountEach: args.payCoinAmountEach,
    numOrders: args.numOrders,
    interval: args.interval,
    slippage: slippageToScaled(args.slippagePct),
    minRate: args.minRate,
    maxRate: args.maxRate,
  });
  return tx as unknown as Transaction;
}

/** Build a `cancel_dca_order` PTB — returns the unspent remainder to the owner. */
export async function buildCancelDcaTx(args: {
  orderId: string;
  payCoinType: string;
  targetCoinType: string;
}): Promise<Transaction> {
  const tx = await cancelDcaOrder(args);
  return tx as unknown as Transaction;
}
