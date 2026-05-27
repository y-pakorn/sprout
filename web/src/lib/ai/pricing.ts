// Pricing for the active OpenRouter model (USD per 1M tokens).
// Pure data + math — safe to import from client and server. Keep this
// separate from `./openrouter` which is server-only (depends on the
// provider SDK + API key).

export const MODEL_PRICING = {
  "poolside/laguna-xs.2": {
    inputPer1M: 0.05,
    cachedInputPer1M: 0.05,
    outputPer1M: 0.2,
    name: "Sprout XS",
    description:
      "Fast, lightweight guidance for quick questions, portfolio checks, and simple swaps.",
  },
  "poolside/laguna-m.1": {
    inputPer1M: 0.1,
    cachedInputPer1M: 0.02,
    outputPer1M: 0.3,
    name: "Sprout Medium",
    description:
      "Balanced reasoning for multi-step DeFi planning, tradeoffs, and risk explanations.",
  },
  "inclusionai/ling-2.6-flash": {
    inputPer1M: 0.1,
    cachedInputPer1M: 0.02,
    outputPer1M: 0.3,
    name: "Sprout Flash",
    description:
      "Responsive default assistant for everyday planning with clear, wallet-ready summaries.",
    isDefault: true,
  },
} as Record<
  string,
  {
    inputPer1M: number;
    cachedInputPer1M: number;
    outputPer1M: number;
    name: string;
    description: string;
    isDefault?: boolean;
  }
>;

export type SelectableModel = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
};

/** The user-selectable chat models (every entry in the pricing table). */
export function selectableModels(): SelectableModel[] {
  return Object.entries(MODEL_PRICING).map(([id, m]) => ({
    id,
    name: m.name,
    description: m.description,
    isDefault: !!m.isDefault,
  }));
}

/** The id flagged `isDefault` (falls back to the first listed model). */
export function defaultModelId(): string {
  const ids = Object.keys(MODEL_PRICING);
  return ids.find((id) => MODEL_PRICING[id]?.isDefault) ?? ids[0];
}

/** Whether an id is a known/allowed model (guards the chat route). */
export function isKnownModel(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICING, id);
}

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
