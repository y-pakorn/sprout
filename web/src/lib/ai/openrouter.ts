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
export const aiModel = openrouter("tencent/hy3-preview");
// export const aiModels = ["tencent/hy3-preview"];
export const aiModels = ["deepseek/deepseek-v4-flash"];

export const autoCompleteAiModel = openrouter(
  "nvidia/nemotron-3-nano-30b-a3b:free"
);
export const autoCompleteAiModels = [
  "openai/gpt-oss-20b:nitro",
  "tencent/hy3-preview",
];

// Pricing + cost math lives in ./pricing.ts so the client can import it
// without pulling the server-only provider chain.
export { MODEL_PRICING, computeMessageCost } from "./pricing";
