"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Clock,
  ArrowDownLeft,
  Check,
  ExternalLink,
  X as XIcon,
  Loader2,
  AlertTriangle,
  Repeat,
} from "lucide-react";
import {
  useCurrentAccount,
  useDAppKit,
  useCurrentClient,
} from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { AssetIcon } from "@/components/asset-icon";
import { SproutBadge } from "@/components/ui/sprout-badge";
import { StatusDisk } from "@/components/ui/status-disk";
import { Tag } from "@/components/ui/tag";
import { Skeleton } from "@/components/ui/skeleton";
import { CinematicShell } from "@/components/parts/cinematic-shell";
import { WalletButton } from "@/components/wallet-button";
import { RedeemDialog } from "@/components/parts/redeem-dialog";
import { DcaCancelDialog } from "@/components/parts/dca-cancel-dialog";
import { CoinFlow } from "@/components/parts/coin-flow";
import { useVaultBalance } from "@/lib/client-vault-balance";
import { useDcaOrders } from "@/lib/client-dca-orders";
import { fmtInterval } from "@/lib/seven-k-dca";
import type { DcaOrderView } from "@/lib/dca-orders";
import { useWalletHoldings, type TokenHolding } from "@/lib/client-wallet";
import { useAccountActivity } from "@/lib/client-account-activity";
import type { TxActivity, TxCoin } from "@/lib/tx-history";
import { fetchDeployment } from "@/lib/client-vaults";
import { truncateCoinType } from "@/lib/client-coins";
import { appendCancelRedeemCall } from "@/lib/ember-actions";
import {
  fmtAmount,
  fmtUsd,
  fmtPct,
  fmtPriceUsd,
  fmtCountdown,
  fmtRelative,
} from "@/lib/format";
import type {
  VaultBalancePosition,
  VaultBalanceWithdrawal,
  VaultBalanceHistoryItem,
} from "@/lib/vault-balance";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────

export function PortfolioView() {
  const account = useCurrentAccount();
  const { state: vaultState, refresh: refreshVaults } = useVaultBalance();
  const { state: holdingsState, refresh: refreshHoldings } =
    useWalletHoldings();
  const { state: dcaState, refresh: refreshDca } = useDcaOrders();
  const [openPosition, setOpenPosition] = useState<VaultBalancePosition | null>(
    null,
  );
  const [cancelDca, setCancelDca] = useState<DcaOrderView | null>(null);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showAllAccountActivity, setShowAllAccountActivity] = useState(false);

  // Tick every 30s for the pending countdowns.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const vaultData = vaultState.data;
  // Vault receipt tokens are surfaced as positions below, not as plain
  // holdings — drop them here so wallet totals/list don't double-count.
  const holdings = (holdingsState.data ?? []).filter((h) => !h.isVaultReceipt);

  const totals = useMemo(() => {
    const positions = vaultData?.positions ?? [];
    const positionsUsd = positions.reduce(
      (s, p) => s + p.positionValueUsd,
      0,
    );
    const holdingsUsd = holdings.reduce(
      (s, h) => s + (h.valueUsd ?? 0),
      0,
    );
    const totalUsd = positionsUsd + holdingsUsd;
    const blendedApy =
      positions.length > 0
        ? positions.reduce(
            (s, p) => s + p.apyPct * p.positionValueUsd,
            0,
          ) / Math.max(1e-9, positionsUsd)
        : 0;
    return { totalUsd, positionsUsd, holdingsUsd, blendedApy };
  }, [vaultData, holdings]);

  const pending =
    vaultData?.withdrawals.filter(
      (w) => w.status.toLowerCase() === "pending",
    ) ?? [];
  const activity =
    vaultData?.history.filter((h) => h.type !== "Unknown") ?? [];
  const visibleActivity = showAllActivity ? activity : activity.slice(0, 6);

  const accountActivity = useAccountActivity();
  const visibleAccountActivity = showAllAccountActivity
    ? accountActivity
    : accountActivity.slice(0, 6);

  const dcaOrders = dcaState.data?.orders ?? [];
  const activeDca = dcaOrders.filter((o) => o.isActive);

  function refresh() {
    refreshVaults();
    refreshHoldings();
    refreshDca();
  }

  const loading =
    vaultState.status === "loading" && !vaultData;
  const error =
    vaultState.status === "error" && !vaultData
      ? vaultState.error
      : null;

  return (
    <CinematicShell mode="dim">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 pb-24 pt-28">
        {/* ───── Connect gate (signed out) ───── */}
        {!account && <ConnectGate />}

        {/* ───── Hero — total value ───── */}
        {account && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", visualDuration: 0.55, bounce: 0.15 }}
            className="space-y-2 text-center"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-ash">
              Your garden
            </p>
            <h1
              className="display-tight font-medium leading-[1.05] tracking-tight text-midnight-ink tabular-nums text-[clamp(48px,7vw,88px)]"
            >
              {fmtUsd(totals.totalUsd)}
            </h1>
            <p className="text-body-sm text-muted-ash">
              {fmtUsd(totals.holdingsUsd)} in wallet ·{" "}
              <span className="text-midnight-ink">
                {fmtUsd(totals.positionsUsd)} earning
              </span>
              {totals.blendedApy > 0 && (
                <>
                  {" "}
                  @{" "}
                  <span className="font-medium text-midnight-ink">
                    {fmtPct(totals.blendedApy)} APY
                  </span>
                </>
              )}
              {activeDca.length > 0 && (
                <>
                  {" · "}
                  <span className="text-midnight-ink">
                    {activeDca.length} DCA running
                  </span>
                </>
              )}
            </p>
          </motion.div>
        )}

        {/* ───── States ───── */}
        {account && loading && <PortfolioSkeleton />}
        {account && error && (
          <EmptyCard tone="warn">
            <AlertTriangle className="size-4 text-warning" strokeWidth={2.4} />
            <span className="text-midnight-ink">Couldn't load: {error}</span>
            <button
              type="button"
              onClick={refresh}
              className="ml-auto bg-whisper-gray px-3 py-1 text-caption font-medium text-midnight-ink hover:bg-light-taupe rounded-button"
            >
              Retry
            </button>
          </EmptyCard>
        )}

        {/* ───── Vault Positions ───── */}
        {account && vaultData && vaultData.positions.length > 0 && (
          <Section
            title="Vault positions"
            subtitle="Earning yield"
            count={vaultData.positions.length}
          >
            {vaultData.positions.map((p, i) => (
              <PositionRow
                key={p.vaultId}
                p={p}
                i={i}
                onWithdraw={() => setOpenPosition(p)}
              />
            ))}
          </Section>
        )}

        {/* ───── Pending withdrawals ───── */}
        {account && vaultData && pending.length > 0 && (
          <Section
            title="Pending withdrawals"
            subtitle="Processing after the vault's lockup window"
            count={pending.length}
          >
            {pending.map((w, i) => (
              <PendingRow
                key={w.txDigest}
                w={w}
                i={i}
                now={now}
                positions={vaultData.positions}
                onCancelled={refresh}
              />
            ))}
          </Section>
        )}

        {/* ───── DCA orders ───── */}
        {account && dcaOrders.length > 0 && (
          <Section
            title="DCA orders"
            subtitle="Recurring buys · scheduled on 7K"
            count={dcaOrders.length}
          >
            {dcaOrders.map((o, i) => (
              <DcaPortfolioRow
                key={o.orderId}
                o={o}
                i={i}
                now={now}
                onCancel={() => setCancelDca(o)}
              />
            ))}
          </Section>
        )}

        {/* ───── Wallet holdings ───── */}
        {account && holdings.length > 0 && (
          <Section
            title="Holdings"
            subtitle="In your wallet · ready to swap or deploy"
            count={holdings.length}
          >
            {holdings.map((h, i) => (
              <HoldingRow key={h.coinType} h={h} i={i} />
            ))}
          </Section>
        )}

        {/* ───── Vault activity ───── */}
        {account && vaultData && activity.length > 0 && (
          <Section
            title="Recent vault activity"
            subtitle="Deposits, withdrawals, and processed redemptions"
            count={activity.length}
          >
            <div className="surface-card overflow-hidden rounded-card">
              {visibleActivity.map((h, i) => (
                <ActivityRow key={i} item={h} i={i} />
              ))}
            </div>
            {activity.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllActivity((v) => !v)}
                className="mt-1 w-full bg-whisper-gray px-3 py-2 text-caption font-medium text-muted-ash transition-colors hover:bg-light-taupe hover:text-midnight-ink rounded-card"
              >
                {showAllActivity
                  ? "Show less"
                  : `Show ${activity.length - 6} more`}
              </button>
            )}
          </Section>
        )}

        {/* ───── Account activity ───── */}
        {account && accountActivity.length > 0 && (
          <Section
            title="Recent account activity"
            subtitle="Swaps, transfers & stakes across Sui"
            count={accountActivity.length}
          >
            <div className="surface-card overflow-hidden rounded-card">
              {visibleAccountActivity.map((a, i) => (
                <AccountActivityRow key={`${a.digest}:${i}`} item={a} i={i} />
              ))}
            </div>
            {accountActivity.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllAccountActivity((v) => !v)}
                className="mt-1 w-full bg-whisper-gray px-3 py-2 text-caption font-medium text-muted-ash transition-colors hover:bg-light-taupe hover:text-midnight-ink rounded-card"
              >
                {showAllAccountActivity
                  ? "Show less"
                  : `Show ${accountActivity.length - 6} more`}
              </button>
            )}
          </Section>
        )}

        {/* ───── Empty fallback ───── */}
        {account &&
          vaultData &&
          vaultData.positions.length === 0 &&
          pending.length === 0 &&
          holdings.length === 0 &&
          activity.length === 0 &&
          accountActivity.length === 0 &&
          dcaOrders.length === 0 && (
            <EmptyCard>
              <span className="text-muted-ash">
                Nothing in your garden yet. Plant a seed →
              </span>
            </EmptyCard>
          )}
      </main>

      <RedeemDialog
        position={openPosition}
        open={!!openPosition}
        onOpenChange={(o) => !o && setOpenPosition(null)}
        onSuccess={() => {
          // Re-fetch after a brief delay so the new pending request shows.
          setTimeout(refresh, 800);
        }}
      />

      <DcaCancelDialog
        order={cancelDca}
        open={!!cancelDca}
        onOpenChange={(o) => !o && setCancelDca(null)}
        onSuccess={() => {
          setCancelDca(null);
          setTimeout(refreshDca, 800);
        }}
      />
    </CinematicShell>
  );
}

// ─────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────

/** Signed-out gate — mirrors the connected hero rhythm (bare on canvas). */
function ConnectGate() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.55, bounce: 0.15 }}
      className="mx-auto my-auto flex w-full max-w-sm flex-col items-center gap-6 text-center"
    >
      <div className="space-y-2">
        <h1 className="font-alt text-title font-medium tracking-tight text-midnight-ink">
          Connect your wallet
        </h1>
        <p className="mx-auto max-w-xs text-body-sm text-muted-ash">
          See your holdings, vault positions, and the yield they earn — all in
          one place.
        </p>
      </div>

      <WalletButton />
    </motion.div>
  );
}

/**
 * Loading placeholder mirroring the hero + section rows. Bars use a darker
 * neutral than the default whisper-gray skeleton so they stay visible on the
 * bare canvas (whisper-gray ≈ the page color).
 */
function Bar({ className }: { className?: string }) {
  return <Skeleton className={cn("bg-midnight-ink/[0.07]", className)} />;
}

function RowSkeleton() {
  return (
    <div className="surface-card flex items-center gap-3 px-4 py-3 rounded-card">
      <Bar className="size-10 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Bar className="h-3.5 w-28 rounded-card" />
        <Bar className="h-3 w-20 rounded-card" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Bar className="h-3.5 w-16 rounded-card" />
        <Bar className="h-3 w-12 rounded-card" />
      </div>
    </div>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="flex flex-col items-center gap-3.5 pt-1 text-center">
        <Bar className="h-3 w-24 rounded-card" />
        <Bar className="h-14 w-56 rounded-card" />
        <Bar className="h-4 w-64 rounded-card" />
      </div>
      {/* Two section blocks */}
      {[3, 2].map((n, s) => (
        <div key={s} className="space-y-3">
          <div className="space-y-1.5 px-1">
            <Bar className="h-4 w-40 rounded-card" />
            <Bar className="h-3 w-24 rounded-card" />
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: n }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-3"
    >
      <div className="flex items-baseline justify-between gap-3 px-1">
        <div className="space-y-0.5">
          <h2 className="text-body-lg font-medium text-midnight-ink">
            {title}{" "}
            <span className="text-muted-ash tabular-nums">
              · {count}
            </span>
          </h2>
          {subtitle && (
            <p className="text-caption text-muted-ash">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">{children}</div>
    </motion.section>
  );
}

function DcaPortfolioRow({
  o,
  i,
  now,
  onCancel,
}: {
  o: DcaOrderView;
  i: number;
  now: number;
  onCancel: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * i, duration: 0.25 }}
      className="flex flex-col gap-2.5 surface-card px-4 py-3 rounded-card"
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <AssetIcon src={o.payIcon} label={o.paySymbol} size={36} />
          <SproutBadge />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 truncate text-body-sm font-medium text-midnight-ink">
              <Repeat className="size-3 text-muted-ash" strokeWidth={2.4} />
              {o.paySymbol} → {o.targetSymbol}
            </span>
            <Tag tone={o.isActive ? "green" : "neutral"}>
              {o.isActive ? "Active" : o.status}
            </Tag>
          </div>
          <span className="truncate text-caption tabular-nums text-muted-ash">
            {fmtAmount(o.amountPerOrderHuman)} {o.paySymbol} · every{" "}
            {fmtInterval(o.intervalMs)}
            {o.maxPrice != null &&
              ` · ≤ ${fmtAmount(o.maxPrice)} ${o.paySymbol}`}
          </span>
        </div>
        {o.isActive && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex shrink-0 items-center gap-1 bg-whisper-gray px-3 py-1.5 text-caption font-medium text-midnight-ink ring-1 ring-hairline transition-colors hover:bg-destructive/10 rounded-button"
          >
            <XIcon className="size-3" strokeWidth={2.4} />
            Cancel
          </button>
        )}
      </div>

      <div className="space-y-1">
        <div className="h-1.5 w-full overflow-hidden bg-midnight-ink/[0.06] rounded-full">
          <div
            className="h-full bg-deliver-green rounded-full"
            style={{ width: `${Math.max(2, o.progressPct)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-caption tabular-nums text-muted-ash">
          <span>
            {o.filled}/{o.numOrders} filled · {fmtAmount(o.obtainedHuman)}{" "}
            {o.targetSymbol} bought
          </span>
          {o.isActive && o.nextExecTs && (
            <span>next in {fmtCountdown(o.nextExecTs, now)}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function HoldingRow({ h, i }: { h: TokenHolding; i: number }) {
  const hasPrice = typeof h.priceUsd === "number" && h.priceUsd > 0;
  const hasValue = typeof h.valueUsd === "number";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.03 * i, duration: 0.2 }}
      className="surface-card flex items-center gap-3 px-4 py-3 rounded-card"
    >
      <AssetIcon src={h.iconUrl} label={h.symbol} size={40} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-body font-medium text-midnight-ink">
          {h.symbol}
        </span>
        <span className="truncate text-caption text-muted-ash">
          {hasPrice && fmtPriceUsd(h.priceUsd!)}
          {hasPrice && !h.known ? " · " : ""}
          {!h.known && (
            <span title={h.coinType}>{truncateCoinType(h.coinType)}</span>
          )}
          {!hasPrice && h.known && "No price"}
        </span>
      </div>
      <div className="flex flex-col items-end leading-tight">
        <span className="text-body font-medium tabular-nums text-midnight-ink">
          {hasValue ? fmtUsd(h.valueUsd!) : fmtAmount(h.balance)}
        </span>
        <span className="text-caption tabular-nums text-muted-ash">
          {fmtAmount(h.balance)} {h.symbol}
        </span>
      </div>
    </motion.div>
  );
}

function EmptyCard({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={cn("rounded-card", 
        "surface-card flex items-center gap-2.5 px-4 py-4 text-body-sm",
        tone === "warn" && "ring-1 ring-warning/35",
      )}
    >
      {children}
    </div>
  );
}

function PositionRow({
  p,
  i,
  onWithdraw,
}: {
  p: VaultBalancePosition;
  i: number;
  onWithdraw: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * i, duration: 0.25 }}
      className="surface-card flex items-center gap-3 px-4 py-3 rounded-card"
    >
      <div className="relative shrink-0">
        <AssetIcon
          src={p.vaultLogoUrl}
          label={p.vaultName}
          size={40}
        />
        <SproutBadge />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body font-medium text-midnight-ink">
            {p.vaultName}
          </span>
          <Tag tone="green">{fmtPct(p.apyPct)}</Tag>
        </div>
        <span className="truncate text-caption tabular-nums text-muted-ash">
          {fmtAmount(p.shares)} shares · {p.depositSymbol}
          {p.withdrawalPeriodDays
            ? ` · ${p.withdrawalPeriodDays}d lockup`
            : ""}
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-body font-medium tabular-nums text-midnight-ink">
          {fmtUsd(p.positionValueUsd)}
        </span>
        <button
          type="button"
          onClick={onWithdraw}
          className="bg-whisper-gray px-3 py-1 text-caption font-medium text-midnight-ink transition-colors hover:bg-light-taupe rounded-button"
        >
          Withdraw
        </button>
      </div>
    </motion.div>
  );
}

function PendingRow({
  w,
  i,
  now,
  positions,
  onCancelled,
}: {
  w: VaultBalanceWithdrawal;
  i: number;
  now: number;
  positions: VaultBalancePosition[];
  onCancelled: () => void;
}) {
  // Lockup days from the active position (best effort).
  const pos = positions.find((p) => p.vaultId === w.vault.id);
  const lockupDays = pos?.withdrawalPeriodDays ?? 0;
  const availableAt = w.requestedAt + lockupDays * 86400_000;
  const ready = now >= availableAt;

  const usd = w.requestedShares * w.receiptCoin.priceUsd;

  const [cancelling, setCancelling] = useState<
    "idle" | "signing" | "confirming" | "error"
  >("idle");
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();

  async function cancel() {
    if (!account) return;
    setCancelling("signing");
    setCancelErr(null);
    try {
      const deployment = await fetchDeployment();
      const tx = new Transaction();
      tx.setSender(account.address);
      const vaultObjectId = (() => {
        for (const [oid, entry] of Object.entries(
          deployment.vaultsByObjectId,
        )) {
          if (entry.receiptCoinType === w.receiptCoin.address) return oid;
        }
        return null;
      })();
      if (!vaultObjectId)
        throw new Error("No on-chain vault object found.");
      appendCancelRedeemCall({
        tx,
        gateway: {
          packageId: deployment.packageId,
          protocolConfigId: deployment.protocolConfigId,
        },
        vault: {
          objectId: vaultObjectId,
          depositCoinType: w.depositCoin.address,
          receiptCoinType: w.receiptCoin.address,
        },
        sequenceNumber: w.sequenceNumber,
      });
      const signed = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest =
        signed.$kind === "Transaction"
          ? signed.Transaction.digest
          : signed.FailedTransaction.digest;
      setCancelling("confirming");
      await client.core.waitForTransaction({
        digest,
        include: { effects: true },
      });
      setCancelling("idle");
      setTimeout(onCancelled, 600);
    } catch (e) {
      setCancelling("error");
      setCancelErr((e as Error).message);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * i, duration: 0.25 }}
      className="surface-card flex items-center gap-3 px-4 py-3 rounded-card"
    >
      <StatusDisk tone={ready ? "green" : "gold"}>
        {ready ? (
          <Check className="size-4" strokeWidth={2.6} />
        ) : (
          <Clock className="size-4" strokeWidth={2.4} />
        )}
      </StatusDisk>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body font-medium text-midnight-ink">
            {w.vault.name}
          </span>
          <Tag tone={ready ? "green" : "gold"}>
            {ready ? "Ready" : "Pending"}
          </Tag>
        </div>
        <span className="truncate text-caption tabular-nums text-muted-ash">
          {fmtAmount(w.requestedShares)} {w.receiptCoin.symbol} ·{" "}
          {ready ? "processing window open" : fmtCountdown(availableAt, now)}{" "}
          · requested {fmtRelative(w.requestedAt)}
        </span>
        {cancelErr && (
          <span className="truncate text-caption text-destructive">
            {cancelErr}
          </span>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {Number.isFinite(usd) && usd > 0 && (
          <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
            ≈{fmtUsd(usd)}
          </span>
        )}
        <div className="flex items-center gap-1">
          <a
            href={`https://suiscan.xyz/mainnet/tx/${w.txDigest}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-caption text-muted-ash hover:text-midnight-ink"
          >
            {w.txDigest.slice(0, 6)}…
            <ExternalLink className="size-3" strokeWidth={2.2} />
          </a>
          <button
            type="button"
            onClick={cancel}
            disabled={cancelling === "signing" || cancelling === "confirming"}
            className="inline-flex items-center gap-0.5 bg-whisper-gray px-2.5 py-1 text-caption font-medium text-midnight-ink transition-colors hover:bg-light-taupe disabled:opacity-50 rounded-button"
          >
            {cancelling === "signing" || cancelling === "confirming" ? (
              <Loader2 className="size-3 animate-spin" strokeWidth={2.4} />
            ) : (
              <XIcon className="size-3" strokeWidth={2.4} />
            )}
            Cancel
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * One row in an activity log (vault or account). Lives inside a single grouped
 * surface-card; rows are hairline-divided. Coin movement renders via the shared
 * CoinFlow when `coins` are given, else the plain `subtitle`.
 */
function ActivityLine({
  i,
  icon,
  title,
  muted,
  coins,
  subtitle,
  valueUsd,
  valuePrefix,
  timestampMs,
  failed = false,
  href,
}: {
  i: number;
  icon: React.ReactNode;
  title: string;
  muted?: string;
  coins?: TxCoin[];
  subtitle?: string;
  valueUsd?: number;
  valuePrefix?: string;
  timestampMs: number;
  failed?: boolean;
  href?: string;
}) {
  const inner = (
    <>
      {icon}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body-sm font-medium text-midnight-ink">
            {title}
          </span>
          {muted && (
            <span className="truncate text-caption text-muted-ash">
              · {muted}
            </span>
          )}
          {failed && (
            <Tag tone="red" className="ml-0.5 shrink-0">
              Failed
            </Tag>
          )}
        </div>
        <div className="mt-0.5 text-caption tabular-nums text-muted-ash">
          {coins && coins.length > 0 ? (
            <CoinFlow coins={coins} />
          ) : subtitle ? (
            <span className="block truncate">{subtitle}</span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end leading-tight">
        {typeof valueUsd === "number" && valueUsd > 0 && (
          <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
            {valuePrefix}
            {fmtUsd(valueUsd)}
          </span>
        )}
        <span className="text-caption tabular-nums text-muted-ash">
          {fmtRelative(timestampMs)}
        </span>
      </div>
    </>
  );

  const className = cn(
    "flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0",
    href && "group transition-colors hover:bg-whisper-gray/50",
  );
  const motionProps = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.03 * i, duration: 0.2 },
  };

  return href ? (
    <motion.a
      {...motionProps}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {inner}
    </motion.a>
  ) : (
    <motion.div {...motionProps} className={className}>
      {inner}
    </motion.div>
  );
}

function ActivityRow({
  item,
  i,
}: {
  item: VaultBalanceHistoryItem;
  i: number;
}) {
  if (item.type === "Deposit") {
    return (
      <ActivityLine
        i={i}
        icon={
          <StatusDisk tone="green">
            <ArrowDownLeft className="size-4" strokeWidth={2.4} />
          </StatusDisk>
        }
        title="Deposited"
        muted={item.vault.name}
        coins={[
          { symbol: item.depositCoin.symbol, amount: -item.depositAmount },
          { symbol: item.receiptCoin.symbol, amount: item.receivedShares },
        ]}
        valueUsd={item.depositAmount * item.depositCoin.priceUsd}
        timestampMs={item.timestamp}
      />
    );
  }

  if (item.type === "RedeemRequest") {
    return (
      <ActivityLine
        i={i}
        icon={
          <StatusDisk tone="gold">
            <Clock className="size-4" strokeWidth={2.4} />
          </StatusDisk>
        }
        title="Withdrawal requested"
        muted={item.vault.name}
        coins={[{ symbol: item.receiptCoin.symbol, amount: -item.shares }]}
        valueUsd={item.shares * item.receiptCoin.priceUsd}
        valuePrefix="≈"
        timestampMs={item.timestamp}
      />
    );
  }

  if (item.type === "RedeemRequestProcessed") {
    return (
      <ActivityLine
        i={i}
        icon={
          <StatusDisk tone="green">
            <Check className="size-4" strokeWidth={2.6} />
          </StatusDisk>
        }
        title="Withdrawal completed"
        muted={item.vault.name}
        coins={[
          { symbol: item.receiptCoin.symbol, amount: -item.redeemedShares },
          { symbol: item.receivedCoin.symbol, amount: item.receivedAmount },
        ]}
        valueUsd={item.receivedAmount * item.receivedCoin.priceUsd}
        timestampMs={item.timestamp}
      />
    );
  }

  return null;
}

function AccountActivityRow({ item, i }: { item: TxActivity; i: number }) {
  return (
    <ActivityLine
      i={i}
      icon={
        <AssetIcon
          src={item.protocol?.img}
          label={item.protocol?.name ?? item.activity}
          size={36}
        />
      }
      title={item.activity}
      muted={item.protocol?.name}
      coins={item.coins}
      failed={!!item.status && item.status !== "SUCCESS"}
      timestampMs={item.timestampMs}
      href={`https://suiscan.xyz/mainnet/tx/${item.digest}`}
    />
  );
}
