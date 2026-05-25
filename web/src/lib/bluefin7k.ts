"use client";

import {
  getQuote,
  buildTx,
  estimateGasFee,
  type QuoteResponse,
} from "@bluefin-exchange/bluefin7k-aggregator-sdk";

/**
 * Canonicalize a Sui coin type — pad the address to 64 hex chars and
 * lowercase. Bluefin's price oracle only matches canonical types
 * (`0x2::sui::SUI` short form returns empty), so we normalize before
 * querying AND when reading the response back. Inlined here (rather than
 * importing from client-coins) to keep this lib import-light.
 */
function canonicalize(coinType: string): string {
  const segments = coinType.split("::");
  const addr = segments[0];
  if (!addr || !addr.startsWith("0x")) return coinType;
  segments[0] = `0x${addr.slice(2).padStart(64, "0").toLowerCase()}`;
  return segments.join("::");
}

type BluefinPriceEntry = {
  address: string;
  price: string;
  priceChangePercent24Hrs: string;
};

/**
 * Fetch USD prices for the given CANONICAL coin types via our server
 * proxy (the upstream is CORS-locked — see app/api/token-price/route.ts).
 * Returns a map keyed by canonical coin type.
 */
async function fetchBluefinPrices(
  canonicalIds: string[],
): Promise<Record<string, number>> {
  if (canonicalIds.length === 0) return {};
  const tokens = canonicalIds.join(",");
  const res = await fetch(
    `/api/token-price?tokens=${encodeURIComponent(tokens)}`,
  );
  if (!res.ok) return {};
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return {};
  const out: Record<string, number> = {};
  for (const entry of data as BluefinPriceEntry[]) {
    if (!entry?.address) continue;
    const price = Number(entry.price);
    if (Number.isFinite(price)) out[canonicalize(entry.address)] = price;
  }
  return out;
}

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

// ─── Token-price cache ──────────────────────────────────────
// `getTokenPricesRaw` POSTs to the 7K aggregator on every call. Within a
// single chat session the same coins get re-quoted multiple times (swap
// preview + getBalance + balance refresh, etc). A short TTL cache cuts
// that to one network call per ~30s window. Failed fetches are NOT cached
// so the next caller retries; cache evicts itself when it crosses 200
// entries (safety against pathological coin churn).
type PriceMap = Record<string, number>;

const PRICE_TTL_MS = 30_000;
const MAX_PRICE_ENTRIES = 200;
type Entry = { value: number; expires: number };
const priceCache = new Map<string, Entry>();

export async function getTokenPrices(ids: string[]): Promise<PriceMap> {
  if (!ids || ids.length === 0) return {};
  // Dedupe + drop empty strings so we don't waste a slot on `""`.
  const unique = Array.from(new Set(ids.filter((id) => !!id)));
  const now = Date.now();
  const out: PriceMap = {};
  const misses: string[] = [];
  for (const id of unique) {
    const e = priceCache.get(id);
    if (e && e.expires > now) {
      out[id] = e.value;
    } else {
      misses.push(id);
    }
  }
  if (misses.length === 0) return out;

  // The oracle keys on canonical coin types and so does its response. Map
  // canonical → the caller's original id(s) so prices come back keyed by
  // whatever form the caller passed (e.g. short `0x2::sui::SUI`).
  const canonToOriginals = new Map<string, string[]>();
  for (const id of misses) {
    const canon = canonicalize(id);
    const arr = canonToOriginals.get(canon) ?? [];
    arr.push(id);
    canonToOriginals.set(canon, arr);
  }
  const fresh = await fetchBluefinPrices(Array.from(canonToOriginals.keys()));
  for (const [canon, value] of Object.entries(fresh)) {
    const originals = canonToOriginals.get(canon) ?? [canon];
    for (const id of originals) {
      out[id] = value;
      // Don't cache zeroes — they typically mean the oracle has no price.
      if (Number.isFinite(value) && value > 0) {
        priceCache.set(id, { value, expires: now + PRICE_TTL_MS });
      }
    }
  }
  if (priceCache.size > MAX_PRICE_ENTRIES) priceCache.clear();
  return out;
}

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
