// Pricing for the active OpenRouter model (USD per 1M tokens).
// Pure data + math — safe to import from client and server. Keep this
// separate from `./openrouter` which is server-only (depends on the
// provider SDK + API key).

export const MODEL_PRICING = {
  "tencent/hy3-preview": {
    inputPer1M: 0.112,
    cachedInputPer1M: 0.022,
    outputPer1M: 0.224,
    name: "Hy3",
  },
  "nvidia/nemotron-3-nano-30b-a3b": {
    inputPer1M: 0.05,
    cachedInputPer1M: 0.05,
    outputPer1M: 0.2,
    name: "Nemotron 3 Nano",
  },
  "deepseek/deepseek-v4-flash": {
    inputPer1M: 0.1,
    cachedInputPer1M: 0.02,
    outputPer1M: 0.2,
    name: "DeepSeek v4 Flash",
  },
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": {
    inputPer1M: 0.05,
    cachedInputPer1M: 0.05,
    outputPer1M: 0.2,
    name: "Nemotron 3 Nano Omni",
  },
  "arcee-ai/trinity-large-thinking": {
    inputPer1M: 0.22,
    cachedInputPer1M: 0.85,
    outputPer1M: 0.06,
    name: "Trinity Large",
  },
} as Record<
  string,
  {
    inputPer1M: number;
    cachedInputPer1M: number;
    outputPer1M: number;
    name: string;
  }
>;

/** Computes USD cost from a `LanguageModelUsage`-shaped object. */
export function computeMessageCostAndModelName(usage: {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  model: string;
}) {
  const totalInput = usage.inputTokens ?? 0;
  const cached = usage.cachedInputTokens ?? 0;
  // Cached is a subset of input on OpenAI-style providers — bill the
  // remainder at the fresh rate, cached portion at the cached rate.
  const fresh = Math.max(0, totalInput - cached);
  const output = usage.outputTokens ?? 0;
  return {
    cost:
      (fresh / 1_000_000) * (MODEL_PRICING[usage.model]?.inputPer1M ?? 0) +
      (cached / 1_000_000) *
        (MODEL_PRICING[usage.model]?.cachedInputPer1M ?? 0) +
      (output / 1_000_000) * (MODEL_PRICING[usage.model]?.outputPer1M ?? 0),
    name: MODEL_PRICING[usage.model]?.name ?? usage.model,
  };
}
