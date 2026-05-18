import type { ResolvedStep } from "@/lib/ai/action-plan-cache";
import { canonicalCoinType } from "@/lib/client-coins";
import type { TokenHolding } from "@/lib/client-wallet";

export type CoinShortfall = {
  symbol: string;
  coinType: string;
  decimals: number;
  /** Human-unit amount the plan requires from the wallet. */
  required: number;
  /** Human-unit amount the wallet currently holds. */
  available: number;
  /** Human-unit deficit. Always > 0 when this record exists. */
  deficit: number;
};

export type BalanceCheck = {
  /** Shortfalls on the plan's wallet-funded INPUT coins (not gas-only). */
  inputShortfalls: CoinShortfall[];
  /** SUI gas shortfall when SUI is required ONLY for the network fee. */
  gasShortfall: CoinShortfall | null;
  hasAnyShortfall: boolean;
};

export type CoinRequirement = {
  symbol: string;
  coinType: string;
  decimals: number;
  /** Human-unit amount drawn from the wallet (already excluded of chained outputs). */
  amount: number;
};

const SUI_SYMBOL = "SUI";
const SUI_COIN_TYPE_CANON = canonicalCoinType("0x2::sui::SUI");

/** Float epsilon (matches TokenHolding's 6dp rounding) to avoid spurious shortfalls. */
const BALANCE_EPSILON = 1e-6;

function bumpRequirement(
  map: Map<string, CoinRequirement>,
  coinType: string,
  symbol: string,
  decimals: number,
  amount: number,
): void {
  if (amount <= 0) return;
  const canon = canonicalCoinType(coinType);
  const existing = map.get(canon);
  if (existing) {
    existing.amount += amount;
    return;
  }
  map.set(canon, { symbol, coinType: canon, decimals, amount });
}

/**
 * Walks the plan steps in execution order and accumulates per-coin wallet
 * draws. A step's input is considered "wallet-funded" only if no earlier
 * step produces the same coin type (in which case the input is chained
 * from the upstream output instead).
 *
 * Mirrors the planner's contract: only the FIRST coin-consuming step for a
 * given coin type pulls from the wallet; downstream steps that consume the
 * same coin type ride on chained outputs.
 */
export function computeWalletRequirements(
  steps: ResolvedStep[],
): CoinRequirement[] {
  const requirements = new Map<string, CoinRequirement>();
  const produced = new Set<string>();

  for (const step of steps) {
    switch (step.kind) {
      case "swap": {
        const fromCanon = canonicalCoinType(step.fromCoinType);
        if (!produced.has(fromCanon)) {
          bumpRequirement(
            requirements,
            step.fromCoinType,
            step.fromSymbol,
            step.fromDecimals,
            step.fromAmountHuman,
          );
        }
        produced.add(canonicalCoinType(step.toCoinType));
        break;
      }
      case "split": {
        const srcCanon = canonicalCoinType(step.sourceCoinType);
        if (!produced.has(srcCanon)) {
          bumpRequirement(
            requirements,
            step.sourceCoinType,
            step.sourceSymbol,
            step.sourceDecimals,
            step.totalHuman,
          );
        }
        // Split portions remain the same coin; routing only.
        produced.add(srcCanon);
        break;
      }
      case "deposit": {
        const srcCanon = canonicalCoinType(step.sourceCoinType);
        if (!produced.has(srcCanon)) {
          bumpRequirement(
            requirements,
            step.sourceCoinType,
            step.sourceSymbol,
            step.sourceDecimals,
            step.amountHuman,
          );
        }
        break;
      }
      case "merge": {
        // Merges with explicit "balance:" markers pull from the wallet.
        // Other sources reference upstream handles, which don't.
        for (const src of step.sources) {
          if (src.label.startsWith("balance:")) {
            bumpRequirement(
              requirements,
              step.coinType,
              step.symbol,
              step.decimals,
              src.human,
            );
          }
        }
        produced.add(canonicalCoinType(step.coinType));
        break;
      }
      case "redeemFromVault":
      case "cancelRedeemFromVault": {
        // No wallet draw; output is the vault's underlying but unbounded
        // for chain purposes (downstream consumers of redeem outputs are
        // out of scope for v1 — the planner doesn't emit them today).
        break;
      }
    }
  }

  return Array.from(requirements.values());
}

/**
 * Resolves a list of coin requirements + a gas estimate against the user's
 * wallet holdings, producing per-coin shortfalls.
 *
 * If SUI appears in both the requirement set and the gas estimate, the two
 * sum into a single SUI demand. The result categorises SUI shortfalls as
 * `gasShortfall` only when SUI is needed exclusively for the network fee.
 */
export function computeBalanceCheckFromRequirements(
  requirements: CoinRequirement[],
  estimatedGasSui: number,
  holdings: TokenHolding[],
): BalanceCheck {
  const merged = new Map<string, CoinRequirement>();
  for (const r of requirements) {
    bumpRequirement(merged, r.coinType, r.symbol, r.decimals, r.amount);
  }
  const suiInputBefore = merged.get(SUI_COIN_TYPE_CANON)?.amount ?? 0;
  const gasNeeded = Math.max(0, estimatedGasSui);
  if (gasNeeded > 0) {
    bumpRequirement(
      merged,
      SUI_COIN_TYPE_CANON,
      SUI_SYMBOL,
      9,
      gasNeeded,
    );
  }

  const holdingByType = new Map<string, TokenHolding>();
  for (const h of holdings) {
    holdingByType.set(canonicalCoinType(h.coinType), h);
  }

  const inputShortfalls: CoinShortfall[] = [];
  let gasShortfall: CoinShortfall | null = null;

  for (const r of merged.values()) {
    const held = holdingByType.get(r.coinType);
    const available = held?.balance ?? 0;
    if (available + BALANCE_EPSILON >= r.amount) continue;
    const shortfall: CoinShortfall = {
      symbol: r.symbol,
      coinType: r.coinType,
      decimals: r.decimals,
      required: r.amount,
      available,
      deficit: r.amount - available,
    };
    if (r.coinType === SUI_COIN_TYPE_CANON && suiInputBefore === 0) {
      gasShortfall = shortfall;
    } else {
      inputShortfalls.push(shortfall);
    }
  }

  return {
    inputShortfalls,
    gasShortfall,
    hasAnyShortfall: inputShortfalls.length > 0 || gasShortfall !== null,
  };
}

/**
 * Convenience wrapper for plan-shaped inputs (LiveVaultCard's `cached.steps`).
 */
export function computeBalanceCheck(
  steps: ResolvedStep[],
  estimatedGasSui: number,
  holdings: TokenHolding[],
): BalanceCheck {
  const requirements = computeWalletRequirements(steps);
  return computeBalanceCheckFromRequirements(
    requirements,
    estimatedGasSui,
    holdings,
  );
}
