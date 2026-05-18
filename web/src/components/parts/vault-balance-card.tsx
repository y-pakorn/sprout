"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  Sprout,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ExternalLink,
} from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import type {
  VaultBalance,
  VaultBalancePosition,
  VaultBalanceWithdrawal,
  VaultBalanceHistoryItem,
} from "@/lib/vault-balance";
import { cn } from "@/lib/utils";

type IconLookup = (coinType: string) => string | undefined;

type Props = {
  data: VaultBalance;
  iconLookup: IconLookup;
  onOpenVault?: (vaultId: string) => void;
};

function fmtAmount(n: number, maxFrac = 4): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (Math.abs(n) >= 1) {
    return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
  }
  if (Math.abs(n) >= 0.0001) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  return n.toExponential(2);
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

function fmtPct(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "soon";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

type Tab = "positions" | "pending" | "activity";

export function VaultBalanceCard({
  data,
  iconLookup,
  onOpenVault,
}: Props) {
  const positions = data.positions;
  const totalValueUsd = positions.reduce((s, p) => s + p.positionValueUsd, 0);

  const pending = data.withdrawals.filter(
    (w) => w.status.toLowerCase() === "pending",
  );
  const activity = data.history.filter((h) => h.type !== "Unknown");

  const totalCounts = {
    positions: positions.length,
    pending: pending.length,
    activity: activity.length,
  };

  const [tab, setTab] = useState<Tab>(() =>
    positions.length > 0
      ? "positions"
      : pending.length > 0
        ? "pending"
        : "activity",
  );

  const empty =
    positions.length === 0 &&
    pending.length === 0 &&
    activity.length === 0;

  if (empty) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="liquid-glass px-5 py-4 text-body-sm text-canvas-white/55"
        style={{ borderRadius: 24 }}
      >
        No vault activity yet — you don't have any open Ember vault positions.
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.35, bounce: 0.18 }}
      className="liquid-glass p-3"
      style={{ borderRadius: 24, maxWidth: 540 }}
    >
      {/* ───── Hero ───── */}
      <div className="space-y-1 px-1 pt-2 pb-4">
        <div className="text-caption font-medium uppercase tracking-wider text-canvas-white/55">
          Vault balance
        </div>
        <div className="text-title font-semibold leading-none text-canvas-white tabular-nums">
          {fmtUsd(totalValueUsd)}
        </div>
        <div className="text-caption text-canvas-white/55">
          {positions.length > 0 &&
            `${positions.length} active position${positions.length === 1 ? "" : "s"}`}
          {pending.length > 0 &&
            ` · ${pending.length} pending withdrawal${pending.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {/* ───── Tabs ───── */}
      <div
        className="mb-2 flex gap-0.5 liquid-glass p-1"
        style={{ borderRadius: 9999 }}
      >
        <TabButton
          active={tab === "positions"}
          onClick={() => setTab("positions")}
          count={totalCounts.positions}
        >
          Positions
        </TabButton>
        <TabButton
          active={tab === "pending"}
          onClick={() => setTab("pending")}
          count={totalCounts.pending}
        >
          Pending
        </TabButton>
        <TabButton
          active={tab === "activity"}
          onClick={() => setTab("activity")}
          count={totalCounts.activity}
        >
          Activity
        </TabButton>
      </div>

      {/* ───── Pane ───── */}
      {tab === "positions" &&
        (positions.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {positions.map((p, i) => (
              <PositionRow
                key={p.vaultId}
                p={p}
                i={i}
                iconLookup={iconLookup}
                onOpenVault={onOpenVault}
              />
            ))}
          </ul>
        ) : (
          <EmptyPane>No active positions.</EmptyPane>
        ))}

      {tab === "pending" &&
        (pending.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {pending.map((w, i) => (
              <PendingWithdrawalRow
                key={w.txDigest}
                w={w}
                i={i}
                iconLookup={iconLookup}
              />
            ))}
          </ul>
        ) : (
          <EmptyPane>No pending withdrawals.</EmptyPane>
        ))}

      {tab === "activity" &&
        (activity.length > 0 ? (
          <ActivityList items={activity} iconLookup={iconLookup} />
        ) : (
          <EmptyPane>No vault activity yet.</EmptyPane>
        ))}
    </motion.div>
  );
}

function TabButton({
  children,
  active,
  onClick,
  count,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 px-3 py-1.5 text-caption font-semibold transition-colors",
        active
          ? "bg-midnight-black text-canvas-white"
          : "text-canvas-white/55 hover:text-canvas-white",
      )}
      style={{ borderRadius: 9999 }}
    >
      {children}
      {count > 0 && (
        <span
          className={cn(
            "ml-1.5 text-[10px] tabular-nums",
            active ? "text-canvas-white/70" : "text-canvas-white/40",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function EmptyPane({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-center liquid-glass px-3 py-6 text-caption text-canvas-white/55"
      style={{ borderRadius: 18 }}
    >
      {children}
    </div>
  );
}

function PositionRow({
  p,
  i,
  iconLookup,
  onOpenVault,
}: {
  p: VaultBalancePosition;
  i: number;
  iconLookup: IconLookup;
  onOpenVault?: (vaultId: string) => void;
}) {
  const clickable = !!onOpenVault;
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * i, duration: 0.2 }}
    >
      <button
        type="button"
        onClick={() => clickable && onOpenVault!(p.vaultId)}
        disabled={!clickable}
        className={cn(
          "group flex w-full items-center gap-3 liquid-glass p-3 text-left transition-colors",
          clickable && "hover:bg-cash-lime/10",
        )}
        style={{ borderRadius: 18 }}
      >
        <div className="relative shrink-0">
          <AssetIcon
            src={p.vaultLogoUrl ?? iconLookup(p.depositCoinType)}
            label={p.vaultName}
            size={36}
          />
          <span
            className="absolute -bottom-1 -right-1 inline-flex size-4 items-center justify-center bg-cash-lime text-midnight-black"
            style={{ borderRadius: 9999 }}
          >
            <Sprout className="size-2.5" strokeWidth={2.6} />
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-body-sm font-semibold text-canvas-white">
              {p.vaultName}
            </span>
            <span
              className="shrink-0 bg-cash-lime/20 px-1.5 py-0 text-[10px] font-semibold tabular-nums text-cash-lime-deep"
              style={{ borderRadius: 9999 }}
            >
              {fmtPct(p.apyPct)}
            </span>
          </div>
          <span className="truncate text-caption tabular-nums text-canvas-white/55">
            {fmtAmount(p.shares)} shares · {p.depositSymbol}
          </span>
        </div>

        <div className="flex flex-col items-end leading-tight">
          <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
            {fmtUsd(p.positionValueUsd)}
          </span>
        </div>
      </button>
    </motion.li>
  );
}

function PendingWithdrawalRow({
  w,
  i,
}: {
  w: VaultBalanceWithdrawal;
  i: number;
  iconLookup: IconLookup;
}) {
  const usdValue = w.requestedShares * w.receiptCoin.priceUsd;
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * i, duration: 0.2 }}
      className="flex items-center gap-3 liquid-glass p-3"
      style={{ borderRadius: 18 }}
    >
      <span
        className="inline-flex size-9 shrink-0 items-center justify-center bg-warning/15 text-warning"
        style={{ borderRadius: 9999 }}
      >
        <Clock className="size-4" strokeWidth={2.4} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body-sm font-semibold text-canvas-white">
            Withdraw {w.vault.name}
          </span>
          <span
            className="shrink-0 bg-warning/15 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-warning"
            style={{ borderRadius: 9999 }}
          >
            Pending
          </span>
        </div>
        <span className="truncate text-caption tabular-nums text-canvas-white/55">
          {fmtAmount(w.requestedShares)} {w.receiptCoin.symbol} ·{" "}
          requested {fmtRelative(w.requestedAt)}
        </span>
      </div>
      <div className="flex flex-col items-end leading-tight">
        {Number.isFinite(usdValue) && usdValue > 0 && (
          <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
            ≈{fmtUsd(usdValue)}
          </span>
        )}
        <a
          href={`https://suiscan.xyz/mainnet/tx/${w.txDigest}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-caption text-canvas-white/55 hover:text-canvas-white"
        >
          {w.txDigest.slice(0, 6)}…
          <ExternalLink className="size-3" strokeWidth={2.2} />
        </a>
      </div>
    </motion.li>
  );
}

function ActivityList({
  items,
  iconLookup,
}: {
  items: VaultBalanceHistoryItem[];
  iconLookup: IconLookup;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 6);
  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {visible.map((item, i) => (
          <ActivityRow
            key={i}
            item={item}
            i={i}
            iconLookup={iconLookup}
          />
        ))}
      </ul>
      {items.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 w-full liquid-glass px-3 py-2 text-caption font-medium text-canvas-white/55 transition-colors hover:bg-cash-lime/10 hover:text-canvas-white"
          style={{ borderRadius: 12 }}
        >
          {expanded
            ? "Show less"
            : `Show ${items.length - 6} more`}
        </button>
      )}
    </>
  );
}

function ActivityRow({
  item,
  i,
  iconLookup,
}: {
  item: VaultBalanceHistoryItem;
  i: number;
  iconLookup: IconLookup;
}) {
  if (item.type === "Unknown") return null;

  const common = {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.03 * i, duration: 0.2 },
    className: "flex items-center gap-3 liquid-glass p-3",
    style: { borderRadius: 18 },
  };

  if (item.type === "Deposit") {
    const usd = item.depositAmount * item.depositCoin.priceUsd;
    return (
      <motion.li {...common}>
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center bg-cash-lime/20 text-cash-lime-deep"
          style={{ borderRadius: 9999 }}
        >
          <ArrowDownLeft className="size-4" strokeWidth={2.4} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-sm font-semibold text-canvas-white">
            Deposit · {item.vault.name}
          </span>
          <span className="truncate text-caption tabular-nums text-canvas-white/55">
            {fmtAmount(item.depositAmount)} {item.depositCoin.symbol} →{" "}
            {fmtAmount(item.receivedShares)} {item.receiptCoin.symbol}
          </span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          {Number.isFinite(usd) && usd > 0 && (
            <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
              {fmtUsd(usd)}
            </span>
          )}
          <span className="text-caption text-canvas-white/55">
            {fmtRelative(item.timestamp)}
          </span>
        </div>
      </motion.li>
    );
  }

  if (item.type === "RedeemRequest") {
    const usd = item.shares * item.receiptCoin.priceUsd;
    return (
      <motion.li {...common}>
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center bg-warning/15 text-warning"
          style={{ borderRadius: 9999 }}
        >
          <Clock className="size-4" strokeWidth={2.4} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-sm font-semibold text-canvas-white">
            Withdraw request · {item.vault.name}
          </span>
          <span className="truncate text-caption tabular-nums text-canvas-white/55">
            {fmtAmount(item.shares)} {item.receiptCoin.symbol}
          </span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          {Number.isFinite(usd) && usd > 0 && (
            <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
              ≈{fmtUsd(usd)}
            </span>
          )}
          <span className="text-caption text-canvas-white/55">
            {fmtRelative(item.timestamp)}
          </span>
        </div>
      </motion.li>
    );
  }

  if (item.type === "RedeemRequestProcessed") {
    const usd = item.receivedAmount * item.receivedCoin.priceUsd;
    return (
      <motion.li {...common}>
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center bg-cash-lime/20 text-cash-lime-deep"
          style={{ borderRadius: 9999 }}
        >
          <Check className="size-4" strokeWidth={2.4} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-sm font-semibold text-canvas-white">
            Withdrawal completed · {item.vault.name}
          </span>
          <span className="truncate text-caption tabular-nums text-canvas-white/55">
            {fmtAmount(item.redeemedShares)} {item.receiptCoin.symbol} →{" "}
            {fmtAmount(item.receivedAmount)} {item.receivedCoin.symbol}
          </span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          {Number.isFinite(usd) && usd > 0 && (
            <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
              {fmtUsd(usd)}
            </span>
          )}
          <span className="text-caption text-canvas-white/55">
            {fmtRelative(item.timestamp)}
          </span>
        </div>
      </motion.li>
    );
  }

  return (
    <motion.li {...common}>
      <ArrowUpRight className="size-4" strokeWidth={2.4} />
    </motion.li>
  );
}
