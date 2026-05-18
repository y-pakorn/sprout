"use client";

import { fetchVaults, fetchDeployment } from "@/lib/client-vaults";
import { canonicalCoinType } from "@/lib/client-coins";
import type { SuiVault } from "@/lib/vaults";
import type { VaultPosition } from "@/components/parts/wallet-card";

export type VaultReceiptEntry = {
  position: VaultPosition;
  shareDecimals: number;
};

export type VaultReceiptIndex = Map<string, VaultReceiptEntry>;

// Module-level TTL cache. The underlying fetchVaults / fetchDeployment have
// their own permanent module caches, but the index itself is cheap to
// rebuild — this short TTL just dedupes near-simultaneous callers.
const CACHE_TTL_MS = 5_000;
let cached: { value: VaultReceiptIndex; expires: number } | null = null;
let inflight: Promise<VaultReceiptIndex> | null = null;

/**
 * Build (or return cached) lookup table mapping canonical receipt-coin
 * types to vault metadata. Used by balance reads to detect when a wallet
 * token is actually a vault position. Best-effort: failures yield an empty
 * map and consumers fall back to plain-token rendering.
 */
export function loadVaultReceiptIndex(): Promise<VaultReceiptIndex> {
  const now = Date.now();
  if (cached && cached.expires > now) return Promise.resolve(cached.value);
  if (inflight) return inflight;
  inflight = build()
    .then((value) => {
      cached = { value, expires: Date.now() + CACHE_TTL_MS };
      inflight = null;
      return value;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

async function build(): Promise<VaultReceiptIndex> {
  const out: VaultReceiptIndex = new Map();
  try {
    const [vaults, deployment] = await Promise.all([
      fetchVaults().catch(() => [] as SuiVault[]),
      fetchDeployment().catch(() => null),
    ]);
    for (const v of vaults) {
      if (!v.receiptCoinType) continue;
      out.set(canonicalCoinType(v.receiptCoinType), {
        shareDecimals: v.depositDecimals,
        position: {
          vaultId: v.id,
          vaultName: v.name,
          depositSymbol: v.depositSymbol,
          depositCoinType: v.depositCoinType,
          apyPct: v.apyPct,
          category: v.category,
          withdrawalPeriodDays: v.withdrawalPeriodDays,
          logoUrl: v.logoUrl,
          receiptPriceUsd: v.receiptCoinPriceUsd,
        },
      });
    }
    // Fallback: any vaults the list endpoint missed (e.g. hidden) may
    // still appear in the deployment map. /vaults/info doesn't expose
    // apy/name in a usable shape, so we backfill the bare minimum.
    if (deployment) {
      for (const entry of Object.values(deployment.vaultsByObjectId)) {
        const canon = canonicalCoinType(entry.receiptCoinType);
        if (out.has(canon)) continue;
        out.set(canon, {
          shareDecimals: entry.depositCoinDecimals,
          position: {
            vaultId: entry.receiptCoinType,
            vaultName: entry.name,
            depositSymbol:
              entry.depositCoinType.split("::").pop() ?? "TOKEN",
            depositCoinType: entry.depositCoinType,
            apyPct: 0,
          },
        });
      }
    }
  } catch {
    // ignore — empty map = no vault badging, balances still render
  }
  return out;
}
