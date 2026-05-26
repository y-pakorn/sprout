// Account transaction-list types + normalizer for Blockberry's
// getAccountTransactions endpoint. Pure (no React, no secrets) — shared by the
// proxy route and the AccountTransactionsCard.
//
// Unlike getAccountActivity (semantic, decoded amounts), this is tx-level: tx
// type, the Move functions called, the packages/protocols touched, fee, and RAW
// signed balance changes (humanized client-side via the coin map — see the
// runGetAccountTransactions handler).

import type { TxCoin } from "@/lib/tx-history";

/** A signed raw balance delta (smallest units, as a string). */
export type RawBalanceChange = { coinType: string; rawAmount: string };

/** Route-shaped tx record (raw balance changes). */
export type AccountTx = {
  digest: string;
  txType: string;
  functions: string[];
  status: string;
  feeSui: number;
  timestampMs: number;
  txsCount: number;
  protocol?: { name?: string; img?: string };
  balanceChanges: RawBalanceChange[];
};

/** Client/card-shaped record — balance changes humanized into coin chips. */
export type AccountTxView = Omit<AccountTx, "balanceChanges"> & {
  coins: TxCoin[];
};

export type AccountTxResult = {
  count: number;
  hasNextPage: boolean;
  items: AccountTx[];
  error?: string;
};

// ---- raw upstream shapes (subset) ------------------------------------------

type RawPackage = {
  name: string | null;
  imgUrl: string | null;
  projectName: string | null;
  projectImg: string | null;
};

type RawBalanceChangeUpstream = { coinType: string; amount: string | number };

export type RawTransaction = {
  txHash: string;
  txType: string | null;
  functions: string[] | null;
  txStatus: string;
  fee: number;
  timestamp: number;
  txsCount: number | null;
  packagesMetadata: RawPackage[] | null;
  balanceChanges: RawBalanceChangeUpstream[] | null;
};

export type RawTransactionsResponse = {
  content: RawTransaction[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

// ---- normalization ---------------------------------------------------------

function protocolOf(pkgs: RawPackage[]): AccountTx["protocol"] | undefined {
  const named =
    pkgs.find((p) => p.projectName && p.projectImg) ??
    pkgs.find((p) => p.projectName) ??
    pkgs.find((p) => p.name);
  if (!named) return undefined;
  return {
    name: named.projectName ?? named.name ?? undefined,
    img: named.projectImg ?? named.imgUrl ?? undefined,
  };
}

export function normalizeTransaction(raw: RawTransaction): AccountTx {
  return {
    digest: raw.txHash,
    txType: raw.txType ?? "Transaction",
    functions: raw.functions ?? [],
    status: raw.txStatus ?? "",
    feeSui: Number.isFinite(raw.fee) ? raw.fee : 0,
    timestampMs: Number.isFinite(raw.timestamp) ? raw.timestamp : 0,
    txsCount: raw.txsCount ?? 0,
    protocol: protocolOf(raw.packagesMetadata ?? []),
    balanceChanges: (raw.balanceChanges ?? []).map((b) => ({
      coinType: b.coinType,
      rawAmount: String(b.amount),
    })),
  };
}
