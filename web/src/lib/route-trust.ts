// DEX identifiers Bluefin7K's aggregator routes through that we've vetted
// as established Sui venues. Pool types from quote.routes[].hops[].pool.type
// get reduced to one of these slugs via extractRoute() / dexLabel().
// Anything that resolves to a slug NOT in this set is surfaced to the
// Guardian as an "unfamiliar venue" risk.

const TRUSTED_DEXES = new Set<string>([
  // 7K Meta Aggregator provider slugs (we route through these aggregators).
  "bluefin7k",
  "okx",
  "cetus",
  "cetus_dlmm",
  "aftermath",
  "kriya",
  "kriya_v3",
  "flowx",
  "flowx_v3",
  "bluefin",
  "deepbook_v3",
  "turbos",
]);

export function isTrustedDex(dex: string): boolean {
  return TRUSTED_DEXES.has(dex);
}

export function untrustedDexes(dexes: readonly string[]): string[] {
  return dexes.filter((d) => !TRUSTED_DEXES.has(d));
}
