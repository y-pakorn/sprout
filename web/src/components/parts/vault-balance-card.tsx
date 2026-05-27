"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ExternalLink,
} from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { SproutBadge } from "@/components/ui/sprout-badge";
import { StatusDisk } from "@/components/ui/status-disk";
import { Tag } from "@/components/ui/tag";
import type {
  VaultBalance,
  VaultBalancePosition,
  VaultBalanceWithdrawal,
  VaultBalanceHistoryItem,
} from "@/lib/vault-balance";
import { fmtAmount, fmtUsd, fmtPct, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

type IconLookup = (coinType: string) => string | undefined;

type Props = {
  data: VaultBalance;
  iconLookup: IconLookup;
  onOpenVault?: (vaultId: string) => void;
};

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
        className="surface-card px-5 py-4 text-body-sm text-muted-ash rounded-card"
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
      className="surface-card p-3 rounded-card max-w-[540px]"
    >
      {/* ───── Hero ───── */}
      <div className="space-y-1 px-1 pt-2 pb-4">
        <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
          Vault balance
        </div>
        <div className="text-title font-medium leading-none text-midnight-ink tabular-nums">
          {fmtUsd(totalValueUsd)}
        </div>
        <div className="text-caption text-muted-ash">
          {positions.length > 0 &&
            `${positions.length} active position${positions.length === 1 ? "" : "s"}`}
          {pending.length > 0 &&
            ` · ${pending.length} pending withdrawal${pending.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {/* ───── Tabs ───── */}
      <div
        className="mb-2 flex gap-0.5 surface-panel p-1 rounded-card"
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
          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
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
          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
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
        "flex-1 rounded-button px-3 py-1.5 text-caption font-medium transition-colors",
        active
          ? "bg-midnight-ink text-canvas-white"
          : "text-muted-ash hover:text-midnight-ink",
      )}
    >
      {children}
      {count > 0 && (
        <span
          className={cn(
            "ml-1.5 text-[10px] tabular-nums",
            active ? "text-canvas-white/70" : "text-muted-ash",
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
      className="flex items-center justify-center surface-panel px-3 py-6 text-caption text-muted-ash rounded-card"
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
        className={cn("rounded-card", 
          "group flex w-full items-center gap-3 surface-panel p-3 text-left transition-colors",
          clickable && "hover:bg-deliver-green/10",
        )}
      >
        <div className="relative shrink-0">
          <AssetIcon
            src={p.vaultLogoUrl ?? iconLookup(p.depositCoinType)}
            label={p.vaultName}
            size={36}
          />
          <SproutBadge />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-body-sm font-medium text-midnight-ink">
              {p.vaultName}
            </span>
            <Tag tone="green">{fmtPct(p.apyPct)}</Tag>
          </div>
          <span className="truncate text-caption tabular-nums text-muted-ash">
            {fmtAmount(p.shares)} shares · {p.depositSymbol}
          </span>
        </div>

        <div className="flex flex-col items-end leading-tight">
          <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
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
      className="flex items-center gap-3 surface-panel p-3 rounded-card"
    >
      <StatusDisk tone="gold">
        <Clock className="size-4" strokeWidth={2.4} />
      </StatusDisk>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body-sm font-medium text-midnight-ink">
            Withdraw {w.vault.name}
          </span>
          <Tag tone="gold">Pending</Tag>
        </div>
        <span className="truncate text-caption tabular-nums text-muted-ash">
          {fmtAmount(w.requestedShares)} {w.receiptCoin.symbol} ·{" "}
          requested {fmtRelative(w.requestedAt)}
        </span>
      </div>
      <div className="flex flex-col items-end leading-tight">
        {Number.isFinite(usdValue) && usdValue > 0 && (
          <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
            ≈{fmtUsd(usdValue)}
          </span>
        )}
        <a
          href={`https://suiscan.xyz/mainnet/tx/${w.txDigest}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-caption text-muted-ash hover:text-midnight-ink"
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
          className="mt-2 w-full surface-panel px-3 py-2 text-caption font-medium text-muted-ash transition-colors hover:bg-deliver-green/10 hover:text-midnight-ink rounded-card"
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
    className: "flex items-center gap-3 surface-panel rounded-card p-3",
  };

  if (item.type === "Deposit") {
    const usd = item.depositAmount * item.depositCoin.priceUsd;
    return (
      <motion.li {...common}>
        <StatusDisk tone="green">
          <ArrowDownLeft className="size-4" strokeWidth={2.4} />
        </StatusDisk>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-sm font-medium text-midnight-ink">
            Deposit · {item.vault.name}
          </span>
          <span className="truncate text-caption tabular-nums text-muted-ash">
            {fmtAmount(item.depositAmount)} {item.depositCoin.symbol} →{" "}
            {fmtAmount(item.receivedShares)} {item.receiptCoin.symbol}
          </span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          {Number.isFinite(usd) && usd > 0 && (
            <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
              {fmtUsd(usd)}
            </span>
          )}
          <span className="text-caption text-muted-ash">
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
        <StatusDisk tone="gold">
          <Clock className="size-4" strokeWidth={2.4} />
        </StatusDisk>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-sm font-medium text-midnight-ink">
            Withdraw request · {item.vault.name}
          </span>
          <span className="truncate text-caption tabular-nums text-muted-ash">
            {fmtAmount(item.shares)} {item.receiptCoin.symbol}
          </span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          {Number.isFinite(usd) && usd > 0 && (
            <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
              ≈{fmtUsd(usd)}
            </span>
          )}
          <span className="text-caption text-muted-ash">
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
        <StatusDisk tone="green">
          <Check className="size-4" strokeWidth={2.4} />
        </StatusDisk>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-sm font-medium text-midnight-ink">
            Withdrawal completed · {item.vault.name}
          </span>
          <span className="truncate text-caption tabular-nums text-muted-ash">
            {fmtAmount(item.redeemedShares)} {item.receiptCoin.symbol} →{" "}
            {fmtAmount(item.receivedAmount)} {item.receivedCoin.symbol}
          </span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          {Number.isFinite(usd) && usd > 0 && (
            <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
              {fmtUsd(usd)}
            </span>
          )}
          <span className="text-caption text-muted-ash">
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
