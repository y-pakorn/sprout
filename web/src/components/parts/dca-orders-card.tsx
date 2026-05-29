"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Repeat, ArrowRight, Check, ExternalLink, X as XIcon } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { SproutBadge } from "@/components/ui/sprout-badge";
import { StatusDisk } from "@/components/ui/status-disk";
import { Tag } from "@/components/ui/tag";
import { DcaCancelDialog } from "@/components/parts/dca-cancel-dialog";
import { fmtAmount, fmtRelative, fmtCountdown } from "@/lib/format";
import { fmtInterval } from "@/lib/seven-k-dca";
import { cn } from "@/lib/utils";
import type { DcaOrderView, DcaOrderExecutionView } from "@/lib/dca-orders";
import type { CachedDcaOrders } from "@/lib/ai/dca-cache";

type IconLookup = (coinType: string) => string | undefined;

type Props = {
  cached: CachedDcaOrders;
  iconLookup: IconLookup;
  /** Called after a cancel succeeds (portfolio passes a refetch). */
  onCancelled?: () => void;
};

type Tab = "orders" | "history";

export function DcaOrdersCard({ cached, iconLookup, onCancelled }: Props) {
  const orders = cached.orders;
  const history = cached.history;
  const activeCount = orders.filter((o) => o.isActive).length;

  const [tab, setTab] = useState<Tab>(() =>
    orders.length > 0 ? "orders" : "history",
  );
  const [cancelOrder, setCancelOrder] = useState<DcaOrderView | null>(null);
  // Lazy init (not Date.now() in render) keeps the countdowns pure-render-safe.
  const [now] = useState(() => Date.now());

  if (orders.length === 0 && history.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="surface-card px-5 py-4 text-body-sm text-muted-ash rounded-card"
      >
        No DCA orders yet — say e.g. &ldquo;DCA 200 USDC into SUI weekly for 8
        weeks&rdquo; to start one.
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.35, bounce: 0.18 }}
      className="surface-card p-3 rounded-card max-w-[560px]"
    >
      {/* Hero */}
      <div className="space-y-1 px-1 pt-2 pb-4">
        <div className="inline-flex items-center gap-1.5 text-caption font-medium uppercase tracking-wider text-muted-ash">
          <Repeat className="size-3" strokeWidth={2.4} />
          DCA orders
        </div>
        <div className="text-title font-medium leading-none text-midnight-ink tabular-nums">
          {activeCount} active
        </div>
        <div className="text-caption text-muted-ash">
          {orders.length} order{orders.length === 1 ? "" : "s"}
          {history.length > 0 &&
            ` · ${history.length} fill${history.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-2 flex gap-0.5 surface-panel p-1 rounded-card">
        <TabButton active={tab === "orders"} onClick={() => setTab("orders")} count={orders.length}>
          Orders
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")} count={history.length}>
          History
        </TabButton>
      </div>

      {tab === "orders" &&
        (orders.length > 0 ? (
          <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
            {orders.map((o, i) => (
              <OrderRow
                key={o.orderId}
                o={o}
                i={i}
                now={now}
                iconLookup={iconLookup}
                onCancel={() => setCancelOrder(o)}
              />
            ))}
          </ul>
        ) : (
          <EmptyPane>No open orders.</EmptyPane>
        ))}

      {tab === "history" &&
        (history.length > 0 ? (
          <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
            {history.map((e, i) => (
              <ExecutionRow key={`${e.digest}:${i}`} e={e} i={i} iconLookup={iconLookup} />
            ))}
          </ul>
        ) : (
          <EmptyPane>No fills yet.</EmptyPane>
        ))}

      <DcaCancelDialog
        order={cancelOrder}
        open={!!cancelOrder}
        onOpenChange={(o) => !o && setCancelOrder(null)}
        iconLookup={iconLookup}
        onSuccess={() => {
          setCancelOrder(null);
          onCancelled?.();
        }}
      />
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
    <div className="flex items-center justify-center surface-panel px-3 py-6 text-caption text-muted-ash rounded-card">
      {children}
    </div>
  );
}

function OrderRow({
  o,
  i,
  now,
  iconLookup,
  onCancel,
}: {
  o: DcaOrderView;
  i: number;
  now: number;
  iconLookup: IconLookup;
  onCancel: () => void;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * i, duration: 0.2 }}
      className="flex flex-col gap-2 surface-panel p-3 rounded-card"
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <AssetIcon
            src={o.payIcon ?? iconLookup(o.payCoinType)}
            label={o.paySymbol}
            size={32}
          />
          <SproutBadge />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-body-sm font-medium text-midnight-ink">
              {o.paySymbol} → {o.targetSymbol}
            </span>
            <Tag tone={o.isActive ? "green" : "neutral"}>
              {o.isActive ? "Active" : o.status}
            </Tag>
          </div>
          <span className="truncate text-caption tabular-nums text-muted-ash">
            {fmtAmount(o.amountPerOrderHuman)} {o.paySymbol} · every{" "}
            {fmtInterval(o.intervalMs)}
            {o.maxPrice != null && ` · ≤ ${fmtAmount(o.maxPrice)} ${o.paySymbol}`}
          </span>
        </div>
        {o.isActive && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex shrink-0 items-center gap-1 bg-canvas-white px-2.5 py-1 text-caption font-medium text-midnight-ink ring-1 ring-hairline transition-colors hover:bg-destructive/10 rounded-button"
          >
            <XIcon className="size-3" strokeWidth={2.4} />
            Cancel
          </button>
        )}
      </div>

      {/* Progress */}
      <div className="space-y-1">
        <div className="h-1.5 w-full overflow-hidden bg-midnight-ink/[0.06] rounded-full">
          <div
            className="h-full bg-deliver-green rounded-full"
            style={{ width: `${Math.max(2, o.progressPct)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-caption tabular-nums text-muted-ash">
          <span>
            {o.filled}/{o.numOrders} filled ·{" "}
            {fmtAmount(o.obtainedHuman)} {o.targetSymbol} bought
          </span>
          {o.isActive && o.nextExecTs && (
            <span>next in {fmtCountdown(o.nextExecTs, now)}</span>
          )}
        </div>
      </div>
    </motion.li>
  );
}

function ExecutionRow({
  e,
  i,
  iconLookup,
}: {
  e: DcaOrderExecutionView;
  i: number;
  iconLookup: IconLookup;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.03 * i, duration: 0.2 }}
      className="flex items-center gap-3 surface-panel p-3 rounded-card"
    >
      <StatusDisk tone="green">
        <Check className="size-4" strokeWidth={2.4} />
      </StatusDisk>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 truncate text-body-sm font-medium text-midnight-ink">
          {fmtAmount(e.payHuman)} {e.paySymbol}
          <ArrowRight className="size-3 text-muted-ash" strokeWidth={2.4} />
          {fmtAmount(e.obtainedHuman)} {e.targetSymbol}
        </span>
        <span className="truncate text-caption text-muted-ash">
          {fmtRelative(e.executedTs)}
        </span>
      </div>
      <a
        href={`https://suiscan.xyz/mainnet/tx/${e.digest}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-0.5 text-caption text-muted-ash hover:text-midnight-ink"
      >
        {e.digest.slice(0, 6)}…
        <ExternalLink className="size-3" strokeWidth={2.2} />
      </a>
    </motion.li>
  );
}
