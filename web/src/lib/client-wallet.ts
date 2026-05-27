"use client";

import { useEffect, useState, useCallback } from "react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { fetchAllBalances, type CoreClientLike } from "@/lib/grpc-balances";
import { getTokenPrices } from "@/lib/bluefin7k";
import {
  useCoinMap,
  canonicalCoinType,
  type CoinMap,
} from "@/lib/client-coins";
import { loadVaultReceiptIndex } from "@/lib/vault-receipt-index";

export type TokenHolding = {
  symbol: string;
  coinType: string;
  decimals: number;
  balance: number;
  /** True when the token is in the verified coin map (has a known symbol). */
  known: boolean;
  /** True when this is a vault receipt/share token (ercUSD, eACRED, …). It is
   *  a real, swappable balance — included here so the plan balance-check can
   *  see it — but display surfaces (portfolio) hide it and show the position
   *  instead, so filter on this flag when listing/summing plain holdings. */
  isVaultReceipt?: boolean;
  priceUsd?: number;
  valueUsd?: number;
  iconUrl?: string;
};

/**
 * Reads all non-zero wallet balances, filters out vault receipt tokens
 * (those are tracked as positions, not loose holdings), attaches USD
 * prices via the 7K oracle. Pure helper — no React.
 */
export async function fetchWalletHoldings(
  address: string,
  client: CoreClientLike,
  coinMap: CoinMap | null,
): Promise<TokenHolding[]> {
  type RawBal = { coinType: string; totalBalance: string };

  const [allBalances, receiptIndex] = await Promise.all([
    fetchAllBalances(client, address),
    loadVaultReceiptIndex().catch(
      () => new Map() as Awaited<ReturnType<typeof loadVaultReceiptIndex>>,
    ),
  ]);
  // Index the known coin map by canonical coin type.
  const byType = new Map<
    string,
    { symbol: string; decimals: number; iconUrl?: string }
  >();
  if (coinMap) {
    for (const [symbol, info] of Object.entries(coinMap)) {
      byType.set(canonicalCoinType(info.coin_type), {
        symbol,
        decimals: info.decimals,
        iconUrl: info.icon_url,
      });
    }
  }

  // Build initial holdings array (without prices yet). Receipt/share tokens
  // are REAL swappable balances, so include them too (tagged) — the balance
  // check needs to see them. They use the vault's share decimals + the
  // receipt-share USD price (the 7K oracle drops receipt coins).
  const holdings: TokenHolding[] = (allBalances as RawBal[])
    .filter((b) => BigInt(b.totalBalance) > BigInt(0))
    .map((b): TokenHolding => {
      const canon = canonicalCoinType(b.coinType);
      const receipt = receiptIndex.get(canon);
      const known = byType.get(canon);
      const decimals = receipt?.shareDecimals ?? known?.decimals ?? 9;
      const balance = Number(b.totalBalance) / 10 ** decimals;
      const holding: TokenHolding = {
        symbol: receipt
          ? canon.split("::").pop() ?? "?"
          : known?.symbol ?? b.coinType.split("::").pop() ?? "?",
        coinType: canon,
        decimals,
        balance: Number(balance.toFixed(6)),
        known: !!known || !!receipt,
        isVaultReceipt: !!receipt,
        iconUrl: known?.iconUrl ?? receipt?.position.logoUrl,
      };
      if (receipt?.position.receiptPriceUsd) {
        holding.priceUsd = receipt.position.receiptPriceUsd;
        holding.valueUsd = Number(
          (balance * receipt.position.receiptPriceUsd).toFixed(6),
        );
      }
      return holding;
    });

  // Batch oracle prices.
  const priceQueryTypes = Array.from(new Set(holdings.map((h) => h.coinType)));
  const priceMap = await getTokenPrices(priceQueryTypes).catch(
    () => ({}) as Record<string, number>,
  );
  for (const h of holdings) {
    const p = priceMap[h.coinType];
    if (typeof p === "number" && Number.isFinite(p) && p > 0) {
      h.priceUsd = p;
      h.valueUsd = Number((h.balance * p).toFixed(6));
    }
  }

  // Known + valued tokens first, then by USD value desc, then by amount.
  holdings.sort((a, b) => {
    const aRank = a.known ? 1 : 0;
    const bRank = b.known ? 1 : 0;
    if (aRank !== bRank) return bRank - aRank;
    const av = a.valueUsd ?? 0;
    const bv = b.valueUsd ?? 0;
    if (av !== bv) return bv - av;
    return b.balance - a.balance;
  });

  return holdings;
}

type State =
  | { status: "idle"; data?: undefined; error?: undefined }
  | { status: "loading"; data?: TokenHolding[]; error?: undefined }
  | { status: "ready"; data: TokenHolding[]; error?: undefined }
  | { status: "error"; error: string; data?: TokenHolding[] };

/** React hook — loads + auto-refreshes (via `refresh()`) the wallet holdings. */
export function useWalletHoldings(): {
  state: State;
  refresh: () => void;
} {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const coinMap = useCoinMap();
  const [state, setState] = useState<State>({ status: "idle" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!account) {
      setState({ status: "idle" });
      return;
    }
    let alive = true;
    setState((prev) => ({
      status: "loading",
      data: prev.status === "ready" ? prev.data : prev.data,
    }));
    fetchWalletHoldings(account.address, client, coinMap)
      .then((data) => {
        if (alive) setState({ status: "ready", data });
      })
      .catch((err: Error) => {
        if (alive)
          setState((prev) => ({
            status: "error",
            error: err.message,
            data:
              prev.status === "ready" ||
              prev.status === "loading" ||
              prev.status === "error"
                ? prev.data
                : undefined,
          }));
      });
    return () => {
      alive = false;
    };
  }, [account, client, coinMap, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { state, refresh };
}
