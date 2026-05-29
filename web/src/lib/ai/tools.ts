import { tool } from "ai";
import { z } from "zod";
import { planStepSchema } from "@/lib/ai/plan-steps";

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
        .describe(
          "Max activities to return. Leave unset — it defaults to 10. Do NOT raise it unless the user explicitly asks for a specific count; to show OLDER activity, paginate with `cursor` instead of fetching a bigger page.",
        ),
      cursor: z
        .string()
        .optional()
        .describe(
          "Pagination cursor. Omit for the most recent page; to go OLDER / see more, pass the `nextCursor` string returned by the previous call. hasNextPage in the result tells you if there's more.",
        ),
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
      page: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe(
          "0-based page. Omit (0) for the first page; increment (1, 2, …) to fetch the next page — use hasNextPage from the previous result to know if there's more.",
        ),
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
      page: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe(
          "0-based page. Omit (0) for the first page; increment (1, 2, …) to fetch the next page — use hasNextPage from the previous result to know if there's more.",
        ),
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
      cursor: z
        .string()
        .optional()
        .describe(
          "Pagination cursor. Omit for the most recent page; to go OLDER / see more, pass the `nextCursor` string returned by the previous call. hasNextPage in the result tells you if there's more.",
        ),
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
      "Assemble an atomic Sui transaction (PTB) from a sequence of low-level steps. The whole plan executes or none of it does, with ONE wallet signature. Steps reference each other through string `id`s — every step's output coin handle becomes available to later steps.\n\nStep kinds:\n- 'swap' — runs a Bluefin7K swap. Produces a coin of toSymbol under this step's id.\n- 'split' — splits one coin handle into N portions by bps (sum 10000). Produces handles `<id>.0`, `<id>.1`, …\n- 'merge' — merges multiple coin handles of the SAME token (and/or pulls from balance) into ONE coin. Produces a single handle under this step's id. Use when combining a swap output with an existing wallet balance, or two swap outputs, before splitting/depositing.\n- 'deposit' — deposits a coin handle into an Ember vault. Vault must accept the coin's token type; no auto-conversion (insert a swap step first).\n- 'redeemFromVault' — requests a withdrawal from an Ember vault by burning receipt shares. Funds arrive AFTER the vault's withdrawal lockup (NOT in this transaction); produces NO output coin handle. The `origin` sources the receipt-token shares (e.g. ercUSD, eACRED): use origin from:'percent' percent:100 to redeem the whole position, or from:'amount' with the receipt symbol for a specific share count.\n- 'cancelRedeemFromVault' — cancels a previously-submitted pending withdrawal request, returning the shares to the user. Requires the request's 'sequenceNumber' (from getVaultBalance.withdrawals) and the matching vaultId. Has no coin handle input/output.\n- 'send' — transfers a coin to someone else. Sources its coin via `origin` (an upstream handle, or a balance draw) and sends it to 'recipient' (a 0x address or SuiNS name like yoisha.sui). Produces NO handle — the coin leaves the wallet. This is IRREVERSIBLE; pass the recipient exactly as the user gave it, never guess. DO NOT use this step for a single transfer of an allowlisted stablecoin (USDC, USDSUI, suiUSDe, USDY, FDUSD, AUSD, USDB) drawn straight from the wallet — that MUST use the `sendStablecoin` tool instead (gasless, $0, no SUI). Use 'send' only for chained sends (swap→send), splitting one amount across recipients, or non-allowlisted tokens.\n\nOrigin — every step except cancelRedeemFromVault carries an `origin` object choosing EXACTLY ONE input shape (discriminator `from`):\n- `{ from: \"handle\", handle }` — consume an upstream step's whole output (split portion: `\"split1.0\"`).\n- `{ from: \"amount\", symbol, amount }` — a STATED quantity from the sender's balance (e.g. amount 300 for '300 USDC'). The plan targets this EXACT amount, so an insufficient balance shows up in the Guardian rather than failing the build. Use this whenever the user names a number.\n- `{ from: \"percent\", symbol, percent }` — a FRACTION of the live balance (100 = all, 50 = half, 25 = a quarter), resolved to the exact on-chain amount at build time (no dust, no overshoot). Use ONLY for 'all'/'everything'/'half'/'25%' phrasing — NEVER for a stated number. For SUI itself stay ≤ 99 to leave gas.\n- `{ from: \"handles\", handles, balanceSymbol?, balancePercent? }` — MERGE only: combine upstream coins, optionally folding in the wallet balance of the same token (balancePercent: 100 = add all of it).\ncancelRedeemFromVault takes no `origin` — it only needs vaultId + sequenceNumber.",
    inputSchema: z.object({
      steps: z.preprocess(
        coerceJsonArray,
        z
        .array(planStepSchema)
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
  createPaymentLink: tool({
    description:
      "Create a shareable PAYMENT LINK the user sends to someone to GET PAID — the inverse of a send. The recipient (who RECEIVES the funds) DEFAULTS to the user's own connected wallet; only set `recipient` when the user explicitly names someone else (a 0x address or SuiNS name). Use for 'create a payment link', 'make me a 5 USDC link', 'payment link for yoisha.sui titled Dinner', 'a tip jar link', 'request 20 USDC'. This only BUILDS the link — nothing is signed or on-chain; the client renders a card with a copyable URL + QR. The friend opens the link on a public page and pays from their wallet (gasless — they can even pay with a different token and Sprout swaps it to settle the exact requested token). Fixed amount → set `amount`; OPEN / tip-jar ('pay me whatever') → OMIT `amount`. The token is LITERAL — if you're not 100% sure an unfamiliar symbol resolves, call searchToken FIRST and copy its exact symbol; NEVER substitute a lookalike.",
    inputSchema: z.object({
      symbol: z
        .string()
        .describe(
          "Token the link requests — e.g. USDC, SUI. LITERAL: copy exactly; confirm unfamiliar tokens with searchToken before using.",
        ),
      amount: z
        .number()
        .positive()
        .optional()
        .describe(
          "Requested amount in human units (5 = 5 USDC). OMIT for an OPEN / tip-jar link where the payer chooses the amount.",
        ),
      recipient: z
        .string()
        .optional()
        .describe(
          "Who gets paid: a 0x address or SuiNS name (yoisha.sui / @yoisha). OMIT to default to the user's own connected wallet. Pass VERBATIM — never invent.",
        ),
      title: z
        .string()
        .max(80)
        .optional()
        .describe(
          "Short title/memo shown to the payer, e.g. 'Haidilao Meal', 'Coffee'.",
        ),
      expiryHours: z
        .number()
        .positive()
        .optional()
        .describe("Hours until the link expires. OMIT for no expiry."),
    }),
  }),
  placeDcaOrder: tool({
    description:
      "Set up a DCA (dollar-cost averaging) order on 7K: spend a pay token to accumulate a target token in equal tranches on a fixed schedule — works in BOTH directions (recurring BUY or recurring SELL). Use for 'DCA <amount> into <token>', 'buy <token> every <interval>', 'sell <token> over N weeks', 'DCA out of <token>', 'ladder/offload out of <token>', 'dollar-cost average', 'recurring buy/sell'.\n\nDIRECTION: paySymbol is the token that LEAVES the wallet (spent/sold); targetSymbol is the token received. 'DCA into X' / 'buy X' → target X, pay the funding token (USDC unless named). 'sell X' / 'DCA out of X' → pay X, target the proceeds token (USDC unless named). The amount is ALWAYS denominated in the PAY token (so 'sell 100 WAL' = paySymbol WAL, amountPerOrder 100). The FULL pay budget (per-order amount × number of orders) is locked up front into the order escrow when the user signs, then swapped tranche-by-tranche; cancelling later reclaims whatever hasn't been spent.\n\nThis only BUILDS the order — nothing is signed or on-chain until the user clicks 'Start DCA' in the card. After this tool, NEVER say it's started/done; say 'Ready — review and sign to start'.\n\nTokens are LITERAL (same rule as swaps): if you're not 100% sure an unfamiliar symbol resolves, call searchToken FIRST and copy the exact symbol; NEVER substitute a lookalike. Requires a connected wallet.\n\nPrice guards (optional): `maxPrice` / `minPrice` are the price of 1 TARGET expressed in PAY units (for a stablecoin pay token this ≈ the target's USD price). A guarded order only executes a tranche while the market price is within the band — so it may fill slowly or not complete.",
    inputSchema: z.object({
      paySymbol: z
        .string()
        .describe(
          "Token SPENT/SOLD each tranche — the one that LEAVES the wallet. For 'buy X with USDC' / 'DCA $N into X' this is the funding token (USDC); for 'sell X' / 'DCA out of X' this is X itself.",
        ),
      targetSymbol: z
        .string()
        .describe(
          "Token RECEIVED each tranche. For 'buy/DCA into X' this is X; for 'sell X' this is the proceeds token (USDC unless the user names another).",
        ),
      numOrders: z
        .number()
        .int()
        .min(2)
        .max(60)
        .describe("Total number of scheduled buys (2–60)."),
      intervalUnit: z
        .enum(["minute", "hour", "day", "week"])
        .describe("Schedule unit between buys."),
      intervalCount: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("How many units between buys (e.g. unit 'day' + count 1 = daily; count 2 = every other day)."),
      amountPerOrder: z
        .number()
        .positive()
        .optional()
        .describe(
          "Amount of the PAY token per tranche, human units (e.g. 50 when buying with 50 USDC each time; 100 when selling 100 WAL each time). Provide EXACTLY ONE of amountPerOrder or totalAmount.",
        ),
      totalAmount: z
        .number()
        .positive()
        .optional()
        .describe(
          "Total pay budget across ALL buys, human units (split evenly into numOrders). Provide EXACTLY ONE of amountPerOrder or totalAmount.",
        ),
      slippagePct: z
        .number()
        .min(0.1)
        .max(20)
        .optional()
        .describe("Per-tranche slippage tolerance in percent. Default 1."),
      maxPrice: z
        .number()
        .positive()
        .optional()
        .describe(
          "Only buy while 1 target costs AT MOST this many pay units (a price ceiling). For 'only buy SUI under $4' with USDC pay → 4.",
        ),
      minPrice: z
        .number()
        .positive()
        .optional()
        .describe(
          "Only buy while 1 target costs AT LEAST this many pay units (a price floor). Omit unless the user wants a lower bound.",
        ),
    }),
  }),
  getDcaOrders: tool({
    description:
      "Read an address's DCA orders on 7K: active/expired orders (pay→target pair, per-tranche amount, schedule, progress filled/total, amount bought so far, price band) and, with scope 'all', the execution history (each filled tranche). Defaults to the connected wallet; pass `address` for ANOTHER address. Use for 'show my DCA orders', 'my recurring buys', 'how's my DCA going', 'do I have any DCA running', or before cancelling one (to get its orderId). Errors only if no `address` is given and no wallet is connected.",
    inputSchema: z.object({
      address: z
        .string()
        .optional()
        .describe("Sui address (0x…) to read. Omit to use the connected wallet."),
      scope: z
        .enum(["open", "all"])
        .optional()
        .describe("'open' = active/expired orders (default). 'all' = also include execution history."),
    }),
  }),
  cancelDcaOrder: tool({
    description:
      "Cancel an existing DCA order, stopping future buys and returning the unspent pay funds to the wallet (already-bought target tokens stay). First call getDcaOrders to find the order, then pass its `orderId`. This only BUILDS the cancellation — the user signs it in the card; never say it's cancelled until a signed result. Requires a connected wallet that owns the order.",
    inputSchema: z.object({
      orderId: z
        .string()
        .describe("The on-chain order id (the `orderId` field from getDcaOrders)."),
    }),
  }),
};

export type ToolName = keyof typeof swapTools;
