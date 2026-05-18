"use client";

import { useEffect, useState } from "react";
import type {
  SuiVault,
  VaultDeployment,
  VaultHistoryMetric,
  VaultHistoryResponse,
} from "./vaults";

// Bluefin's vault API is CORS-locked to https://trade.bluefin.io, so the
// browser can't hit it directly — we proxy through our own Next routes.
// The shape mapping happens server-side in lib/vaults.ts.

let cached: SuiVault[] | null = null;
let inflight: Promise<SuiVault[]> | null = null;

export async function fetchVaults(): Promise<SuiVault[]> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch("/api/vaults", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`vaults fetch failed: ${r.status}`);
      return r.json() as Promise<SuiVault[]>;
    })
    .then((list) => {
      cached = list;
      inflight = null;
      console.log("[client-vaults] loaded", list.length, "Sui vaults");
      return list;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

export function useVaults(): SuiVault[] | null {
  const [list, setList] = useState<SuiVault[] | null>(cached);
  useEffect(() => {
    if (cached) {
      setList(cached);
      return;
    }
    let alive = true;
    fetchVaults().then((v) => {
      if (alive) setList(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

export function resolveVault(
  list: SuiVault[] | null,
  vaultId: string,
): SuiVault | undefined {
  if (!list) return undefined;
  return list.find((v) => v.id === vaultId);
}

// Vault deployment (Move package + ProtocolConfig shared object). Static
// per network — fetched once per page, cached forever.
let cachedDeployment: VaultDeployment | null = null;
let inflightDeployment: Promise<VaultDeployment> | null = null;

export async function fetchDeployment(): Promise<VaultDeployment> {
  if (cachedDeployment) return cachedDeployment;
  if (inflightDeployment) return inflightDeployment;
  inflightDeployment = fetch("/api/vaults/info", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`deployment fetch failed: ${r.status}`);
      return r.json() as Promise<VaultDeployment>;
    })
    .then((d) => {
      cachedDeployment = d;
      inflightDeployment = null;
      console.log(
        "[client-vaults] loaded deployment",
        d.packageId.slice(0, 10),
      );
      return d;
    })
    .catch((e) => {
      inflightDeployment = null;
      throw e;
    });
  return inflightDeployment;
}

type HistoryState =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ok"; data: VaultHistoryResponse; error?: undefined }
  | { status: "error"; error: string; data?: undefined };

/**
 * Lazy history fetcher. Skipped until enabled=true (so the dialog can
 * keep its `useState` mount cheap and fire the four metric requests only
 * once the user actually opens it).
 */
export function useVaultHistory(
  vaultId: string | undefined,
  metric: VaultHistoryMetric,
  opts: { enabled?: boolean; limit?: number; interval?: string } = {},
): HistoryState {
  const { enabled = true, limit = 100, interval = "1d" } = opts;
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  useEffect(() => {
    if (!enabled || !vaultId) {
      setState({ status: "loading" });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    const params = new URLSearchParams({
      metric,
      limit: String(limit),
      interval,
    });
    fetch(`/api/vaults/${vaultId}/history?${params}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`history ${r.status}`);
        return (await r.json()) as VaultHistoryResponse;
      })
      .then((data) => {
        if (!alive) return;
        setState({ status: "ok", data });
      })
      .catch((e: Error) => {
        if (!alive) return;
        setState({ status: "error", error: e.message });
      });
    return () => {
      alive = false;
    };
  }, [vaultId, metric, enabled, limit, interval]);
  return state;
}
