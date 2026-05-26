import { tool } from "ai";
import { z } from "zod";

/**
 * Tool schemas. NO `execute` function — handled CLIENT-SIDE via `useChat`'s
 * `onToolCall` callback. This lets us call Bluefin7K from the user's browser
 * (spreading rate-limit load) and keep the heavy QuoteResponse payload off
 * the prompt window.
 *
 * Execution (wallet sign) is handled directly by the Sign button in the
 * rendered plan card — the AI is not involved in that step.
 */
export const swapTools = {
  getBalance: tool({
    description:
      "Read a token balance for a single token. Defaults to the connected wallet; pass `address` to read ANOTHER address's balance. Use this BEFORE executePlan whenever the user phrases the amount relative to THEIR holdings — e.g. 'half my USDC', 'all my SUI', '25% of my WAL'. Returns the balance in human units. Errors only if no `address` is given and no wallet is connected.",
    inputSchema: z.object({
      symbol: z
        .string()
        .describe("Token symbol to read — e.g. USDC, SUI, WAL"),
      address: z
        .string()
        .optional()
        .describe(
          "Sui address (0x…) to read. Omit to use the connected wallet.",
        ),
    }),
  }),
  getBalances: tool({
    description:
      "Read ALL non-zero token balances for an address. Defaults to the connected wallet; pass `address` to inspect ANOTHER address's holdings. Use when the user asks 'what do I have', 'what's in my wallet', 'what does 0x… hold', 'show my portfolio', or when picking a source token requires seeing what they own. Errors only if no `address` is given and no wallet is connected.",
    inputSchema: z.object({
      address: z
        .string()
        .optional()
        .describe(
          "Sui address (0x…) to read. Omit to use the connected wallet.",
        ),
    }),
  }),
  getVaultBalance: tool({
    description:
      "Read an address's Ember vault balance: current vault positions (with shares, position value in USD, total/unrealized/realized yield), any pending withdrawal requests, and recent vault history (deposits, redeem requests, processed redemptions). Defaults to the connected wallet; pass `address` for ANOTHER address. Use whenever the user asks 'how are my vaults doing', 'show my vault balance', 'what's my P&L on vaults', 'what vaults am I in', 'pending withdrawals', 'my yield', 'vault history'. Errors only if no `address` is given and no wallet is connected.",
    inputSchema: z.object({
      address: z
        .string()
        .optional()
        .describe(
          "Sui address (0x…) to read. Omit to use the connected wallet.",
        ),
    }),
  }),
  getAccountActivity: tool({
    description:
      "Fetch recent on-chain activity for a Sui address (swaps, sends, receives, stakes, etc.) via Blockberry. Use when the user asks about their recent transactions / activity / history — 'what have I done', 'my recent txs', 'my activity', 'last few transactions' — or about a SPECIFIC address they name ('what has 0x… been doing'). OMIT `address` to use the connected wallet (the client fills it in). Returns the most recent activities newest-first: each has signed coin movements (negative = out, positive = in), the protocol/counterparty, status, gas, and the tx digest. Errors if no address is given and no wallet is connected.",
    inputSchema: z.object({
      address: z
        .string()
        .optional()
        .describe(
          "Sui address (0x…) to query. Omit to use the connected wallet.",
        ),
      actionType: z
        .enum(["ALL", "SEND", "RECEIVE"])
        .optional()
        .describe("Filter by direction. Default ALL."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max number of activities to return."),
    }),
  }),
  getTransactionDetail: tool({
    description:
      "Look up the full detail of ONE transaction by its digest (hash) via Suiscan. Returns basic detail (status, sender, timestamp, gas fee paid, checkpoint, command/event counts, the net balance change for the sender) plus the decoded per-step activities (e.g. each hop of a multi-DEX swap route, with signed coin amounts and the protocol). Use when the user pastes/quotes a tx digest, asks 'what happened in this tx', 'explain this transaction', 'what did 0x… do in <digest>', or wants to inspect a specific tx from a feed/history result.",
    inputSchema: z.object({
      digest: z
        .string()
        .describe("The transaction digest (base58 hash), e.g. from a feed/history row."),
    }),
  }),
  getCoins: tool({
    description:
      "List Sui coins/tokens via Blockberry, ranked by market cap (default), holder count, age (newest first), or name. Returns each coin's name, symbol, coin type, price, market cap, 24h volume, holder count, and whether it's verified. Use for 'top coins', 'biggest tokens by market cap', 'newest tokens', 'most-held coins', or to discover a coin's coin type before calling another coin tool.",
    inputSchema: z.object({
      sortBy: z
        .enum(["MARKET_CAP", "HOLDERS", "AGE", "NAME"])
        .optional()
        .describe("Ranking. Default MARKET_CAP. AGE = newest first."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max number of coins to return."),
    }),
  }),
  getCoinMetadata: tool({
    description:
      "Get metadata + market stats for one coin/token by its coin type (e.g. 0x2::sui::SUI), via Blockberry: name, symbol, decimals, description, total + circulating supply, market cap, 24h volume, and social links (website/twitter/discord/github/telegram). Use when the user asks about a specific token's details, fundamentals, supply, or socials.",
    inputSchema: z.object({
      coinType: z
        .string()
        .describe("The coin type, formatted 0x…::module::TYPE (e.g. 0x2::sui::SUI)."),
    }),
  }),
  getHoldersByCoinType: tool({
    description:
      "List the largest holders of a coin/token by its coin type, via Blockberry — ranked by balance, each with the holder address (or label), token amount, USD value, and percentage of supply. Use for 'who holds X', 'top holders / whales of X', or to gauge holder concentration.",
    inputSchema: z.object({
      coinType: z
        .string()
        .describe("The coin type, formatted 0x…::module::TYPE (e.g. 0x2::sui::SUI)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max number of holders to return."),
    }),
  }),
  getAccountTransactions: tool({
    description:
      "Fetch the raw transaction list for a Sui address via Blockberry, newest-first — the tx-level view (vs getAccountActivity's decoded swaps/sends). Each tx has its type, the Move functions called, the protocol/packages touched, fee, command count, and net balance changes. Use when the user wants their transactions / tx list / tx history by hash, asks which protocols/contracts they (or an address) interacted with, or wants SENDER vs RECEIVER txs. Prefer getAccountActivity when they ask about swaps/transfers/amounts in plain terms. OMIT `address` to use the connected wallet. Errors if no address is given and no wallet is connected.",
    inputSchema: z.object({
      address: z
        .string()
        .optional()
        .describe(
          "Sui address (0x…) to query. Omit to use the connected wallet.",
        ),
      participation: z
        .enum(["SENDER", "RECEIVER"])
        .optional()
        .describe(
          "Whether to list txs where the address was the SENDER or the RECEIVER. Default SENDER.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max number of transactions to return."),
    }),
  }),
  listVaults: tool({
    description:
      "List Ember Finance vaults on Sui sorted by APY descending. Optionally filter to vaults that accept a specific deposit token. Use this when the user wants to deposit and hasn't named a vault, asks about yields, or wants to compare options.\n\nEach vault includes RISK signals to ground your Guardian assessment (the executePlan `risks` array): `riskProfile` (\"principal_protected\"=Delta-Neutral/conservative, \"balanced\", \"volatile\"=Asymmetric/high-risk), `flags` (e.g. kyc_required, rwa, deprecated, beta, private, stablecoin), `perfFeeBps`/`mgmtFeeBps`, `rewardApyPct` (high share of `apyPct` = emissions-dependent), `capacityPct` (deposits vs cap), `depositors`, `strategy` (free-text, e.g. \"Private Credit\"), and `description`.",
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
      "Assemble an atomic Sui transaction (PTB) from a sequence of low-level steps. The whole plan executes or none of it does, with ONE wallet signature. Steps reference each other through string `id`s — every step's output coin handle becomes available to later steps.\n\nStep kinds:\n- 'swap' — runs a Bluefin7K swap. Produces a coin of toSymbol under this step's id.\n- 'split' — splits one coin handle into N portions by bps (sum 10000). Produces handles `<id>.0`, `<id>.1`, …\n- 'merge' — merges multiple coin handles of the SAME token (and/or pulls from balance) into ONE coin. Produces a single handle under this step's id. Use when combining a swap output with an existing wallet balance, or two swap outputs, before splitting/depositing.\n- 'deposit' — deposits a coin handle into an Ember vault. Vault must accept the coin's token type; no auto-conversion (insert a swap step first).\n- 'redeemFromVault' — requests a withdrawal from an Ember vault by burning receipt shares. Funds arrive AFTER the vault's withdrawal lockup (NOT in this transaction); produces NO output coin handle. Use the receipt token symbol (e.g. ercUSD, eACRED) as the source. Optional 'sharesAmount' picks a partial redemption; omit to redeem all available shares (use 'fromAmount' if you want a specific amount via fromSymbol).\n- 'cancelRedeemFromVault' — cancels a previously-submitted pending withdrawal request, returning the shares to the user. Requires the request's 'sequenceNumber' (from getVaultBalance.withdrawals) and the matching vaultId. Has no coin handle input/output.\n\nOrigin (how a step gets its input coin) — exactly ONE of:\n- `fromHandle` to consume an upstream output (e.g. `swap1`, `split1.0`).\n- `fromSymbol` + `fromAmount` to draw a SPECIFIC amount from sender's balance.\n- `fromSymbol` + `fromPercent` to draw a percentage of the balance (100 = everything). Prefer this over fromAmount for 'swap all'/'sell half' — it's resolved to the exact raw balance at build time, so there's no rounding dust or 'insufficient balance' overshoot.\n- `fromHandles` (merge only) — array of upstream handle ids to combine. Optionally combined with `fromSymbol`+`fromAmount` to also include balance.\n- For cancelRedeemFromVault, origin fields are ignored — it only needs vaultId + sequenceNumber.",
    inputSchema: z.object({
      steps: z
        .array(
          z.object({
            kind: z
              .enum([
                "swap",
                "split",
                "merge",
                "deposit",
                "redeemFromVault",
                "cancelRedeemFromVault",
              ])
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
                "Amount in human units of fromSymbol to consume from the sender's balance. Use for a SPECIFIC amount. To swap a fraction or ALL of a balance, prefer fromPercent — it avoids rounding dust and 'insufficient balance' errors.",
              ),
            fromPercent: z
              .number()
              .gt(0)
              .max(100)
              .optional()
              .describe(
                "Draw this percent (0–100) of the sender's fromSymbol balance instead of fromAmount. Resolved to an EXACT raw amount from the live on-chain balance at build time, so 100 swaps the entire balance with no leftover dust and no overshoot. Use this for 'swap everything', 'sell half my X', etc. Pair with fromSymbol; do not combine with fromAmount or fromHandle. For SUI itself, stay below 100 (leave headroom for gas).",
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
                "(deposit / redeemFromVault / cancelRedeemFromVault) Ember vault UUID from listVaults / getVaultBalance.",
              ),
            sequenceNumber: z
              .string()
              .optional()
              .describe(
                "(cancelRedeemFromVault only) The pending withdrawal's sequenceNumber from getVaultBalance.withdrawals[].",
              ),
          }),
        )
        .min(1)
        .max(20)
        .describe(
          "Ordered list of plan steps. Topo-sorted by handle dependencies before execution.",
        ),
      risks: z
        .array(
          z.object({
            title: z
              .string()
              .max(60)
              .describe("Short risk label, e.g. 'Illiquid private-credit RWA'."),
            note: z
              .string()
              .max(280)
              .describe(
                "1–2 plain-English sentences explaining this specific risk.",
              ),
            level: z
              .enum(["pass", "flag", "block"])
              .describe(
                "Severity: pass = informational, flag = noteworthy, block = serious.",
              ),
          }),
        )
        .max(6)
        .optional()
        .describe(
          "Key risks of THIS plan, each rendered as its own Guardian row for the user. REQUIRED when the plan has a deposit. Ground each risk in the target vault's riskProfile / flags / fees / capacityPct / rewardApyPct / strategy / description from listVaults — be specific to the vault, not generic. Do not restate these in your chat reply.",
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
