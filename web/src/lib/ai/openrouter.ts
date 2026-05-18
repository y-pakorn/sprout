import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  // Lazy warn — don't crash module load; route handler will throw nicely.
  console.warn(
    "[ai] OPENROUTER_API_KEY is not set. Add it to web/.env.local before the agent can run.",
  );
}

const openrouter = createOpenRouter({
  apiKey: apiKey ?? "",
});

/** Tencent Hunyuan 3 Preview via OpenRouter. */
export const aiModel = openrouter("tencent/hy3-preview");

// Pricing + cost math lives in ./pricing.ts so the client can import it
// without pulling the server-only provider chain.
export { MODEL_PRICING, computeMessageCost } from "./pricing";
