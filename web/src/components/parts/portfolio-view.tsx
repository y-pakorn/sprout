"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Sprout,
  Clock,
  ArrowDownLeft,
  Check,
  ExternalLink,
  X as XIcon,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { AssetIcon } from "@/components/asset-icon";
import { CinematicShell } from "@/components/parts/cinematic-shell";
import { RedeemDialog } from "@/components/parts/redeem-dialog";
import { useVaultBalance } from "@/lib/client-vault-balance";
import { useWalletHoldings, type TokenHolding } from "@/lib/client-wallet";
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
  const [openPosition, setOpenPosition] = useState<VaultBalancePosition | null>(
    null,
  );
  const [showAllActivity, setShowAllActivity] = useState(false);

  // Tick every 30s for the pending countdowns.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const vaultData = vaultState.data;
  const holdings = holdingsState.data ?? [];

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

  function refresh() {
    refreshVaults();
    refreshHoldings();
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
        {/* ───── Hero — total value ───── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", visualDuration: 0.55, bounce: 0.15 }}
          className="space-y-2 text-center"
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-canvas-white/55">
            Your garden
          </p>
          <h1
            className="display-tight font-medium leading-[1.05] tracking-tight text-canvas-white tabular-nums"
            style={{
              fontSize: "clamp(48px, 7vw, 88px)",
              textShadow: "0 2px 24px rgba(0,0,0,0.4)",
            }}
          >
            {fmtUsd(totals.totalUsd)}
          </h1>
          <p className="text-body-sm text-canvas-white/70">
            {fmtUsd(totals.holdingsUsd)} in wallet ·{" "}
            <span className="text-canvas-white/90">
              {fmtUsd(totals.positionsUsd)} earning
            </span>
            {totals.blendedApy > 0 && (
              <>
                {" "}
                @{" "}
                <span className="font-semibold text-cash-lime">
                  {fmtPct(totals.blendedApy)} APY
                </span>
              </>
            )}
          </p>
        </motion.div>

        {/* ───── States ───── */}
        {!account && (
          <EmptyCard>
            <span className="text-canvas-white">
              Connect your wallet to see your full portfolio.
            </span>
          </EmptyCard>
        )}
        {account && loading && (
          <EmptyCard>
            <Loader2 className="size-4 animate-spin text-canvas-white/70" />
            <span className="text-canvas-white/70">Loading portfolio…</span>
          </EmptyCard>
        )}
        {account && error && (
          <EmptyCard tone="warn">
            <AlertTriangle className="size-4 text-warning" strokeWidth={2.4} />
            <span className="text-canvas-white">Couldn't load: {error}</span>
            <button
              type="button"
              onClick={refresh}
              className="ml-auto bg-canvas-white/10 px-3 py-1 text-caption font-semibold text-canvas-white hover:bg-canvas-white/20"
              style={{ borderRadius: 9999 }}
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

        {/* ───── Activity ───── */}
        {account && vaultData && activity.length > 0 && (
          <Section
            title="Recent activity"
            subtitle="Deposits, withdrawals, and processed redemptions"
            count={activity.length}
          >
            {visibleActivity.map((h, i) => (
              <ActivityRow key={i} item={h} i={i} />
            ))}
            {activity.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllActivity((v) => !v)}
                className="mt-1 w-full bg-canvas-white/8 px-3 py-2 text-caption font-medium text-canvas-white/70 transition-colors hover:bg-canvas-white/15 hover:text-canvas-white"
                style={{ borderRadius: 12 }}
              >
                {showAllActivity
                  ? "Show less"
                  : `Show ${activity.length - 6} more`}
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
          activity.length === 0 && (
            <EmptyCard>
              <span className="text-canvas-white/55">
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
    </CinematicShell>
  );
}

// ─────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────

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
          <h2 className="text-body-lg font-semibold text-canvas-white">
            {title}{" "}
            <span className="text-canvas-white/40 tabular-nums">
              · {count}
            </span>
          </h2>
          {subtitle && (
            <p className="text-caption text-canvas-white/55">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">{children}</div>
    </motion.section>
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
      className="liquid-glass flex items-center gap-3 px-4 py-3"
      style={{ borderRadius: 18 }}
    >
      <AssetIcon src={h.iconUrl} label={h.symbol} size={40} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-body font-semibold text-canvas-white">
          {h.symbol}
        </span>
        <span className="truncate text-caption text-canvas-white/55">
          {hasPrice && fmtPriceUsd(h.priceUsd!)}
          {hasPrice && !h.known ? " · " : ""}
          {!h.known && (
            <span title={h.coinType}>{truncateCoinType(h.coinType)}</span>
          )}
          {!hasPrice && h.known && "No price"}
        </span>
      </div>
      <div className="flex flex-col items-end leading-tight">
        <span className="text-body font-semibold tabular-nums text-canvas-white">
          {hasValue ? fmtUsd(h.valueUsd!) : fmtAmount(h.balance)}
        </span>
        <span className="text-caption tabular-nums text-canvas-white/55">
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
      className={cn(
        "liquid-glass flex items-center gap-2.5 px-4 py-4 text-body-sm",
        tone === "warn" && "ring-1 ring-warning/35",
      )}
      style={{ borderRadius: 18 }}
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
      className="liquid-glass flex items-center gap-3 px-4 py-3"
      style={{ borderRadius: 18 }}
    >
      <div className="relative shrink-0">
        <AssetIcon
          src={p.vaultLogoUrl}
          label={p.vaultName}
          size={40}
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
          <span className="truncate text-body font-semibold text-canvas-white">
            {p.vaultName}
          </span>
          <span
            className="shrink-0 bg-cash-lime/20 px-1.5 py-0 text-[10px] font-semibold tabular-nums text-cash-lime"
            style={{ borderRadius: 9999 }}
          >
            {fmtPct(p.apyPct)}
          </span>
        </div>
        <span className="truncate text-caption tabular-nums text-canvas-white/55">
          {fmtAmount(p.shares)} shares · {p.depositSymbol}
          {p.withdrawalPeriodDays
            ? ` · ${p.withdrawalPeriodDays}d lockup`
            : ""}
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-body font-semibold tabular-nums text-canvas-white">
          {fmtUsd(p.positionValueUsd)}
        </span>
        <button
          type="button"
          onClick={onWithdraw}
          className="bg-canvas-white/10 px-3 py-1 text-caption font-semibold text-canvas-white transition-colors hover:bg-canvas-white/20"
          style={{ borderRadius: 9999 }}
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
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

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
      const signed = await signAndExecute({ transaction: tx });
      setCancelling("confirming");
      await client.waitForTransaction({
        digest: signed.digest,
        options: { showEffects: true },
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
      className="liquid-glass flex items-center gap-3 px-4 py-3"
      style={{ borderRadius: 18 }}
    >
      <span
        className={cn(
          "inline-flex size-9 shrink-0 items-center justify-center",
          ready ? "bg-cash-lime/20 text-cash-lime" : "bg-warning/15 text-warning",
        )}
        style={{ borderRadius: 9999 }}
      >
        {ready ? (
          <Check className="size-4" strokeWidth={2.6} />
        ) : (
          <Clock className="size-4" strokeWidth={2.4} />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body font-semibold text-canvas-white">
            {w.vault.name}
          </span>
          <span
            className={cn(
              "shrink-0 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider",
              ready
                ? "bg-cash-lime/20 text-cash-lime"
                : "bg-warning/15 text-warning",
            )}
            style={{ borderRadius: 9999 }}
          >
            {ready ? "Ready" : "Pending"}
          </span>
        </div>
        <span className="truncate text-caption tabular-nums text-canvas-white/55">
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
          <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
            ≈{fmtUsd(usd)}
          </span>
        )}
        <div className="flex items-center gap-1">
          <a
            href={`https://suiscan.xyz/mainnet/tx/${w.txDigest}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-caption text-canvas-white/55 hover:text-canvas-white"
          >
            {w.txDigest.slice(0, 6)}…
            <ExternalLink className="size-3" strokeWidth={2.2} />
          </a>
          <button
            type="button"
            onClick={cancel}
            disabled={cancelling === "signing" || cancelling === "confirming"}
            className="inline-flex items-center gap-0.5 bg-canvas-white/10 px-2.5 py-1 text-caption font-semibold text-canvas-white transition-colors hover:bg-canvas-white/20 disabled:opacity-50"
            style={{ borderRadius: 9999 }}
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

function ActivityRow({
  item,
  i,
}: {
  item: VaultBalanceHistoryItem;
  i: number;
}) {
  if (item.type === "Unknown") return null;

  const common = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.03 * i, duration: 0.2 },
    className: "liquid-glass flex items-center gap-3 px-4 py-3",
    style: { borderRadius: 18 },
  };

  if (item.type === "Deposit") {
    const usd = item.depositAmount * item.depositCoin.priceUsd;
    return (
      <motion.div {...common}>
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center bg-cash-lime/20 text-cash-lime"
          style={{ borderRadius: 9999 }}
        >
          <ArrowDownLeft className="size-4" strokeWidth={2.4} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-sm font-semibold text-canvas-white">
            Deposit · {item.vault.name}
          </span>
          <span className="truncate text-caption tabular-nums text-canvas-white/55">
            {fmtAmount(item.depositAmount)} {item.depositCoin.symbol} →{" "}
            {fmtAmount(item.receivedShares)} {item.receiptCoin.symbol}
          </span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          {usd > 0 && (
            <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
              {fmtUsd(usd)}
            </span>
          )}
          <span className="text-caption text-canvas-white/55">
            {fmtRelative(item.timestamp)}
          </span>
        </div>
      </motion.div>
    );
  }

  if (item.type === "RedeemRequest") {
    const usd = item.shares * item.receiptCoin.priceUsd;
    return (
      <motion.div {...common}>
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center bg-warning/15 text-warning"
          style={{ borderRadius: 9999 }}
        >
          <Clock className="size-4" strokeWidth={2.4} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-sm font-semibold text-canvas-white">
            Withdraw request · {item.vault.name}
          </span>
          <span className="truncate text-caption tabular-nums text-canvas-white/55">
            {fmtAmount(item.shares)} {item.receiptCoin.symbol}
          </span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          {usd > 0 && (
            <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
              ≈{fmtUsd(usd)}
            </span>
          )}
          <span className="text-caption text-canvas-white/55">
            {fmtRelative(item.timestamp)}
          </span>
        </div>
      </motion.div>
    );
  }

  if (item.type === "RedeemRequestProcessed") {
    const usd = item.receivedAmount * item.receivedCoin.priceUsd;
    return (
      <motion.div {...common}>
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center bg-cash-lime/20 text-cash-lime"
          style={{ borderRadius: 9999 }}
        >
          <Check className="size-4" strokeWidth={2.6} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-sm font-semibold text-canvas-white">
            Withdrawal completed · {item.vault.name}
          </span>
          <span className="truncate text-caption tabular-nums text-canvas-white/55">
            {fmtAmount(item.redeemedShares)} {item.receiptCoin.symbol} →{" "}
            {fmtAmount(item.receivedAmount)} {item.receivedCoin.symbol}
          </span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          {usd > 0 && (
            <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
              {fmtUsd(usd)}
            </span>
          )}
          <span className="text-caption text-canvas-white/55">
            {fmtRelative(item.timestamp)}
          </span>
        </div>
      </motion.div>
    );
  }

  return null;
}
