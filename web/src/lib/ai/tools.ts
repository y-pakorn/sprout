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
  listVaults: tool({
    description:
      "List Ember Finance vaults on Sui sorted by APY descending. Optionally filter to vaults that accept a specific deposit token. Use this when the user wants to deposit and hasn't named a vault, asks about yields, or wants to compare options.",
    inputSchema: z.object({
      depositSymbol: z
        .string()
        .optional()
        .describe(
          "If set, only return vaults that accept this token as the deposit asset (e.g. SUI, USDC).",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("Max number of vaults to return."),
    }),
  }),
  executePlan: tool({
    description:
      "Assemble an atomic Sui transaction (PTB) from a sequence of low-level steps. The whole plan executes or none of it does, with ONE wallet signature. Steps reference each other through string `id`s — every step's output coin handle becomes available to later steps.\n\nStep kinds:\n- 'swap' — runs a Bluefin7K swap. Produces a coin of toSymbol under this step's id.\n- 'split' — splits one coin handle into N portions by bps (sum 10000). Produces handles `<id>.0`, `<id>.1`, …\n- 'merge' — merges multiple coin handles of the SAME token (and/or pulls from balance) into ONE coin. Produces a single handle under this step's id. Use when combining a swap output with an existing wallet balance, or two swap outputs, before splitting/depositing.\n- 'deposit' — deposits a coin handle into an Ember vault. Vault must accept the coin's token type; no auto-conversion (insert a swap step first).\n\nOrigin (how a step gets its input coin) — exactly ONE of:\n- `fromHandle` to consume an upstream output (e.g. `swap1`, `split1.0`).\n- `fromSymbol` + `fromAmount` to draw from sender's balance.\n- `fromHandles` (merge only) — array of upstream handle ids to combine. Optionally combined with `fromSymbol`+`fromAmount` to also include balance.",
    inputSchema: z.object({
      steps: z
        .array(
          z.object({
            kind: z
              .enum(["swap", "split", "merge", "deposit"])
              .describe("Step type."),
            id: z
              .string()
              .min(1)
              .describe(
                "Short unique id for this step (referenced by downstream steps). Example: 'swap1', 'merge1', 'split1'.",
              ),
            fromHandle: z
              .string()
              .optional()
              .describe(
                "(swap/split/deposit) Consume the entire coin produced by a previous step. For split outputs use '<id>.<index>' e.g. 'split1.0'.",
              ),
            fromHandles: z
              .array(z.string())
              .optional()
              .describe(
                "(merge only) Two or more upstream handle ids to merge into one coin. All MUST be the same token type. Can be combined with fromSymbol+fromAmount to also include sender balance.",
              ),
            fromSymbol: z
              .string()
              .optional()
              .describe(
                "Start from the sender's balance of this token. Pair with fromAmount. For merge, this is an ADDITIONAL source on top of fromHandles.",
              ),
            fromAmount: z
              .number()
              .positive()
              .optional()
              .describe(
                "Amount in human units of fromSymbol to consume from the sender's balance.",
              ),
            toSymbol: z
              .string()
              .optional()
              .describe("(swap only) destination token symbol."),
            slippagePct: z
              .number()
              .min(0.1)
              .max(20)
              .optional()
              .describe(
                "(swap only) slippage tolerance in percent. Default 1.",
              ),
            portionsBps: z
              .array(z.number().int().min(1).max(10000))
              .min(2)
              .max(10)
              .optional()
              .describe(
                "(split only) Per-portion bps, MUST sum to exactly 10000.",
              ),
            vaultId: z
              .string()
              .optional()
              .describe(
                "(deposit only) Ember vault UUID from listVaults.",
              ),
          }),
        )
        .min(1)
        .max(20)
        .describe(
          "Ordered list of plan steps. Topo-sorted by handle dependencies before execution.",
        ),
    }),
  }),
  explainConcept: tool({
    description:
      "Look up the canonical explainer for a DeFi concept the user asked about (e.g. impermanent loss, APY composition, withdrawal lockup, MPC custody). Always use this when the user wants to understand a risk, term, or how something works — DO NOT freestyle the explanation. The explainer is a markdown string; quote it back to the user verbatim, optionally adding 1–2 sentences tying it to the vault/quote on screen.",
    inputSchema: z.object({
      key: z
        .enum([
          "impermanent-loss",
          "concentrated-liquidity",
          "apy-composition",
          "reward-emissions",
          "performance-fee",
          "management-fee",
          "withdrawal-lockup",
          "mpc-custody",
          "variable-apy",
          "tvl-capacity",
          "bluefin7k-aggregator",
          "price-impact",
          "slippage",
          "protocol-risk",
          "rate-slippage",
        ])
        .describe("Concept key from the vault glossary."),
    }),
  }),
};

export type ToolName = keyof typeof swapTools;
