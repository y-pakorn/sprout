"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { signedFetch } from "@/lib/api-client";
import { fetchCoinMap, useCoinMap } from "@/lib/client-coins";
import {
  enrichDcaOrders,
  enrichDcaExecutions,
  type DcaOrderView,
  type DcaOrderExecutionView,
  type RawDcaOrder,
  type RawDcaExecution,
} from "@/lib/dca-orders";

/**
 * Client-side fetch of a wallet's DCA orders (+ history), enriched into the
 * view shape the cards/portfolio render. Mirrors fetchVaultBalanceClient —
 * exposed as both a plain async fn (chat tool) and a hook (portfolio).
 */
export async function fetchDcaOrdersClient(
  address: string,
  scope: "open" | "all" = "all",
): Promise<{ orders: DcaOrderView[]; history: DcaOrderExecutionView[] }> {
  const [res, map] = await Promise.all([
    signedFetch(`/api/dca-orders?owner=${address}&scope=${scope}`, {
      cache: "no-store",
    }),
    fetchCoinMap(),
  ]);
  if (!res.ok) throw new Error(`dca-orders fetch failed: ${res.status}`);
  const data = (await res.json()) as {
    open: RawDcaOrder[];
    history: RawDcaExecution[];
  };
  return {
    orders: enrichDcaOrders(data.open ?? [], map),
    history: enrichDcaExecutions(data.history ?? [], map),
  };
}

export type DcaOrdersState =
  | { status: "idle"; data?: undefined; error?: undefined }
  | {
      status: "loading";
      data?: { orders: DcaOrderView[]; history: DcaOrderExecutionView[] };
      error?: undefined;
    }
  | {
      status: "ready";
      data: { orders: DcaOrderView[]; history: DcaOrderExecutionView[] };
      error?: undefined;
    }
  | {
      status: "error";
      error: string;
      data?: { orders: DcaOrderView[]; history: DcaOrderExecutionView[] };
    };

/** React hook: load the connected wallet's DCA orders + refresh. */
export function useDcaOrders(): {
  state: DcaOrdersState;
  refresh: () => void;
} {
  const account = useCurrentAccount();
  const coinMap = useCoinMap();
  const [state, setState] = useState<DcaOrdersState>({ status: "idle" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!account || !coinMap) {
      if (!account) setState({ status: "idle" });
      return;
    }
    let alive = true;
    setState((prev) =>
      prev.status === "ready" || (prev.status === "error" && prev.data)
        ? { status: "loading", data: prev.data }
        : { status: "loading" },
    );
    fetchDcaOrdersClient(account.address, "all")
      .then((data) => {
        if (alive) setState({ status: "ready", data });
      })
      .catch((err: Error) => {
        if (alive)
          setState((prev) => ({
            status: "error",
            error: err.message,
            data: prev.data,
          }));
      });
    return () => {
      alive = false;
    };
  }, [account, coinMap, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { state, refresh };
}
