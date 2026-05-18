// Pricing for the active OpenRouter model (USD per 1M tokens).
// Pure data + math — safe to import from client and server. Keep this
// separate from `./openrouter` which is server-only (depends on the
// provider SDK + API key).

export const MODEL_PRICING = {
  /** Fresh prompt tokens */
  inputPer1M: 0.066,
  /** Cached prompt tokens (subset of input, discounted) */
  cachedInputPer1M: 0.029,
  /** Completion tokens */
  outputPer1M: 0.26,
} as const;

/** Computes USD cost from a `LanguageModelUsage`-shaped object. */
export function computeMessageCost(usage: {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}): number {
  const totalInput = usage.inputTokens ?? 0;
  const cached = usage.cachedInputTokens ?? 0;
  // Cached is a subset of input on OpenAI-style providers — bill the
  // remainder at the fresh rate, cached portion at the cached rate.
  const fresh = Math.max(0, totalInput - cached);
  const output = usage.outputTokens ?? 0;
  return (
    (fresh / 1_000_000) * MODEL_PRICING.inputPer1M +
    (cached / 1_000_000) * MODEL_PRICING.cachedInputPer1M +
    (output / 1_000_000) * MODEL_PRICING.outputPer1M
  );
}
