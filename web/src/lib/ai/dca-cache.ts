"use client";

import type { Transaction } from "@mysten/sui/transactions";
import type { PlanRisk } from "@/lib/ai/action-plan-cache";
import type { DcaOrderView, DcaOrderExecutionView } from "@/lib/dca-orders";

// ───────────────────────────────────────────────────────────────────────
// DCA caches. Mirror action-plan-cache.ts: the built Transaction + display
// metadata live client-side keyed by toolCallId, so the agent's tool output
// stays a tiny URL/coin-free summary and the card + confirm handler read the
// rich data here. `dcaActionCache` is shared by the place + cancel actions so
// the confirm/sign path has a single lookup (next to gaslessSendCache).
// ───────────────────────────────────────────────────────────────────────

export type CachedDcaPlace = {
  kind: "place";
  tx: Transaction;
  paySymbol: string;
  payCoinType: string;
  payDecimals: number;
  payIcon?: string;
  targetSymbol: string;
  targetCoinType: string;
  targetDecimals: number;
  targetIcon?: string;
  amountPerOrderHuman: number;
  numOrders: number;
  intervalMs: number;
  totalLockedHuman: number;
  /** Approx wall-clock the schedule runs through (ms). */
  runsThroughMs: number;
  slippagePct: number;
  minPrice?: number;
  maxPrice?: number;
  /** False when the pay coin is SUI — coinWithBalance(SUI) contends with the
   *  Enoki gas coin, so those orders are wallet-paid. Drives the gas toggle. */
  sponsorEligible: boolean;
  risks: PlanRisk[];
  fetchedAt: number;
};

export type CachedDcaCancel = {
  kind: "cancel";
  tx: Transaction;
  orderId: string;
  paySymbol: string;
  payCoinType: string;
  payIcon?: string;
  targetSymbol: string;
  targetIcon?: string;
  /** Unspent pay reclaimed by the cancel. */
  remainingHuman: number;
  sponsorEligible: boolean;
  risks: PlanRisk[];
  fetchedAt: number;
};

export type CachedDcaAction = CachedDcaPlace | CachedDcaCancel;

const actionMap = new Map<string, CachedDcaAction>();
export const dcaActionCache = {
  set(toolCallId: string, entry: CachedDcaAction) {
    actionMap.set(toolCallId, entry);
  },
  get(toolCallId: string): CachedDcaAction | undefined {
    return actionMap.get(toolCallId);
  },
  has(toolCallId: string): boolean {
    return actionMap.has(toolCallId);
  },
  delete(toolCallId: string) {
    actionMap.delete(toolCallId);
  },
};

export type CachedDcaOrders = {
  orders: DcaOrderView[];
  history: DcaOrderExecutionView[];
  address: string;
};

const ordersMap = new Map<string, CachedDcaOrders>();
export const dcaOrdersCache = {
  set(toolCallId: string, entry: CachedDcaOrders) {
    ordersMap.set(toolCallId, entry);
  },
  get(toolCallId: string): CachedDcaOrders | undefined {
    return ordersMap.get(toolCallId);
  },
  /** Most-recently-fetched order list — runCancelDca looks here first to
   *  resolve an orderId's coin types without a refetch. */
  latest(): CachedDcaOrders | undefined {
    let last: CachedDcaOrders | undefined;
    for (const v of ordersMap.values()) last = v;
    return last;
  },
};
