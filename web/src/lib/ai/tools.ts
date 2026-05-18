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
  getBalance: tool({
    description:
      "Read the connected wallet's balance for a single token. Use this BEFORE getSwapQuote whenever the user phrases the amount relative to their holdings — e.g. 'half my USDC', 'all my SUI', '25% of my WAL', 'a quarter of my BUCK'. Returns the balance in human units. Errors if no wallet is connected.",
    inputSchema: z.object({
      symbol: z
        .string()
        .describe("Token symbol to read — e.g. USDC, SUI, WAL"),
    }),
  }),
  getBalances: tool({
    description:
      "Read ALL non-zero token balances in the connected wallet. Use when the user asks 'what do I have', 'what's in my wallet', 'show my portfolio', or when picking a source token requires seeing what they own. Errors if no wallet is connected.",
    inputSchema: z.object({}),
  }),
};

export type ToolName = keyof typeof swapTools;
