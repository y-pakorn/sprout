"use client";

import { motion } from "motion/react";
import { Sprout } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { truncateCoinType } from "@/lib/client-coins";
import { cn } from "@/lib/utils";

export type VaultPosition = {
  vaultId: string;
  vaultName: string;
  /** Token the user originally deposited (e.g. "USDC"). */
  depositSymbol: string;
  /** Canonical coin type of the deposit token — used for icon lookup. */
  depositCoinType: string;
  apyPct: number;
  category?: string;
  withdrawalPeriodDays?: number;
  /** Vault's own logo URL (preferred icon for vault-position rows). */
  logoUrl?: string;
  /** USD price per share (from Bluefin's vault list). Used to compute
   *  USD value directly — the 7K aggregator's /price endpoint does NOT
   *  return prices for vault receipt tokens (verified by curling it
   *  against ercUSD: only the deposit token came back). */
  receiptPriceUsd?: number;
};

export type WalletBalance = {
  symbol: string;
  balance: number;
  coinType: string;
  known: boolean;
  /** Per-unit USD price (from Bluefin7K oracle). */
  priceUsd?: number;
  /** balance × priceUsd (skipped when no price is available). */
  valueUsd?: number;
  /** Present when this token is a vault receipt (share) coin. */
  vaultPosition?: VaultPosition;
};

type IconLookup = (coinType: string) => string | undefined;

type Props = {
  balances: WalletBalance[];
  iconLookup: IconLookup;
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

function fmtUsd(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1) {
    return `${sign}$${abs.toLocaleString(undefined, {
      maximumFractionDigits: opts.compact ? 0 : 2,
    })}`;
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

/**
 * Wallet card listing every non-zero token balance.
 * Shown after getBalances resolves.
 */
export function WalletCard({ balances, iconLookup }: Props) {
  if (balances.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="liquid-glass px-5 py-4 text-body-sm text-canvas-white/55"
        style={{ borderRadius: 24 }}
      >
        Wallet is empty — no token balances found.
      </motion.div>
    );
  }

  const positions = balances.filter((b) => b.vaultPosition);
  const tokens = balances.filter((b) => !b.vaultPosition);
  const totalUsd = balances.reduce(
    (s, b) => s + (Number.isFinite(b.valueUsd) ? (b.valueUsd ?? 0) : 0),
    0,
  );
  const hasAnyValue = balances.some(
    (b) => typeof b.valueUsd === "number" && Number.isFinite(b.valueUsd),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.35, bounce: 0.18 }}
      className="liquid-glass p-2"
      style={{ borderRadius: 24, maxWidth: 460 }}
    >
      <div className="flex items-end justify-between gap-3 px-3 pt-3 pb-3">
        <div className="flex flex-col leading-tight">
          <span className="text-caption font-medium uppercase tracking-wider text-canvas-white/55">
            Your wallet · {tokens.length} token
            {tokens.length === 1 ? "" : "s"}
            {positions.length > 0 &&
              ` · ${positions.length} vault position${positions.length === 1 ? "" : "s"}`}
          </span>
          {hasAnyValue && (
            <span className="text-display-sm font-semibold tabular-nums text-canvas-white">
              {fmtUsd(totalUsd)}
            </span>
          )}
        </div>
      </div>

      {positions.length > 0 && (
        <>
          <SectionLabel>Vault positions</SectionLabel>
          <ul className="mb-1.5 flex flex-col gap-1">
            {positions.map((b, i) => (
              <VaultPositionRow
                key={b.coinType}
                b={b}
                i={i}
                iconLookup={iconLookup}
              />
            ))}
          </ul>
        </>
      )}

      {tokens.length > 0 && (
        <>
          {positions.length > 0 && <SectionLabel>Tokens</SectionLabel>}
          <ul className="flex flex-col gap-1">
            {tokens.map((b, i) => (
              <TokenRow
                key={b.coinType}
                b={b}
                i={i}
                iconLookup={iconLookup}
              />
            ))}
          </ul>
        </>
      )}
    </motion.div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-canvas-white/55">
      {children}
    </div>
  );
}

function VaultPositionRow({
  b,
  i,
  iconLookup,
}: {
  b: WalletBalance;
  i: number;
  iconLookup: IconLookup;
}) {
  const v = b.vaultPosition!;
  const hasValue =
    typeof b.valueUsd === "number" && Number.isFinite(b.valueUsd);
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * i, duration: 0.2 }}
      className={cn(
        "flex items-center gap-3 liquid-glass px-3 py-2.5",
      )}
      style={{
        borderRadius: 18,
        boxShadow: "inset 0 0 0 1.5px var(--color-cash-lime, #00d54f)",
      }}
    >
      <div className="relative shrink-0">
        <AssetIcon
          src={v.logoUrl ?? iconLookup(v.depositCoinType)}
          label={v.vaultName}
          size={32}
        />
        <span
          className="absolute -bottom-1 -right-1 inline-flex size-4 items-center justify-center bg-cash-lime text-midnight-black"
          style={{ borderRadius: 9999 }}
        >
          <Sprout className="size-2.5" strokeWidth={2.6} />
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-sm font-semibold leading-tight text-canvas-white">
          {v.vaultName}
        </span>
        <span className="truncate text-caption leading-tight text-canvas-white/55">
          Vault position · {v.depositSymbol} · {fmtPct(v.apyPct)} APY
        </span>
      </div>
      <div className="flex flex-col items-end leading-tight">
        <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
          {hasValue ? fmtUsd(b.valueUsd!) : formatAmount(b.balance)}
        </span>
        <span className="text-caption tabular-nums text-canvas-white/55">
          {formatAmount(b.balance)} shares
        </span>
      </div>
    </motion.li>
  );
}

function TokenRow({
  b,
  i,
  iconLookup,
}: {
  b: WalletBalance;
  i: number;
  iconLookup: IconLookup;
}) {
  const hasValue =
    typeof b.valueUsd === "number" && Number.isFinite(b.valueUsd);
  const hasPrice =
    typeof b.priceUsd === "number" &&
    Number.isFinite(b.priceUsd) &&
    b.priceUsd > 0;
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * i, duration: 0.2 }}
      className="flex items-center gap-3 liquid-glass px-3 py-2.5"
      style={{ borderRadius: 18 }}
    >
      <AssetIcon src={iconLookup(b.coinType)} label={b.symbol} size={32} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-body-sm font-semibold text-canvas-white">
          {b.symbol}
        </span>
        <span className="truncate text-caption text-canvas-white/55">
          {hasPrice && fmtPriceUsd(b.priceUsd!)}
          {hasPrice && !b.known ? " · " : ""}
          {!b.known && (
            <span title={b.coinType}>{truncateCoinType(b.coinType)}</span>
          )}
          {!hasPrice && b.known && "No price"}
        </span>
      </div>
      <div className="flex flex-col items-end leading-tight">
        <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
          {hasValue ? fmtUsd(b.valueUsd!) : formatAmount(b.balance)}
        </span>
        <span className="text-caption tabular-nums text-canvas-white/55">
          {formatAmount(b.balance)} {b.symbol}
        </span>
      </div>
    </motion.li>
  );
}
