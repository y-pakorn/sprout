import type { IntentInput } from "./intent";

const KNOWN_ASSETS = ["USDC", "USDT", "SUI", "WAL", "DEEP", "BUCK"];

/**
 * Quick heuristic intent parser. Replaces the slider form for v1 — extracts
 * what we can from natural language; defaults everything else. Will be
 * superseded by a proper LLM parser via Vercel AI SDK.
 */
export function parseIntent(text: string, fallback: IntentInput): IntentInput {
  const out: IntentInput = { ...fallback };
  out.rawText = text;
  out.constraints = text; // preserve full prompt for downstream classifiers

  // Amount: "$1,000", "1000", "1k", "5K USDC"
  const amountMatch = text.match(/\$?\s*([0-9]+(?:[,.][0-9]+)*)\s*([kKmM]?)/);
  if (amountMatch) {
    const raw = parseFloat(amountMatch[1].replace(/,/g, ""));
    const unit = amountMatch[2].toLowerCase();
    if (Number.isFinite(raw)) {
      const mult = unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1;
      out.amount = Math.max(50, Math.min(50_000, Math.round(raw * mult)));
    }
  }

  // "FROM to TO" swap pattern — e.g. "swap 100 SUI to USDC", "SUI for USDC"
  const upper = text.toUpperCase();
  const swapDirMatch = upper.match(
    /(USDC|USDT|SUI|WAL|DEEP|BUCK)\s+(?:TO|→|->|FOR|INTO)\s+(USDC|USDT|SUI|WAL|DEEP|BUCK)/,
  );
  if (swapDirMatch) {
    out.asset = swapDirMatch[1];
    out.toAsset = swapDirMatch[2];
  } else {
    // No direction — pick the FIRST asset mentioned in the text
    let firstIdx = Infinity;
    let firstAsset: string | undefined;
    for (const a of KNOWN_ASSETS) {
      const idx = upper.indexOf(a);
      if (idx >= 0 && idx < firstIdx) {
        firstIdx = idx;
        firstAsset = a;
      }
    }
    if (firstAsset) out.asset = firstAsset;
    out.toAsset = undefined;
  }

  // Target APY: "7%", "earn 7", "5% yield"
  const apyMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
  if (apyMatch) {
    const pct = parseFloat(apyMatch[1]);
    if (Number.isFinite(pct)) out.targetApy = Math.max(1, Math.min(25, pct));
  }

  // Risk inferred from words
  const lower = text.toLowerCase();
  if (/\b(safest|conservative|sleep|safe)\b/.test(lower)) out.risk = 0;
  else if (/\b(steady|balanced|moderate)\b/.test(lower)) out.risk = 1;
  else if (/\b(adventurous|aggressive|high\s*yield)\b/.test(lower)) out.risk = 2;
  else if (/\b(yolo|degen|send\s*it|max)\b/.test(lower)) out.risk = 3;

  return out;
}

export const EXAMPLE_PROMPTS: { label: string; text: string }[] = [
  {
    label: "Swap $500 USDC to SUI → highest APR",
    text: "Swap $500 USDC to SUI then find the highest APR",
  },
  { label: "Earn 7% on $1,000 USDC", text: "Earn 7% on $1,000 USDC" },
  { label: "Swap 100 SUI to USDC", text: "Swap 100 SUI to USDC" },
  { label: "Diversify $5,000 conservatively", text: "Diversify $5,000 conservatively across the safest USDC venues" },
  { label: "USDC/SUI LP for $2,000", text: "Give me USDC/SUI LP exposure with $2,000, aggressive" },
];
