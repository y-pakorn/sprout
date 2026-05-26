// Transaction-detail types + cleaner for Suiscan's raw-transaction/{digest}/details.
//
// The upstream payload is ~55KB: a full JSON-RPC tx block under
// `rawTransaction.result`, a big object-metadata map, and `activityMetadata`
// (the decoded per-hop actions). We DROP the raw blob + metadata map and keep
// only: basic tx detail (from rawTransaction.result) + cleaned activities.
// Pure (no React, no secrets) — runs in the proxy route; types reused by the card.

import type { TxCoin } from "@/lib/tx-history";

/** One decoded action within the tx (e.g. a single swap hop). */
export type DetailActivity = {
  activity: string;
  protocol?: { name?: string; img?: string };
  coins: TxCoin[]; // signed, already decimalized by the upstream
};

/** Route-shaped detail (net balance changes still raw — humanized client-side). */
export type TransactionDetail = {
  digest: string;
  status: string; // SUCCESS | FAILURE
  network: string;
  timestampMs: number;
  checkpoint?: number;
  sender: string;
  gasFeeSui: number;
  gasBudgetSui?: number;
  commandCount: number;
  eventCount: number;
  objectChangeCount: number;
  netBalanceChanges: { coinType: string; rawAmount: string }[];
  activities: DetailActivity[];
};

/** Card/cache-shaped detail — net balance changes humanized into coin chips. */
export type TransactionDetailView = Omit<TransactionDetail, "netBalanceChanges"> & {
  netChange: TxCoin[];
};

// ---- raw upstream shapes (subset) ------------------------------------------

type RawDetailCoin = {
  amount: number;
  coinType: string;
  iconUrl: string | null;
  symbol: string | null;
  coinSeq?: number;
};

type RawDetailWith = {
  name: string | null;
  image: string | null;
  projectName: string | null;
  projectImage: string | null;
};

type RawActivityMeta = {
  activityType: string[] | null;
  details: { type?: string; detailsDto?: { coins?: RawDetailCoin[] } } | null;
  activityWith: RawDetailWith[] | null;
};

type RawResult = {
  digest?: string;
  transaction?: {
    data?: {
      sender?: string;
      gasData?: { budget?: string | number };
      transaction?: { transactions?: unknown[] };
    };
  };
  effects?: {
    status?: { status?: string };
    gasUsed?: {
      computationCost?: string | number;
      storageCost?: string | number;
      storageRebate?: string | number;
    };
  };
  events?: unknown[];
  objectChanges?: unknown[];
  balanceChanges?: { coinType: string; amount: string | number }[];
  timestampMs?: string | number;
  checkpoint?: string | number;
};

export type RawTxDetailResponse = {
  rawTransaction?: { result?: RawResult };
  activityMetadata?: RawActivityMeta[];
  status?: string;
};

// ---- cleaning --------------------------------------------------------------

const num = (v: string | number | undefined | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function protocolOf(list: RawDetailWith[]): DetailActivity["protocol"] | undefined {
  const named =
    list.find((w) => w.projectName && w.projectImage) ??
    list.find((w) => w.projectName) ??
    list.find((w) => w.name);
  if (!named) return undefined;
  return {
    name: named.projectName ?? named.name ?? undefined,
    img: named.projectImage ?? named.image ?? undefined,
  };
}

function cleanActivity(a: RawActivityMeta): DetailActivity {
  const types = a.activityType ?? [];
  const coins: TxCoin[] = (a.details?.detailsDto?.coins ?? [])
    .slice()
    .sort((x, y) => (x.coinSeq ?? 0) - (y.coinSeq ?? 0))
    .map((c) => ({
      symbol: c.symbol ?? c.coinType?.split("::").pop() ?? "?",
      amount: Number.isFinite(c.amount) ? c.amount : 0,
      iconUrl: c.iconUrl ?? undefined,
    }));
  return {
    activity: types.length ? types.join(" / ") : a.details?.type ?? "Activity",
    protocol: protocolOf(a.activityWith ?? []),
    coins,
  };
}

export function cleanTransactionDetail(
  raw: RawTxDetailResponse,
  digestFallback: string,
  network = "mainnet",
): TransactionDetail {
  const result = raw.rawTransaction?.result ?? {};
  const data = result.transaction?.data ?? {};
  const effects = result.effects ?? {};
  const gas = effects.gasUsed ?? {};
  const gasMist =
    num(gas.computationCost) + num(gas.storageCost) - num(gas.storageRebate);
  const cmds = data.transaction?.transactions;

  return {
    digest: result.digest ?? digestFallback,
    status: String(effects.status?.status ?? raw.status ?? "").toUpperCase(),
    network,
    timestampMs: num(result.timestampMs),
    checkpoint: result.checkpoint != null ? num(result.checkpoint) : undefined,
    sender: data.sender ?? "",
    gasFeeSui: gasMist / 1e9,
    gasBudgetSui: data.gasData?.budget != null ? num(data.gasData.budget) / 1e9 : undefined,
    commandCount: Array.isArray(cmds) ? cmds.length : 0,
    eventCount: Array.isArray(result.events) ? result.events.length : 0,
    objectChangeCount: Array.isArray(result.objectChanges)
      ? result.objectChanges.length
      : 0,
    netBalanceChanges: (result.balanceChanges ?? []).map((b) => ({
      coinType: b.coinType,
      rawAmount: String(b.amount),
    })),
    activities: (raw.activityMetadata ?? []).map(cleanActivity),
  };
}
