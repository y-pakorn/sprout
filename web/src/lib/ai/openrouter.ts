import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  // Lazy warn — don't crash module load; route handler will throw nicely.
  console.warn(
    "[ai] OPENROUTER_API_KEY is not set. Add it to web/.env.local before the agent can run."
  );
}

const openrouter = createOpenRouter({
  apiKey: apiKey ?? "",
});

/** DeepSeek v4 Flash (free tier) via OpenRouter. */
// export const aiModel = openrouter("deepseek/deepseek-v4-flash");
// export const aiModel = openrouter("tencent/hy3-preview");
// export const aiModel = openrouter("poolside/laguna-xs.2:free");
export const aiModel = openrouter("inclusionai/ling-2.6-flash");
// export const aiModels = ["tencent/hy3-preview"];
// export const aiModels = ["deepseek/deepseek-v4-flash"];
export const aiModels = [
  // "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  // "nvidia/nemotron-3-nano-30b-a3b:free",
  "tencent/hy3-preview",
  "deepseek/deepseek-v4-flash",
];

/** Build a chat model by id (used when the user picks one in the input).
 *  Callers MUST validate the id against the pricing table (isKnownModel)
 *  first — this does no validation of its own. */
export function chatModel(id: string) {
  return openrouter(id);
}

export const ptbAiModel = openrouter("poolside/laguna-xs.2:free");
export const ptbAiModels = [
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "tencent/hy3-preview",
  "deepseek/deepseek-v4-flash",
];

// Pricing + cost math lives in ./pricing.ts so the client can import it
// without pulling the server-only provider chain.
