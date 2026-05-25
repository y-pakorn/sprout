"use client";

import { motion } from "motion/react";
import { AssetIcon } from "@/components/asset-icon";
import { SproutBadge } from "@/components/ui/sprout-badge";
import type { VaultPosition } from "@/components/parts/wallet-card";
import { fmtAmount, fmtPct, fmtUsd, fmtPriceUsd } from "@/lib/format";

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
        className="inline-flex items-center gap-3 bg-canvas-white rounded-card px-4 py-3 ring-[1.5px] ring-inset ring-deliver-green"
      >
        <div className="relative shrink-0">
          <AssetIcon
            src={vaultPosition.logoUrl ?? depositIconUrl}
            label={vaultPosition.vaultName}
            size={36}
          />
          <SproutBadge />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-caption font-medium text-muted-ash">
            Vault position · {vaultPosition.depositSymbol} ·{" "}
            {fmtPct(vaultPosition.apyPct)} APY
          </span>
          <span className="text-body-sm font-medium text-midnight-ink">
            {vaultPosition.vaultName}
          </span>
          <span className="text-body-lg font-medium leading-none text-midnight-ink tabular-nums">
            {hasVaultValue ? fmtUsd(valueUsd!) : `${fmtAmount(balance)} shares`}
          </span>
          {hasVaultValue && (
            <span className="text-caption font-medium tabular-nums text-muted-ash">
              {fmtAmount(balance)} shares
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
      className="inline-flex items-center gap-3 surface-card px-4 py-3 rounded-card"
    >
      <AssetIcon src={iconUrl} label={symbol} size={36} />
      <div className="flex flex-col leading-tight">
        <span className="text-caption font-medium text-muted-ash">
          {symbol} balance
          {hasPrice ? ` · ${fmtPriceUsd(priceUsd!)}` : ""}
        </span>
        <span className="text-body-lg font-medium text-midnight-ink tabular-nums">
          {fmtAmount(balance)}
        </span>
        {hasValue && (
          <span className="text-caption font-medium tabular-nums text-muted-ash">
            {fmtUsd(valueUsd!)}
          </span>
        )}
      </div>
    </motion.div>
  );
}
