"use client";

import {
  getQuote,
  buildTx,
  estimateGasFee,
  getTokenPrices,
  type QuoteResponse,
} from "@bluefin-exchange/bluefin7k-aggregator-sdk";

/**
 * Partner address that receives commission for swaps. Placeholder zero
 * address — replace with your Sui address before production.
 */
export const PARTNER_ADDRESS =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
export const PARTNER_COMMISSION_BPS = 0;

/** Default slippage tolerance, expressed as fractional (0.003 = 0.3%). */
export const DEFAULT_SLIPPAGE_PCT = 0.003;

// The SDK can be used for quote + buildTx without a Sui client. Broadcast is
// handled by the connected wallet via @mysten/dapp-kit's
// useSignAndExecuteTransaction hook, so we never call Config.setSuiClient.

export { getQuote, buildTx, estimateGasFee };
export type { QuoteResponse };

export type RouteSummary = {
  /** Distinct DEX names in the path, in order */
  dexes: string[];
  /** Total hop count of the longest route */
  hopCount: number;
};

/**
 * Pulls DEX names + hop count from a QuoteResponse. Falls back to swaps
 * array (functionName parsing) when the routes array is absent.
 */
export function extractRoute(quote: QuoteResponse): RouteSummary {
  const dexSet: string[] = [];
  let hopCount = 0;

  if (quote.routes && quote.routes.length > 0) {
    for (const route of quote.routes) {
      hopCount = Math.max(hopCount, route.hops.length);
      for (const hop of route.hops) {
        const t = hop.pool?.type;
        if (t && !dexSet.includes(t)) dexSet.push(t);
      }
    }
  } else if (quote.swaps && quote.swaps.length > 0) {
    hopCount = quote.swaps.length;
    for (const s of quote.swaps) {
      // functionName looks like "0xpkg::module::func"; pull a hint
      const parts = (s.functionName || "").split("::");
      const hint = parts[1] || "dex";
      if (!dexSet.includes(hint)) dexSet.push(hint);
    }
  }

  return { dexes: dexSet, hopCount: Math.max(hopCount, 1) };
}

/**
 * Compute price impact percent from the actual swap rate vs the spot rate
 * implied by Bluefin's oracle USD prices (getTokenPrices).
 *
 *   idealRate  = priceIn / priceOut           (toUnits per fromUnit at oracle)
 *   actualRate = returnAmount / swapAmount    (toUnits per fromUnit from quote)
 *   impact     = (1 - actualRate / idealRate) * 100
 */
export function computePriceImpactPct(
  quote: QuoteResponse,
  priceIn: number,
  priceOut: number,
  fromDecimals: number,
  toDecimals: number
): number {
  const inAmt = Number(quote.swapAmountWithDecimal) / 10 ** fromDecimals;
  const outAmt = Number(quote.returnAmountWithDecimal) / 10 ** toDecimals;
  if (!Number.isFinite(inAmt) || !Number.isFinite(outAmt) || inAmt <= 0)
    return 0;
  if (!Number.isFinite(priceIn) || !Number.isFinite(priceOut)) return 0;
  if (priceIn <= 0 || priceOut <= 0) return 0;
  const idealRate = priceIn / priceOut;
  const actualRate = outAmt / inAmt;
  const impact = (1 - actualRate / idealRate) * 100;
  return Math.max(0, Math.min(100, impact));
}

export { getTokenPrices };

/** Friendly DEX label */
export function dexLabel(slug: string): string {
  const map: Record<string, string> = {
    cetus: "Cetus",
    cetus_dlmm: "Cetus DLMM",
    aftermath: "Aftermath",
    kriya: "Kriya",
    kriya_v3: "Kriya v3",
    flowx: "FlowX",
    flowx_v3: "FlowX v3",
    bluefin: "Bluefin",
    bluefinx: "BluefinX",
    deepbook_v3: "DeepBook v3",
    turbos: "Turbos",
    suiswap: "Suiswap",
    bluemove: "BlueMove",
    obric: "Obric",
    momentum: "Momentum",
    magma: "Magma",
    haedal_pmm: "Haedal PMM",
    springsui: "SpringSui",
    stsui: "stSUI",
    steamm: "Steamm",
    sevenk_v1: "7K v1",
    fullsail: "Fullsail",
    ferra_dlmm: "Ferra DLMM",
    ferra_clmm: "Ferra CLMM",
    RFQ: "RFQ",
  };
  return map[slug] ?? slug;
}
