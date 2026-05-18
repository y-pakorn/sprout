import { tool } from "ai";
import { z } from "zod";

/**
 * Tool schemas. NO `execute` function — handled CLIENT-SIDE via `useChat`'s
 * `onToolCall` callback. This lets us call Bluefin7K from the user's browser
 * (spreading rate-limit load) and keep the heavy QuoteResponse payload off
 * the prompt window.
 *
 * Execution of the swap (wallet sign) is handled directly by the Sign
 * button in the rendered LiveSwapCard — the AI is not involved in that step.
 */
export const swapTools = {
  getSwapQuote: tool({
    description:
      "Fetch a live swap quote from the Bluefin7K aggregator. Returns price, expected output, route summary, and any warnings. Call this whenever the user wants to swap one token for another. The UI will render a full swap card from the quote; the user signs via a button there.",
    inputSchema: z.object({
      fromSymbol: z
        .string()
        .describe("Source token symbol — e.g. USDC, SUI, WAL"),
      toSymbol: z
        .string()
        .describe("Destination token symbol — e.g. USDC, SUI, WAL"),
      amount: z
        .number()
        .positive()
        .describe(
          "Amount in human-readable units of fromSymbol (e.g. 1.5 for 1.5 SUI)",
        ),
    }),
  }),
};

export type ToolName = keyof typeof swapTools;
