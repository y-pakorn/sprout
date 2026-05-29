import { z } from "zod";
import type { RawStep } from "@/lib/ai/action-plan-cache";

/**
 * ORIGIN — how a plan step gets its input coin.
 *
 * Modeled as a discriminated union on `from` so the amount-vs-percent choice
 * is EXPLICIT and a step can never carry conflicting origin fields. This is
 * the model-facing contract; the PTB builder consumes the flat `RawStep`
 * shape, and `adaptPlanSteps()` maps these variants onto it.
 *
 *   from:"amount"  → a STATED quantity ("300 USDC", "send 5"). The plan always
 *                    targets this exact amount, so a shortfall surfaces in the
 *                    Guardian's "Insufficient balance" row instead of crashing
 *                    the build. (A percent of a zero balance resolves to 0,
 *                    which has nothing to flag and nothing to fund — that
 *                    asymmetry is why a named quantity must be `amount`.)
 *   from:"percent" → a FRACTION of the live balance ("all"/"half"/"25%";
 *                    100 = the entire balance), resolved to the exact on-chain
 *                    amount at build time (no dust, no overshoot).
 *   from:"handle"  → consume a prior step's whole output (split portion uses
 *                    "<splitId>.<index>", e.g. "split1.0").
 *   from:"handles" → MERGE only: combine ≥1 upstream coins, optionally folding
 *                    in the wallet balance of the same token.
 */
export const planOriginSchema = z.discriminatedUnion("from", [
  z.object({
    from: z.literal("handle"),
    handle: z
      .string()
      .min(1)
      .describe(
        "Upstream step id whose output coin this step consumes whole. For a split portion use '<splitId>.<index>', e.g. 'split1.0'.",
      ),
  }),
  z.object({
    from: z.literal("amount"),
    symbol: z
      .string()
      .min(1)
      .describe("Token symbol drawn from the sender's balance, e.g. USDC."),
    amount: z
      .number()
      .positive()
      .describe(
        "A STATED quantity in human units — e.g. 300 for '300 USDC', 5 for 'send 5'. Use this whenever the user names a number. The plan targets this EXACT amount, so an insufficient balance is surfaced by the Guardian rather than failing the build.",
      ),
  }),
  z.object({
    from: z.literal("percent"),
    symbol: z
      .string()
      .min(1)
      .describe("Token symbol drawn from the sender's balance, e.g. SUI."),
    percent: z
      .number()
      .gt(0)
      .max(100)
      .describe(
        "A FRACTION of the live balance: 100 = the ENTIRE balance, 50 = half, 25 = a quarter. Use ONLY for 'all'/'everything'/'half'/'25%' phrasing — NEVER for a stated number (use `amount` for that). Resolved to the exact on-chain amount at build time (no dust, no overshoot). For SUI itself stay ≤ 99 to leave gas.",
      ),
  }),
  z.object({
    from: z.literal("handles"),
    handles: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        "(merge only) Upstream handle ids to combine into one coin. All MUST be the same token type.",
      ),
    balanceSymbol: z
      .string()
      .optional()
      .describe(
        "(merge only) Also fold in the sender's wallet balance of this token, on top of `handles`.",
      ),
    balancePercent: z
      .number()
      .gt(0)
      .max(100)
      .optional()
      .describe(
        "(merge only) Percent of `balanceSymbol` to fold in — use 100 to add the ENTIRE existing balance (the usual case for consolidation).",
      ),
    balanceAmount: z
      .number()
      .positive()
      .optional()
      .describe(
        "(merge only) A stated amount of `balanceSymbol` to fold in. Prefer balancePercent: 100 unless the user named a specific number.",
      ),
  }),
]);

export type PlanOrigin = z.infer<typeof planOriginSchema>;

/** One executePlan step as the MODEL emits it (origin is a tagged union). */
export const planStepSchema = z.object({
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
      "Short unique id for this step, referenced by downstream steps via origin from:'handle'. Example: 'swap1', 'split1'.",
    ),
  origin: planOriginSchema
    .optional()
    .describe(
      "How this step gets its input coin — pick EXACTLY ONE variant. Required for swap / split / merge / deposit / redeemFromVault / send; OMIT for cancelRedeemFromVault (it only needs vaultId + sequenceNumber).",
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
    .describe("(swap only) slippage tolerance in percent. Default 1."),
  portionsBps: z
    .array(z.number().int().min(1).max(10000))
    .min(2)
    .max(10)
    .optional()
    .describe("(split only) Per-portion bps, MUST sum to exactly 10000."),
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
      "(send only) Where to transfer the coin: a 0x address or a SuiNS name (e.g. yoisha.sui / @yoisha). Resolved at build time; pass the user's address/name VERBATIM — never invent one.",
    ),
});

export type ExecutePlanStep = z.infer<typeof planStepSchema>;

/**
 * Map model-facing union steps onto the builder's flat `RawStep` shape.
 *
 * A step with no `origin` (cancelRedeemFromVault) passes through unchanged —
 * the builder's cancel branch needs only vaultId + sequenceNumber. Every other
 * kind carries an origin, which expands to the flat fromHandle / fromSymbol+
 * fromAmount / fromSymbol+fromPercent / fromHandles(+balance) fields the
 * builder already understands. Pure and deterministic, so the silent slippage
 * rebuild (which re-runs this on the cached union steps) produces an identical
 * plan.
 */
export function adaptPlanSteps(steps: ExecutePlanStep[]): RawStep[] {
  return steps.map((step): RawStep => {
    const { origin, ...rest } = step;
    const base = rest as RawStep;
    if (!origin) return base;
    switch (origin.from) {
      case "handle":
        return { ...base, fromHandle: origin.handle };
      case "amount":
        return { ...base, fromSymbol: origin.symbol, fromAmount: origin.amount };
      case "percent":
        return {
          ...base,
          fromSymbol: origin.symbol,
          fromPercent: origin.percent,
        };
      case "handles":
        return {
          ...base,
          fromHandles: origin.handles,
          ...(origin.balanceSymbol != null
            ? { fromSymbol: origin.balanceSymbol }
            : {}),
          ...(origin.balanceAmount != null
            ? { fromAmount: origin.balanceAmount }
            : {}),
          ...(origin.balancePercent != null
            ? { fromPercent: origin.balancePercent }
            : {}),
        };
      default: {
        // Exhaustiveness guard — a new origin variant must be handled above.
        const _exhaustive: never = origin;
        return _exhaustive;
      }
    }
  });
}
