"use client";

import { motion } from "motion/react";
import { Sprout } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import type { VaultPosition } from "@/components/parts/wallet-card";

type Props = {
  symbol: string;
  balance: number;
  iconUrl?: string;
  /** Per-unit USD price (from Bluefin7K oracle). */
  priceUsd?: number;
  /** balance × priceUsd (skipped when no price). */
  valueUsd?: number;
  /** If present, this balance is a vault receipt token and renders as a
   *  vault-position card with the vault name as the primary label. */
  vaultPosition?: VaultPosition;
  /** Lookup so we can render the deposit-token icon for vault positions. */
  depositIconUrl?: string;
};

function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (n >= 0.0001) return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return n.toExponential(2);
}

function fmtPct(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1) {
    return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (abs >= 0.01) return `${sign}$${abs.toFixed(2)}`;
  if (abs > 0) return `${sign}<$0.01`;
  return "$0.00";
}

function fmtPriceUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(2)}`;
}

/** Compact single-token balance card. Shown after getBalance resolves. */
export function BalanceCard({
  symbol,
  balance,
  iconUrl,
  priceUsd,
  valueUsd,
  vaultPosition,
  depositIconUrl,
}: Props) {
  if (vaultPosition) {
    const hasVaultValue =
      typeof valueUsd === "number" && Number.isFinite(valueUsd);
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
        className="inline-flex items-center gap-3 liquid-glass px-4 py-3"
        style={{
          borderRadius: 24,
          boxShadow: "inset 0 0 0 1.5px var(--color-cash-lime, #00d54f)",
        }}
      >
        <div className="relative shrink-0">
          <AssetIcon
            src={vaultPosition.logoUrl ?? depositIconUrl}
            label={vaultPosition.vaultName}
            size={36}
          />
          <span
            className="absolute -bottom-1 -right-1 inline-flex size-4 items-center justify-center bg-cash-lime text-midnight-black"
            style={{ borderRadius: 9999 }}
          >
            <Sprout className="size-2.5" strokeWidth={2.6} />
          </span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-caption font-medium text-canvas-white/55">
            Vault position · {vaultPosition.depositSymbol} ·{" "}
            {fmtPct(vaultPosition.apyPct)} APY
          </span>
          <span className="text-body-sm font-semibold text-canvas-white">
            {vaultPosition.vaultName}
          </span>
          <span className="text-body-lg font-semibold leading-none text-canvas-white tabular-nums">
            {hasVaultValue ? fmtUsd(valueUsd!) : `${formatAmount(balance)} shares`}
          </span>
          {hasVaultValue && (
            <span className="text-caption font-medium tabular-nums text-canvas-white/55">
              {formatAmount(balance)} shares
            </span>
          )}
        </div>
      </motion.div>
    );
  }

  const hasValue =
    typeof valueUsd === "number" && Number.isFinite(valueUsd);
  const hasPrice =
    typeof priceUsd === "number" &&
    Number.isFinite(priceUsd) &&
    priceUsd > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className="inline-flex items-center gap-3 liquid-glass px-4 py-3"
      style={{ borderRadius: 24 }}
    >
      <AssetIcon src={iconUrl} label={symbol} size={36} />
      <div className="flex flex-col leading-tight">
        <span className="text-caption font-medium text-canvas-white/55">
          {symbol} balance
          {hasPrice ? ` · ${fmtPriceUsd(priceUsd!)}` : ""}
        </span>
        <span className="text-body-lg font-semibold text-canvas-white tabular-nums">
          {formatAmount(balance)}
        </span>
        {hasValue && (
          <span className="text-caption font-medium tabular-nums text-canvas-white/55">
            {fmtUsd(valueUsd!)}
          </span>
        )}
      </div>
    </motion.div>
  );
}
