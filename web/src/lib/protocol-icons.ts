/**
 * Maps protocol display names (as they appear in mock allocations) to
 * DeFiLlama icon slugs. Fallback handled by AssetIcon's onError swap.
 */
const PROTOCOL_SLUGS: Record<string, string> = {
  "Suilend": "suilend",
  "NAVI Protocol": "navi-protocol",
  "Scallop": "scallop",
  "Bucket Protocol": "bucket-protocol",
  "Cetus (via 7K)": "cetus",
  "FlowX (via 7K)": "flowx-finance",
  "Ember Finance": "ember-protocol",
};

/**
 * Brand-ish color seed for the letter fallback. Stable per-name.
 */
// Non-green palette only — cash-lime is the single accent reserved for the brand.
const FALLBACK_PALETTE = [
  "#0b0b0f", // black
  "#1f3a8a", // navy
  "#7c2d12", // burnt
  "#581c87", // plum
  "#9a3412", // rust
  "#0c4a6e", // deep blue
  "#4c1d95", // violet
];

export function protocolIconUrl(venue: string): string | undefined {
  const slug = PROTOCOL_SLUGS[venue];
  if (!slug) return undefined;
  return `https://icons.llamao.fi/icons/protocols/${slug}?w=64&h=64`;
}

export function fallbackBg(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length];
}

export function initials(label: string): string {
  const parts = label.replace(/\(.*\)/g, "").trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
