"use client";

import { useEffect, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { signedFetch } from "@/lib/api-client";
import type { TxActivity } from "@/lib/tx-history";

/**
 * Recent on-chain account activity (swaps / transfers / stakes) for the
 * connected wallet, via the signed /api/tx-history (Blockberry) proxy.
 * Refetches when the connected address changes; callers guard rendering on a
 * connected account, so we don't reset between fetches.
 */
export function useAccountActivity(limit = 12): TxActivity[] {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [items, setItems] = useState<TxActivity[]>([]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    signedFetch(`/api/tx-history?address=${address}&actionType=ALL&size=${limit}`)
      .then((r) => r.json())
      .then((body: { items?: TxActivity[]; error?: string }) => {
        if (!cancelled && !body.error) setItems(body.items ?? []);
      })
      .catch(() => {
        /* leave the last good result in place on a transient error */
      });
    return () => {
      cancelled = true;
    };
  }, [address, limit]);

  return items;
}
