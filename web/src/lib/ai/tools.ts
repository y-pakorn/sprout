import { tool } from "ai";
import { z } from "zod";

/**
 * Smaller models routinely serialize array-valued tool args as a JSON
 * *string* (e.g. `steps: "[{...}]"`) instead of a real array, which fails
 * schema validation and kills the whole tool call. This preprocess rescues
 * that case by parsing a string back into a value before the array schema
 * runs. zod's JSON-schema generation still emits the inner array (verified),
 * so the model is told to send an array exactly as before — this only
 * salvages the malformed string variant.
 */
const coerceJsonArray = (v: unknown) => {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
};

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
  searchToken: tool({
    description:
      "Confirm a token in the live Sui registry by symbol OR name, and get its EXACT symbol + coin type before a swap. Use this whenever the destination/source token the user named is NOT an obvious major (SUI, USDC, USDT, WAL, DEEP) and you're not 100% sure it resolves — NEVER guess or autocorrect an unfamiliar symbol to a better-known lookalike (Sui has many similarly-named tokens: USDC, USDSUI, USDB, WUSDC, SUIUSDE, AUSD, …; 'usdsui' is USDSUI, not USDC). Returns ranked matches with the exact symbol, name, coin type, and verified flag. Copy the returned symbol VERBATIM into executePlan's fromSymbol/toSymbol.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Token symbol or name to look up — e.g. 'usdsui', 'sui dollar', 'wal'. Case-insensitive.",
        ),
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
      "Assemble an atomic Sui transaction (PTB) from a sequence of low-level steps. The whole plan executes or none of it does, with ONE wallet signature. Steps reference each other through string `id`s — every step's output coin handle becomes available to later steps.\n\nStep kinds:\n- 'swap' — runs a Bluefin7K swap. Produces a coin of toSymbol under this step's id.\n- 'split' — splits one coin handle into N portions by bps (sum 10000). Produces handles `<id>.0`, `<id>.1`, …\n- 'merge' — merges multiple coin handles of the SAME token (and/or pulls from balance) into ONE coin. Produces a single handle under this step's id. Use when combining a swap output with an existing wallet balance, or two swap outputs, before splitting/depositing.\n- 'deposit' — deposits a coin handle into an Ember vault. Vault must accept the coin's token type; no auto-conversion (insert a swap step first).\n- 'redeemFromVault' — requests a withdrawal from an Ember vault by burning receipt shares. Funds arrive AFTER the vault's withdrawal lockup (NOT in this transaction); produces NO output coin handle. Use the receipt token symbol (e.g. ercUSD, eACRED) as the source. Optional 'sharesAmount' picks a partial redemption; omit to redeem all available shares (use 'fromAmount' if you want a specific amount via fromSymbol).\n- 'cancelRedeemFromVault' — cancels a previously-submitted pending withdrawal request, returning the shares to the user. Requires the request's 'sequenceNumber' (from getVaultBalance.withdrawals) and the matching vaultId. Has no coin handle input/output.\n- 'send' — transfers a coin to someone else. Sources its coin like a deposit (an upstream fromHandle, or fromSymbol+fromAmount / fromSymbol+fromPercent from balance) and sends it to 'recipient' (a 0x address or SuiNS name like yoisha.sui). Produces NO handle — the coin leaves the wallet. This is IRREVERSIBLE; pass the recipient exactly as the user gave it, never guess. DO NOT use this step for a single transfer of an allowlisted stablecoin (USDC, USDSUI, suiUSDe, USDY, FDUSD, AUSD, USDB) drawn straight from the wallet — that MUST use the `sendStablecoin` tool instead (gasless, $0, no SUI). Use 'send' only for chained sends (swap→send), splitting one amount across recipients, or non-allowlisted tokens.\n\nOrigin (how a step gets its input coin) — exactly ONE of:\n- `fromHandle` to consume an upstream output (e.g. `swap1`, `split1.0`).\n- `fromSymbol` + `fromAmount` to draw a SPECIFIC amount from sender's balance.\n- `fromSymbol` + `fromPercent` to draw a percentage of the balance (100 = everything). Prefer this over fromAmount for 'swap all'/'sell half' — it's resolved to the exact raw balance at build time, so there's no rounding dust or 'insufficient balance' overshoot.\n- `fromHandles` (merge only) — array of upstream handle ids to combine. Optionally combined with `fromSymbol`+`fromAmount` to also include balance.\n- For cancelRedeemFromVault, origin fields are ignored — it only needs vaultId + sequenceNumber.",
    inputSchema: z.object({
      steps: z.preprocess(
        coerceJsonArray,
        z
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
                "send",
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
                "(merge only) Two or more upstream handle ids to merge into one coin. All MUST be the same token type. Can be combined with fromSymbol + fromAmount OR fromSymbol + fromPercent to also fold in the sender's wallet balance of that token (use fromPercent: 100 to add ALL of it — the robust way to consolidate swap outputs WITH existing wallet balance).",
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
            recipient: z
              .string()
              .optional()
              .describe(
                "(send only) Where to transfer the coin: a raw Sui address (0x…) or a SuiNS name (e.g. yoisha.sui / @yoisha). Resolved to an address at build time; pass the user's address/name VERBATIM — never invent one.",
              ),
          }),
        )
        .min(1)
        .max(20)
        .describe(
          "Ordered list of plan steps. Topo-sorted by handle dependencies before execution.",
        )
      ),
      risks: z.preprocess(
        coerceJsonArray,
        z
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
        )
      ),
    }),
  }),
  sendStablecoin: tool({
    description:
      "Transfer an allowlisted stablecoin to someone GASLESS — $0 fee, NO SUI required (Sui's protocol-level gasless stablecoin transfers). Eligible tokens: USDC, USDSUI, suiUSDe, USDY, FDUSD, AUSD, USDB. Use this for a SINGLE peer-to-peer stablecoin transfer drawn from the wallet — it is the preferred way to send these tokens because it costs nothing and needs no SUI. It is NOT chainable: for swap→send, splitting one amount across recipients, or sending any non-allowlisted token, use executePlan's `send` step instead (that pays SUI gas). The transfer is IRREVERSIBLE; pass the recipient exactly as the user gave it, never invent one.",
    inputSchema: z.object({
      symbol: z
        .string()
        .describe(
          "Stablecoin to send — one of USDC, USDSUI, suiUSDe, USDY, FDUSD, AUSD, USDB.",
        ),
      amount: z
        .number()
        .positive()
        .describe("Amount to send in human units (e.g. 5 = 5 USDC)."),
      recipient: z
        .string()
        .describe(
          "Recipient: a 0x address or SuiNS name (e.g. yoisha.sui / @yoisha). Pass exactly as the user gave it.",
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
  resolveSuiName: tool({
    description:
      "Convert between a SuiNS name and a Sui address, in EITHER direction (auto-detected). Pass a SuiNS name (e.g. 'yoisha.sui' or '@yoisha') to get its target 0x address; pass a 0x address to get its primary SuiNS name (reverse lookup). Use whenever the user asks 'what's the address for X.sui', 'what name does 0x… have', 'who is this address', or to confirm a recipient before sending. Read-only — no wallet required. A reverse lookup may legitimately find no name (not every address sets one).",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          "A SuiNS name ('yoisha.sui' / '@yoisha') OR a 0x Sui address. The direction is detected automatically.",
        ),
    }),
  }),
};

export type ToolName = keyof typeof swapTools;
