"use client";

import type { Transaction } from "@mysten/sui/transactions";
import type { QuoteResponse } from "@bluefin-exchange/bluefin7k-aggregator-sdk";
import type { SuiVault } from "@/lib/vaults";

// ───────────────────────────────────────────────────────────────────────
// Generic action plan cache. Built by `runExecutePlan`, consumed by the
// LiveActionCard renderer + the confirm/sign handler. Holds the full
// assembled `Transaction` plus structured per-step metadata so the UI
// can render the plan and the receipt can reconcile actual outcomes.
// ───────────────────────────────────────────────────────────────────────

export type ResolvedSwapStep = {
  kind: "swap";
  id: string;
  fromSymbol: string;
  fromCoinType: string;
  fromDecimals: number;
  /** Human input amount. Known up front when the step originates from a
   *  fromSymbol+fromAmount; populated from upstream expectedHuman when the
   *  step consumes a fromHandle. */
  fromAmountHuman: number;
  toSymbol: string;
  toCoinType: string;
  toDecimals: number;
  /** Human output amount expected from the 7K quote. */
  toAmountHuman: number;
  slippagePct: number;
  hops: number;
  dexes: string[];
  impactPct?: number;
  quote: QuoteResponse;
  /** Coin-list verified flags for the Guardian token-verification risk row.
   *  Optional because chained-handle origins (e.g. split outputs, receipt
   *  tokens) may not resolve through the standard coin map. */
  fromVerified?: boolean;
  toVerified?: boolean;
  fromIcon?: string;
  toIcon?: string;
};

export type ResolvedSplitStep = {
  kind: "split";
  id: string;
  /** The source coin's symbol + token (one per split — must be uniform). */
  sourceSymbol: string;
  sourceCoinType: string;
  sourceDecimals: number;
  totalHuman: number;
  portions: Array<{ bps: number; human: number; raw: string }>;
};

export type ResolvedDepositStep = {
  kind: "deposit";
  id: string;
  vault: SuiVault;
  /** Source coin info — must equal the vault's deposit token. */
  sourceSymbol: string;
  sourceCoinType: string;
  sourceDecimals: number;
  amountHuman: number;
};

export type ResolvedMergeStep = {
  kind: "merge";
  id: string;
  /** Combined coin info (same across all sources). */
  symbol: string;
  coinType: string;
  decimals: number;
  /** Sum of contributions in human units. */
  totalHuman: number;
  /** Per-source description for the renderer. */
  sources: Array<{
    /** Either an upstream handle id, or "balance:<symbol>" for balance contributions. */
    label: string;
    human: number;
  }>;
};

export type ResolvedRedeemStep = {
  kind: "redeemFromVault";
  id: string;
  vault: SuiVault;
  /** Receipt-token info (the share coin being burned). */
  receiptSymbol: string;
  receiptCoinType: string;
  receiptDecimals: number;
  /** Human shares being redeemed. */
  sharesHuman: number;
};

export type ResolvedCancelRedeemStep = {
  kind: "cancelRedeemFromVault";
  id: string;
  vault: SuiVault;
  sequenceNumber: string;
};

export type ResolvedStep =
  | ResolvedSwapStep
  | ResolvedSplitStep
  | ResolvedMergeStep
  | ResolvedDepositStep
  | ResolvedRedeemStep
  | ResolvedCancelRedeemStep;

export type CachedActionPlan = {
  tx: Transaction;
  steps: ResolvedStep[];
  /** Human summary used by the renderer header. */
  summary: {
    swapCount: number;
    splitCount: number;
    depositCount: number;
    redeemCount: number;
    cancelCount: number;
    /** Vaults targeted by all deposit steps in order. */
    vaults: SuiVault[];
    /** Blended APY weighted by per-vault deposit human amount * deposit-token USD ≈ tvlUsd proxy. We just average across deposit steps for v1. */
    blendedApyPct: number;
    /** Heuristic gas estimate (SUI). */
    estimatedGasSui: number;
  };
  fetchedAt: number;
};

const cache = new Map<string, CachedActionPlan>();

export const actionPlanCache = {
  set(toolCallId: string, entry: CachedActionPlan) {
    cache.set(toolCallId, entry);
  },
  get(toolCallId: string): CachedActionPlan | undefined {
    return cache.get(toolCallId);
  },
  has(toolCallId: string): boolean {
    return cache.has(toolCallId);
  },
  delete(toolCallId: string) {
    cache.delete(toolCallId);
  },
};

// listCache stays here for now (renamed file but the listVaults flow
// is unchanged).

export type CachedVaultsList = {
  vaults: SuiVault[];
  filteredSymbol?: string;
};

const listCache = new Map<string, CachedVaultsList>();

export const vaultsListCache = {
  set(toolCallId: string, entry: CachedVaultsList) {
    listCache.set(toolCallId, entry);
  },
  get(toolCallId: string): CachedVaultsList | undefined {
    return listCache.get(toolCallId);
  },
};
