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

/** DeepSeek v4 Flash with medium reasoning effort via OpenRouter. */
export const aiModel = openrouter("deepseek/deepseek-v4-flash");
