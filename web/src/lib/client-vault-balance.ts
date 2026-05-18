"use client";

import { useEffect, useState, useCallback } from "react";
import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { fetchVaults } from "@/lib/client-vaults";
import { canonicalCoinType } from "@/lib/client-coins";
import type {
  VaultBalance,
  VaultBalanceServerData,
  VaultBalancePosition,
} from "@/lib/vault-balance";
import type { SuiVault } from "@/lib/vaults";

/**
 * Client-side build of the full VaultBalance payload:
 *   1. Fetch server-side withdrawals + history.
 *   2. Fetch on-chain token balances.
 *   3. Filter balances by receipt-coin types (from the vault list) → positions.
 * Mirrors runGetVaultBalance in conversation.tsx, but exposed as a React
 * hook so the portfolio page can render without going through the chat tool.
 */
export async function fetchVaultBalanceClient(
  address: string,
  client: ReturnType<typeof useSuiClient>,
): Promise<VaultBalance> {
  type RawBal = { coinType: string; totalBalance: string };

  const [serverRes, allBalances, vaults] = await Promise.all([
    fetch(`/api/vault-balance/${address}`, { cache: "no-store" }),
    client.getAllBalances({ owner: address }),
    fetchVaults(),
  ]);
  if (!serverRes.ok) {
    throw new Error(`vault-balance fetch failed: ${serverRes.status}`);
  }
  const server = (await serverRes.json()) as VaultBalanceServerData;

  // Build a receipt-type index from the vault list.
  type ReceiptEntry = { vault: SuiVault; receipt: string };
  const byReceipt = new Map<string, ReceiptEntry>();
  for (const v of vaults) {
    if (!v.receiptCoinType) continue;
    byReceipt.set(canonicalCoinType(v.receiptCoinType), {
      vault: v,
      receipt: v.receiptCoinType,
    });
  }

  const positions: VaultBalancePosition[] = [];
  for (const b of allBalances as RawBal[]) {
    if (BigInt(b.totalBalance) <= BigInt(0)) continue;
    const canon = canonicalCoinType(b.coinType);
    const match = byReceipt.get(canon);
    if (!match) continue;
    const v = match.vault;
    const shareDecimals = v.depositDecimals;
    const shares = Number(b.totalBalance) / 10 ** shareDecimals;
    const receiptPriceUsd = v.receiptCoinPriceUsd ?? 0;
    const positionValueUsd = Number((shares * receiptPriceUsd).toFixed(6));
    positions.push({
      vaultId: v.id,
      vaultName: v.name,
      vaultLogoUrl: v.logoUrl,
      depositSymbol: v.depositSymbol,
      depositCoinType: v.depositCoinType,
      apyPct: v.apyPct,
      category: v.category,
      withdrawalPeriodDays: v.withdrawalPeriodDays,
      receiptCoinType: canon,
      receiptCoinSymbol: v.receiptCoinSymbol,
      receiptPriceUsd,
      shares: Number(shares.toFixed(6)),
      positionValueUsd,
    });
  }
  positions.sort((a, b) => b.positionValueUsd - a.positionValueUsd);

  return { ...server, positions };
}

export type VaultBalanceState =
  | { status: "idle"; data?: undefined; error?: undefined }
  | { status: "loading"; data?: VaultBalance; error?: undefined }
  | { status: "ready"; data: VaultBalance; error?: undefined }
  | { status: "error"; error: string; data?: VaultBalance };

/**
 * React hook: load the connected wallet's vault balance + refresh it.
 * Returns the current state plus a `refresh()` callback.
 */
export function useVaultBalance(): {
  state: VaultBalanceState;
  refresh: () => void;
} {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const [state, setState] = useState<VaultBalanceState>({ status: "idle" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!account) {
      setState({ status: "idle" });
      return;
    }
    let alive = true;
    setState((prev) => {
      if (prev.status === "ready") {
        return { status: "loading", data: prev.data };
      }
      if (prev.status === "error" && prev.data) {
        return { status: "loading", data: prev.data };
      }
      return { status: "loading" };
    });
    fetchVaultBalanceClient(account.address, client)
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
  }, [account, client, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { state, refresh };
}
