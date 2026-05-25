"use client";

import { getTokenPrices as sdkGetTokenPrices } from "@7kprotocol/sdk-ts";

/**
 * Canonicalize a Sui coin type — pad the address to 64 hex chars and
 * lowercase, so short (`0x2::sui::SUI`) and long forms collide on one key.
 */
function canonicalize(coinType: string): string {
  const segments = coinType.split("::");
  const addr = segments[0];
  if (!addr || !addr.startsWith("0x")) return coinType;
  segments[0] = `0x${addr.slice(2).padStart(64, "0").toLowerCase()}`;
  return segments.join("::");
}

/** Default slippage tolerance, expressed as fractional (0.003 = 0.3%). */
export const DEFAULT_SLIPPAGE_PCT = 0.003;

// ─── Token-price cache (now backed by the 7K SDK price API) ─────────────
type PriceMap = Record<string, number>;

const PRICE_TTL_MS = 30_000;
const MAX_PRICE_ENTRIES = 200;
type Entry = { value: number; expires: number };
const priceCache = new Map<string, Entry>();

/** Fetch USD prices for CANONICAL coin types via the 7K SDK. */
async function fetchPrices(canonicalIds: string[]): Promise<PriceMap> {
  if (canonicalIds.length === 0) return {};
  const raw = await sdkGetTokenPrices(canonicalIds).catch(() => ({}) as PriceMap);
  const out: PriceMap = {};
  for (const [k, v] of Object.entries(raw)) {
    const price = Number(v);
    if (Number.isFinite(price)) out[canonicalize(k)] = price;
  }
  return out;
}

export async function getTokenPrices(ids: string[]): Promise<PriceMap> {
  if (!ids || ids.length === 0) return {};
  const unique = Array.from(new Set(ids.filter((id) => !!id)));
  const now = Date.now();
  const out: PriceMap = {};
  const misses: string[] = [];
  for (const id of unique) {
    const e = priceCache.get(id);
    if (e && e.expires > now) out[id] = e.value;
    else misses.push(id);
  }
  if (misses.length === 0) return out;

  // The 7K price API keys on canonical coin types. Map canonical → the
  // caller's original id(s) so prices come back under whatever form was passed.
  const canonToOriginals = new Map<string, string[]>();
  for (const id of misses) {
    const canon = canonicalize(id);
    const arr = canonToOriginals.get(canon) ?? [];
    arr.push(id);
    canonToOriginals.set(canon, arr);
  }
  const fresh = await fetchPrices(Array.from(canonToOriginals.keys()));
  for (const [canon, value] of Object.entries(fresh)) {
    const originals = canonToOriginals.get(canon) ?? [canon];
    for (const id of originals) {
      out[id] = value;
      if (Number.isFinite(value) && value > 0) {
        priceCache.set(id, { value, expires: now + PRICE_TTL_MS });
      }
    }
  }
  if (priceCache.size > MAX_PRICE_ENTRIES) priceCache.clear();
  return out;
}

/**
 * Price impact percent from the actual swap rate vs the spot rate implied by
 * oracle USD prices (getTokenPrices). Aggregator-agnostic — pass raw in/out.
 *
 *   idealRate  = priceIn / priceOut
 *   actualRate = amountOut / amountIn   (human units)
 *   impact     = (1 - actualRate / idealRate) * 100
 */
export function computeImpactFromAmounts(
  amountInRaw: string | number | bigint,
  amountOutRaw: string | number | bigint,
  priceIn: number,
  priceOut: number,
  fromDecimals: number,
  toDecimals: number,
): number {
  const inAmt = Number(amountInRaw) / 10 ** fromDecimals;
  const outAmt = Number(amountOutRaw) / 10 ** toDecimals;
  if (!Number.isFinite(inAmt) || !Number.isFinite(outAmt) || inAmt <= 0)
    return 0;
  if (!Number.isFinite(priceIn) || !Number.isFinite(priceOut)) return 0;
  if (priceIn <= 0 || priceOut <= 0) return 0;
  const idealRate = priceIn / priceOut;
  const actualRate = outAmt / inAmt;
  const impact = (1 - actualRate / idealRate) * 100;
  return Math.max(0, Math.min(100, impact));
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
