"use client";

import type { Transaction } from "@mysten/sui/transactions";
import type { SuiVault } from "@/lib/vaults";
import type { TxActivity } from "@/lib/tx-history";
import type { AccountTxView } from "@/lib/account-transactions";
import type { TransactionDetailView } from "@/lib/transaction-detail";
import type {
  CoinListItem,
  CoinMetadata,
  CoinHolder,
} from "@/lib/blockberry-coins";

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
  /** Winning 7K Meta Aggregator provider ("bluefin7k" | "cetus" | "flowx"). */
  provider: string;
  /** How much better the winner's output was vs the runner-up (percent). */
  rateImprovementPct?: number;
  /** The runner-up provider the winner beat (when more than one quoted). */
  comparedProvider?: string;
  /** Per-path route breakdown: split % + each hop's venue and tokens. */
  routeSplits?: {
    sharePct: number;
    hops: { dex: string; tokenIn?: string; tokenOut?: string }[];
  }[];
  /** Raw winning provider quote (shape varies by provider). */
  quote?: unknown;
  /** Coin-list verified flags for the Guardian token-verification risk row.
   *  Optional because chained-handle origins (e.g. split outputs, receipt
   *  tokens) may not resolve through the standard coin map. */
  fromVerified?: boolean;
  toVerified?: boolean;
  fromIcon?: string;
  toIcon?: string;
  /** Set when the swap's input is a vault receipt/share token. Drives the
   *  Guardian "vault token swap" flag — redeeming through the vault usually
   *  beats selling the share on the open market. */
  fromVault?: { vaultName: string; depositSymbol: string };
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

export type ResolvedSendStep = {
  kind: "send";
  id: string;
  /** Coin being transferred out. */
  symbol: string;
  coinType: string;
  decimals: number;
  amountHuman: number;
  /** Resolved 0x recipient address (normalized). */
  recipient: string;
  /** Original SuiNS name, when the user gave one (for display + confirmation). */
  recipientName?: string;
};

export type ResolvedStep =
  | ResolvedSwapStep
  | ResolvedSplitStep
  | ResolvedMergeStep
  | ResolvedDepositStep
  | ResolvedRedeemStep
  | ResolvedCancelRedeemStep
  | ResolvedSendStep;

/** Raw step shape the agent emits via executePlan. Stashed on the cache
 *  so the slippage-rebuild flow can re-run the whole plan. */
export type RawStep = {
  kind:
    | "swap"
    | "split"
    | "merge"
    | "deposit"
    | "redeemFromVault"
    | "cancelRedeemFromVault"
    | "send";
  id: string;
  fromHandle?: string;
  fromHandles?: string[];
  fromSymbol?: string;
  fromAmount?: number;
  /** Draw this percent (0–100) of the wallet's `fromSymbol` balance instead of
   *  a fixed `fromAmount`. Resolved to an exact raw amount from the live
   *  on-chain balance at build time — 100 = entire balance, no rounding dust. */
  fromPercent?: number;
  toSymbol?: string;
  slippagePct?: number;
  portionsBps?: number[];
  vaultId?: string;
  sequenceNumber?: string;
  /** (send only) 0x address or SuiNS name (e.g. yoisha.sui) to transfer to. */
  recipient?: string;
};

/** Agent-authored plan risk, rendered as a Guardian row. */
export type PlanRisk = {
  title: string;
  note: string;
  level: "pass" | "flag" | "block";
};

export type CachedActionPlan = {
  tx: Transaction;
  steps: ResolvedStep[];
  /** Source-of-truth step list the agent emitted. Used to rebuild the
   *  plan when the user adjusts slippage. */
  originalInput: RawStep[];
  /** Agent's per-plan risk assessment (executePlan `risks`). Rendered by the
   *  Guardian; preserved across silent slippage rebuilds. */
  risks?: PlanRisk[];
  /** Human summary used by the renderer header. */
  summary: {
    swapCount: number;
    splitCount: number;
    depositCount: number;
    redeemCount: number;
    cancelCount: number;
    sendCount: number;
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

// Rich tx-history kept client-side (with icon URLs the CARD needs) so the
// agent's tool output can stay a pruned, URL-free summary. Keyed by toolCallId.
export type CachedTxHistory = {
  items: TxActivity[];
  address: string;
  hasNextPage: boolean;
};

const txCache = new Map<string, CachedTxHistory>();

export const txHistoryCache = {
  set(toolCallId: string, entry: CachedTxHistory) {
    txCache.set(toolCallId, entry);
  },
  get(toolCallId: string): CachedTxHistory | undefined {
    return txCache.get(toolCallId);
  },
};

// Same split for the raw transaction list (humanized coin chips the card needs).
export type CachedAccountTxs = {
  items: AccountTxView[];
  address: string;
  hasNextPage: boolean;
};

const accountTxsCache = new Map<string, CachedAccountTxs>();

export const accountTxCache = {
  set(toolCallId: string, entry: CachedAccountTxs) {
    accountTxsCache.set(toolCallId, entry);
  },
  get(toolCallId: string): CachedAccountTxs | undefined {
    return accountTxsCache.get(toolCallId);
  },
};

// Single-transaction detail (humanized net change + activities w/ icons).
const txDetailMap = new Map<string, TransactionDetailView>();

export const txDetailCache = {
  set(toolCallId: string, entry: TransactionDetailView) {
    txDetailMap.set(toolCallId, entry);
  },
  get(toolCallId: string): TransactionDetailView | undefined {
    return txDetailMap.get(toolCallId);
  },
};

// Blockberry coin tools — rich data (icons) kept client-side for the cards.
export type CachedCoinList = { items: CoinListItem[]; sortBy: string };
const coinListMap = new Map<string, CachedCoinList>();
export const coinListCache = {
  set(id: string, entry: CachedCoinList) {
    coinListMap.set(id, entry);
  },
  get(id: string): CachedCoinList | undefined {
    return coinListMap.get(id);
  },
};

// Gasless stablecoin transfer — holds the built Transaction + display metadata
// for the card and the confirm/execute handler. Keyed by toolCallId.
export type CachedGaslessSend = {
  tx: Transaction;
  symbol: string;
  coinType: string;
  decimals: number;
  amountHuman: number;
  recipient: string;
  recipientName?: string;
  fetchedAt: number;
};
const gaslessSendMap = new Map<string, CachedGaslessSend>();
export const gaslessSendCache = {
  set(id: string, entry: CachedGaslessSend) {
    gaslessSendMap.set(id, entry);
  },
  get(id: string): CachedGaslessSend | undefined {
    return gaslessSendMap.get(id);
  },
};

const coinMetaMap = new Map<string, CoinMetadata>();
export const coinMetadataCache = {
  set(id: string, entry: CoinMetadata) {
    coinMetaMap.set(id, entry);
  },
  get(id: string): CoinMetadata | undefined {
    return coinMetaMap.get(id);
  },
};

export type CachedCoinHolders = {
  items: CoinHolder[];
  symbol: string;
  coinType: string;
};
const coinHoldersMap = new Map<string, CachedCoinHolders>();
export const coinHoldersCache = {
  set(id: string, entry: CachedCoinHolders) {
    coinHoldersMap.set(id, entry);
  },
  get(id: string): CachedCoinHolders | undefined {
    return coinHoldersMap.get(id);
  },
};
