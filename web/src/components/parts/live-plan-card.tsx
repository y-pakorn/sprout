"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Loader2,
  ShieldCheck,
  Check,
  ExternalLink,
  ChevronDown,
  ArrowRight,
  Repeat,
  Split,
  Merge,
  RefreshCw,
  X,
  Send,
  AlertTriangle,
  OctagonX,
} from "lucide-react";
import { SLIPPAGE_OPTIONS } from "@/lib/intent";
import { AssetIcon } from "@/components/asset-icon";
import { Tag } from "@/components/ui/tag";
import { StatusDisk } from "@/components/ui/status-disk";
import { Switch } from "@/components/ui/switch";
import {
  VaultRiskDetail,
  RiskMarkdown,
  type RiskVerdict,
} from "@/components/parts/vault-risk-detail";
import { VaultInfoDialog } from "@/components/parts/vault-info-dialog";
import { PtbSummaryStrip } from "@/components/parts/ptb-summary-strip";
import { PtbDialog } from "@/components/parts/ptb-dialog";
import { getGlossary } from "@/lib/ai/vault-glossary";
import type {
  CachedActionPlan,
  ResolvedDepositStep,
  ResolvedSwapStep,
  ResolvedSplitStep,
  ResolvedMergeStep,
  ResolvedRedeemStep,
  ResolvedCancelRedeemStep,
  ResolvedSendStep,
  ResolvedStep,
} from "@/lib/ai/action-plan-cache";
import { providerLabel } from "@/lib/seven-k";
import { dexLabel } from "@/lib/bluefin7k";
import { untrustedDexes } from "@/lib/route-trust";
import { fadeUp, scaleIn, stagger } from "@/lib/motion";
import { fmtAmount, fmtPct, fmtAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWalletHoldings } from "@/lib/client-wallet";
import {
  computeBalanceCheck,
  type BalanceCheck,
} from "@/lib/balance-check";

/* ─────────────────────────────────────────────────────────
 * ANIMATION STORYBOARD — step row expand
 *
 *   click   user taps step row
 *  +0ms    chevron rotates 0° → 180°
 *  +0ms    detail panel height 0 → auto, opacity 0 → 1
 * +180ms   steady expanded state
 * ───────────────────────────────────────────────────────── */
const EXPAND = {
  duration: 0.18,
  ease: "easeOut" as const,
};

type IconLookup = (coinType: string) => string | undefined;

type Props = {
  cached: CachedActionPlan;
  iconLookup: IconLookup;
  onConfirm: () => void;
  onCancel: () => void;
  onAskAgent?: (prompt: string) => void;
  signing: boolean;
  confirming: boolean;
  executed: boolean;
  txDigest?: string;
  txStatus?: "success" | "failure";
  txError?: string;
  gasUsedSui?: number;
  /** Per-deposit-step received shares (human units), indexed by deposit order. */
  receivedShares?: number[];
  walletConnected: boolean;
  /** Optional — only used for plans with ≥1 swap step. */
  slippagePct?: number;
  onSlippageChange?: (pct: number) => void;
  /** "Sprout pays gas" (Enoki sponsorship). Default on upstream. */
  sponsorGas: boolean;
  onSponsorGasChange: (next: boolean) => void;
  /** True once executed AND gas was actually paid by the sponsor. */
  sponsored?: boolean;
  onRefresh?: () => Promise<void>;
};


export function LivePlanCard({
  cached,
  iconLookup,
  onConfirm,
  onCancel,
  onAskAgent,
  signing,
  confirming,
  executed,
  txDigest,
  txStatus,
  txError,
  gasUsedSui,
  receivedShares,
  walletConnected,
  slippagePct,
  onSlippageChange,
  sponsorGas,
  onSponsorGasChange,
  sponsored,
  onRefresh,
}: Props) {
  const [openVaultId, setOpenVaultId] = useState<string | null>(null);
  const [ptbOpen, setPtbOpen] = useState(false);
  const depositSteps = cached.steps.filter(
    (s): s is ResolvedDepositStep => s.kind === "deposit",
  );
  const swapSteps = cached.steps.filter(
    (s): s is ResolvedSwapStep => s.kind === "swap",
  );
  const hasSwapSteps = swapSteps.length > 0;

  // Auto-refresh swap pricing every 5s while idle. Plans without swap
  // steps don't need this — the only volatile inputs are quotes.
  const REFRESH_INTERVAL_MS = 5000;
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const refresh = async () => {
    if (!onRefresh) return;
    if (signing || confirming || executed || inFlight.current || ptbOpen) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  };
  useEffect(() => {
    if (!hasSwapSteps || !onRefresh) return;
    if (signing || confirming || executed || ptbOpen) return;
    const id = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSwapSteps, signing, confirming, executed, ptbOpen]);

  // 1-second tick for the "Updated Xs ago" label. Paused while the PTB dialog
  // is open so the card doesn't re-render (and reflow the viewer) every second.
  const [, tickAge] = useState(0);
  useEffect(() => {
    if (!hasSwapSteps || ptbOpen) return;
    const id = setInterval(() => tickAge((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasSwapSteps, ptbOpen]);
  const ageSec = Math.max(
    0,
    Math.floor((Date.now() - cached.fetchedAt) / 1000),
  );
  const openVault = openVaultId
    ? depositSteps.find((d) => d.vault.id === openVaultId)?.vault ?? null
    : null;

  const walletHoldings = useWalletHoldings();
  const balanceCheck =
    walletHoldings.state.status === "ready"
      ? computeBalanceCheck(
          cached.steps,
          // When Sprout sponsors gas, the wallet needs no SUI for the fee — so
          // a zero-SUI wallet holding only the input coins can still confirm.
          sponsorGas ? 0 : cached.summary.estimatedGasSui,
          walletHoldings.state.data,
        )
      : null;
  const insufficient = balanceCheck?.hasAnyShortfall ?? false;

  const insufficientRow: GuardianRow | null =
    balanceCheck && insufficient
      ? {
          id: "insufficient-balance",
          title: "Insufficient balance",
          summary: shortfallSummary(balanceCheck),
          verdict: "block",
          detail: shortfallDetail(balanceCheck),
          askPrompt: shortfallAskPrompt(balanceCheck),
          extra: (
            <button
              type="button"
              onClick={walletHoldings.refresh}
              className="inline-flex cursor-pointer items-center gap-1 bg-canvas-white px-2.5 py-1 text-caption font-medium text-midnight-ink ring-1 ring-hairline transition-colors hover:bg-light-taupe rounded-button"
            >
              <RefreshCw className="size-3" strokeWidth={2.4} />
              Refresh balance
            </button>
          ),
        }
      : null;

  const rawRisks = buildRisks(cached, sponsorGas);
  const severityOrder: Record<RiskVerdict, number> = {
    block: 0,
    flag: 1,
    pass: 2,
  };
  const risks = [
    ...(insufficientRow ? [insufficientRow] : []),
    ...rawRisks,
  ].sort((a, b) => severityOrder[a.verdict] - severityOrder[b.verdict]);
  const blockRisks = risks.filter((r) => r.verdict === "block");
  const flagRisks = risks.filter((r) => r.verdict === "flag");
  const clearedRisks = risks.filter((r) => r.verdict === "pass");
  const passCount = clearedRisks.length;
  const flagCount = flagRisks.length;
  const blockCount = blockRisks.length;
  const blocking = blockCount > 0;
  const guardianVerdict = blocking
    ? "Sprout flagged this — read carefully before signing."
    : flagCount > 0
      ? `Sprout cleared ${passCount} check${passCount === 1 ? "" : "s"}. ${flagCount} thing${flagCount === 1 ? "" : "s"} to read before signing.`
      : `Sprout cleared all ${passCount} checks. Standard for this kind of position.`;

  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      className="space-y-3 surface-card p-4 rounded-card"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
            Plan
          </span>
          {hasSwapSteps && onRefresh && (
            <span
              className="flex items-center gap-1.5 text-caption text-muted-ash"
              title={
                refreshing
                  ? "Refreshing quote"
                  : ageSec < 2
                    ? "Just refreshed"
                    : `Quote refreshed ${ageSec}s ago`
              }
            >
              <motion.span
                animate={{
                  opacity: refreshing ? [0.4, 1, 0.4] : 1,
                  scale: refreshing ? [0.8, 1, 0.8] : 1,
                }}
                transition={
                  refreshing
                    ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
                    : { duration: 0 }
                }
                className={cn("rounded-full", 
                  "inline-block size-1.5",
                  refreshing ? "bg-deliver-green" : "bg-deliver-green/60",
                )}
              />
              {refreshing
                ? "Live"
                : ageSec < 2
                  ? "Live"
                  : `${ageSec}s`}
            </span>
          )}
        </div>
        {depositSteps.length > 0 && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
              Blended APY
            </span>
            <span
              className="font-semibold tabular-nums text-midnight-ink text-[17px] tracking-[-0.005em]"
            >
              {fmtPct(cached.summary.blendedApyPct)}
            </span>
          </div>
        )}
      </div>

      {/* Step trail — every row expands to show its kind-specific detail.
       *  Steps that pass coins to the next step (swap → deposit, split →
       *  deposit, etc.) get a "flow" connector in the gutter that binds
       *  them visually into one plan. */}
      <motion.ol
        variants={stagger(0.05, 0.1)}
        initial="initial"
        animate="animate"
        className="relative space-y-0"
      >
        {cached.steps.map((s, i) => {
          const next = cached.steps[i + 1];
          const flows = next ? stepFlowsInto(s, next) : false;
          return (
            <motion.li key={s.id} variants={fadeUp} className="relative">
              <ExpandableStep
                step={s}
                idx={i}
                cached={cached}
                iconLookup={iconLookup}
                onOpenVault={(id) => setOpenVaultId(id)}
              />
              {flows && <FlowConnector />}
              {!flows && next && <div className="h-1.5" />}
            </motion.li>
          );
        })}
      </motion.ol>

      {/* Kind-dispatched aggregate stats */}
      <PlanStats cached={cached} sponsorGas={sponsorGas} />

      {/* Real PTB — compact teaser; opens the full interactive viewer. */}
      <PtbSummaryStrip tx={cached.tx} onOpen={() => setPtbOpen(true)} />

      {/* Guardian */}
      <div className="space-y-3 border-t border-hairline/60 pt-3">
        {/* Header — shield disk + verdict prose + tally tags so the user can
         *  read the bottom line and the breakdown at a glance, without
         *  drilling into each row. */}
        <div className="flex items-start gap-2.5">
          <StatusDisk
            tone={blocking ? "red" : flagCount > 0 ? "gold" : "green"}
            solid
            className="size-7"
          >
            <ShieldCheck className="size-3.5" strokeWidth={2.6} />
          </StatusDisk>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="leading-snug">
              <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
                Guardian
              </div>
              <p className="text-body-sm text-midnight-ink">
                {guardianVerdict}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {blockCount > 0 && (
                <Tag tone="red">
                  {blockCount} Blocked
                </Tag>
              )}
              {flagCount > 0 && (
                <Tag tone="gold">
                  {flagCount} Heads up
                </Tag>
              )}
              {passCount > 0 && (
                <Tag tone="green">
                  {passCount} Cleared
                </Tag>
              )}
            </div>
          </div>
        </div>

        {/* Block items — each gets its own destructive-tinted surface so the
         *  user can't miss the thing that prevents signing. Sit visually
         *  above the flag list. */}
        {blockRisks.length > 0 && (
          <div className="space-y-2">
            {blockRisks.map((r) => (
              <GuardianBlockItem
                key={r.id}
                risk={r}
                onAskAgent={onAskAgent}
              />
            ))}
          </div>
        )}

        {/* Flag items — plain rows separated by hairlines on the parent
         *  card surface. No per-row bg tint — the gold verdict icon does
         *  the severity work, so multiple flags don't compound into a wall
         *  of orange that fights the page wash. */}
        {flagRisks.length > 0 && (
          <div className="divide-y divide-hairline/60">
            {flagRisks.map((r) => (
              <GuardianFlagItem
                key={r.id}
                risk={r}
                onAskAgent={onAskAgent}
              />
            ))}
          </div>
        )}

        {/* Cleared items — single disclosure ("X cleared checks") so they
         *  stop crowding the section. Expanding shows each pass as a
         *  compact collapsible row (still drillable if curious). */}
        {clearedRisks.length > 0 && (
          <ClearedRisksDisclosure
            risks={clearedRisks}
            onAskAgent={onAskAgent}
          />
        )}
      </div>

      {/* Sprout-pays-gas toggle — applies to every plan kind. */}
      {!executed && !confirming && (
        <div className="flex items-center justify-between gap-3 border-t border-hairline/60 pt-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-body-sm font-medium text-midnight-ink">
              Sprout pays gas
            </span>
            <span className="text-caption text-muted-ash">
              {sponsorGas
                ? "You sign — Sprout covers the SUI network fee"
                : "You pay the SUI network fee from your wallet"}
            </span>
          </div>
          <Switch
            checked={sponsorGas}
            onCheckedChange={(next) => onSponsorGasChange(next)}
            disabled={signing}
            aria-label="Sprout pays gas"
          />
        </div>
      )}

      {/* Action row */}
      {!executed && !confirming && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 pt-3">
          {hasSwapSteps && onSlippageChange ? (
            <div className="flex items-center gap-2">
              <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
                Slippage
              </span>
              <div className="flex flex-wrap gap-1">
                {SLIPPAGE_OPTIONS.map((opt) => {
                  const active = slippagePct === opt;
                  return (
                    <motion.button
                      key={opt}
                      type="button"
                      onClick={() => onSlippageChange(opt)}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                      transition={{
                        type: "spring",
                        visualDuration: 0.2,
                        bounce: 0.3,
                      }}
                      disabled={signing || confirming}
                      className={cn("rounded-card", 
                        "px-2.5 py-1 text-caption font-medium text-midnight-ink disabled:opacity-50",
                        active
                          ? "bg-midnight-ink !text-canvas-white"
                          : "surface-panel ring-1 ring-hairline",
                      )}
                    >
                      {opt}%
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1.5">
          <motion.button
            onClick={onCancel}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            disabled={signing || confirming}
            className="surface-panel px-3.5 py-1.5 text-body-sm font-medium text-midnight-ink ring-1 ring-hairline disabled:opacity-50 rounded-button"
          >
            Cancel
          </motion.button>
          <motion.button
            onClick={onConfirm}
            whileHover={{ scale: insufficient ? 1 : 1.04 }}
            whileTap={{ scale: insufficient ? 1 : 0.96 }}
            disabled={
              signing || confirming || !walletConnected || insufficient
            }
            className={cn("rounded-button", 
              "inline-flex items-center gap-1.5 px-4 py-1.5 text-body-sm font-medium disabled:bg-light-taupe disabled:text-muted-ash",
              insufficient
                ? "bg-destructive text-canvas-white"
                : blocking
                  ? "bg-destructive text-canvas-white"
                  : "bg-midnight-ink text-canvas-white",
            )}
          >
            {signing && (
              <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
            )}
            {signing
              ? "Signing…"
              : !walletConnected
                ? "Connect wallet first"
                : insufficient && balanceCheck
                  ? shortfallButtonLabel(balanceCheck)
                  : blocking
                    ? "Sign anyway →"
                    : "Confirm & sign →"}
          </motion.button>
          </div>
        </div>
      )}

      {(confirming || executed) && (
        <PlanReceipt
          confirming={confirming}
          txStatus={txStatus}
          txError={txError}
          txDigest={txDigest}
          gasUsedSui={gasUsedSui}
          sponsored={sponsored}
          receivedShares={receivedShares}
          deposits={depositSteps}
        />
      )}

      <VaultInfoDialog
        vault={openVault ?? null}
        open={!!openVaultId}
        onOpenChange={(o) => !o && setOpenVaultId(null)}
        iconLookup={iconLookup}
        onContinue={undefined}
      />

      <PtbDialog
        open={ptbOpen}
        onOpenChange={setPtbOpen}
        tx={cached.tx}
        steps={cached.steps}
      />
    </motion.div>
  );
}

/**
 * Wraps any step row with click-to-expand behavior. The summary line
 * stays as-is; the detail panel is dispatched per step kind.
 */
function ExpandableStep({
  step,
  idx,
  cached,
  iconLookup,
  onOpenVault,
}: {
  step: ResolvedStep;
  idx: number;
  cached: CachedActionPlan;
  iconLookup: IconLookup;
  onOpenVault: (vaultId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="surface-panel overflow-hidden ring-1 ring-hairline rounded-card"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-whisper-gray"
      >
        <StepIndex
          n={idx + 1}
          lit={step.kind === "deposit" || step.kind === "send"}
        />
        <div className="min-w-0 flex-1">
          <StepSummary step={step} iconLookup={iconLookup} />
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-ash transition-transform duration-200",
            open && "rotate-180 text-midnight-ink",
          )}
          strokeWidth={2.4}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={EXPAND}
            className="overflow-hidden"
          >
            {/* Inset recess — whisper-gray sub-panel so the detail reads as
             *  a compartment of the card, distinct from the canvas-white
             *  row above it. */}
            <div className="px-2 pb-2">
              <div className="surface-panel rounded-[12px] px-4 py-3.5">
                <StepDetail
                  step={step}
                  cached={cached}
                  iconLookup={iconLookup}
                  onOpenVault={onOpenVault}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * Detail-panel primitives — hero + meta chips pattern
 * ───────────────────────────────────────────────────────── */

/** Tile-style chip. Significantly more presence than the previous flat
 *  treatment — bg-whisper-gray + 1px ring carves it out of the dark panel
 *  background. Min-width 8rem so values don't get squeezed. */
function DetailChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "warn" | "block" | "lime";
}) {
  return (
    <div
      className={cn("rounded-card", 
        "flex min-w-[8rem] flex-col gap-1 px-3.5 py-2.5 ring-1",
        tone === "warn" && "bg-warning/15 ring-warning/40",
        tone === "block" && "bg-destructive/15 ring-destructive/40",
        tone === "lime" && "bg-deliver-green/10 ring-deliver-green/30",
        tone === "default" && "bg-whisper-gray ring-hairline",
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">
        {label}
      </span>
      <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
        {value}
      </span>
    </div>
  );
}

/** Two-line hero pattern — large numeric value with a small caption
 *  describing the unit. The previous version mashed numbers and token
 *  symbols into one 22px string; this isolates the number as the
 *  headline and demotes denomination text to a caption. */
function NumericHero({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">
        {label}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <span
          className="font-medium tabular-nums text-midnight-ink text-[28px] leading-none tracking-[-0.02em]"
        >
          {value}
        </span>
        <span className="text-body-sm font-medium text-muted-ash">
          {unit}
        </span>
      </div>
    </div>
  );
}

/** Hero with a free-form value (typically `{amount} {symbol}`) and an
 *  optional trailing chip. Used by step kinds where the headline isn't
 *  a pure number (redeem, cancel, split source). */
function DetailHero({
  label,
  value,
  trailing,
}: {
  label: string;
  value: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">
          {label}
        </div>
        <div
          className="truncate font-medium tabular-nums leading-none text-midnight-ink text-[22px] tracking-[-0.015em]"
        >
          {value}
        </div>
      </div>
      {trailing}
    </div>
  );
}

/** Verdict-bearing chip — only tints background on actual alerts
 *  (warn / block). Pass verdict uses the neutral chip palette so a
 *  healthy swap doesn't visually shout. Status dot still carries the
 *  verdict color so the user gets the signal. */
function VerdictChip({
  label,
  value,
  verdict,
  caption,
}: {
  label: string;
  value: React.ReactNode;
  verdict: "pass" | "warn" | "block";
  caption: string;
}) {
  const palette =
    verdict === "block"
      ? "bg-destructive/20 ring-destructive/50"
      : verdict === "warn"
        ? "bg-warning/20 ring-warning/50"
        : "bg-whisper-gray ring-hairline";
  const dotColor =
    verdict === "block"
      ? "bg-destructive"
      : verdict === "warn"
        ? "bg-warning"
        : "bg-deliver-green";
  return (
    <div
      className={cn(
        "flex min-w-[7rem] shrink-0 flex-col items-start gap-1.5 rounded-card px-3.5 py-2 ring-1",
        palette,
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">
        {label}
      </span>
      <span className="flex items-baseline gap-2">
        <span
          className="font-medium tabular-nums leading-none text-midnight-ink text-[20px] tracking-[-0.015em]"
        >
          {value}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">
          <span className={cn("inline-block size-1.5 rounded-full", dotColor)} />
          {caption}
        </span>
      </span>
    </div>
  );
}

/** Section label + optional right-aligned meta, used to separate clusters. */
function DetailSectionLabel({
  label,
  meta,
}: {
  label: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-ash">
        {label}
      </span>
      {meta && (
        <span className="text-caption text-muted-ash">{meta}</span>
      )}
    </div>
  );
}

/**
 * Per-kind summary — the one-line content shown in the collapsed row.
 * Kept lightweight: just enough to tell the user what each step does at
 * a glance. The detail panel handles depth.
 */
function StepSummary({
  step,
  iconLookup,
}: {
  step: ResolvedStep;
  iconLookup: IconLookup;
}) {
  if (step.kind === "swap") return <SwapSummary s={step} iconLookup={iconLookup} />;
  if (step.kind === "split") return <SplitSummary s={step} iconLookup={iconLookup} />;
  if (step.kind === "merge") return <MergeSummary s={step} iconLookup={iconLookup} />;
  if (step.kind === "deposit") return <DepositSummary s={step} iconLookup={iconLookup} />;
  if (step.kind === "redeemFromVault") return <RedeemSummary s={step} iconLookup={iconLookup} />;
  if (step.kind === "send") return <SendSummary s={step} iconLookup={iconLookup} />;
  return <CancelSummary s={step} />;
}

function StepDetail({
  step,
  cached,
  iconLookup,
  onOpenVault,
}: {
  step: ResolvedStep;
  cached: CachedActionPlan;
  iconLookup: IconLookup;
  onOpenVault: (vaultId: string) => void;
}) {
  if (step.kind === "swap") return <SwapDetail s={step} iconLookup={iconLookup} />;
  if (step.kind === "split") return <SplitDetail s={step} />;
  if (step.kind === "merge") return <MergeDetail s={step} cached={cached} />;
  if (step.kind === "deposit")
    return <DepositDetail s={step} onOpenVault={onOpenVault} />;
  if (step.kind === "redeemFromVault") return <RedeemDetail s={step} />;
  if (step.kind === "send") return <SendDetail s={step} iconLookup={iconLookup} />;
  return <CancelDetail s={step} />;
}

/* ─────────────────────────────────────────────────────────
 * Per-kind summary rows — collapsed view (one-line content)
 * ───────────────────────────────────────────────────────── */

function RedeemSummary({
  s,
  iconLookup,
}: {
  s: ResolvedRedeemStep;
  iconLookup: IconLookup;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AssetIcon
        src={s.vault.logoUrl ?? iconLookup(s.vault.depositCoinType)}
        label={s.vault.name}
        size={20}
      />
      <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
        {fmtAmount(s.sharesHuman)}
      </span>
      <span className="text-caption text-muted-ash">{s.receiptSymbol}</span>
      <ArrowRight
        className="size-3 shrink-0 text-muted-ash"
        strokeWidth={2.4}
      />
      <span className="truncate text-body-sm font-medium text-midnight-ink">
        {s.vault.name}
      </span>
      <span className="ml-auto inline-flex items-center gap-1 text-caption font-medium uppercase tracking-wider text-muted-ash">
        <Repeat className="size-3 -scale-x-100" strokeWidth={2.4} />
        {s.vault.withdrawalPeriodDays
          ? `≤${s.vault.withdrawalPeriodDays}d`
          : "Withdraw"}
      </span>
    </div>
  );
}

function SendSummary({
  s,
  iconLookup,
}: {
  s: ResolvedSendStep;
  iconLookup: IconLookup;
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5">
      <AssetIcon src={iconLookup(s.coinType)} label={s.symbol} size={20} />
      <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
        {fmtAmount(s.amountHuman)}
      </span>
      <span className="text-caption text-muted-ash">{s.symbol}</span>
      <ArrowRight
        className="size-3 shrink-0 text-muted-ash"
        strokeWidth={2.4}
      />
      <span className="truncate text-body-sm font-medium text-midnight-ink">
        {s.recipientName ?? fmtAddress(s.recipient)}
      </span>
      <span className="ml-auto inline-flex items-center gap-1 text-caption font-medium uppercase tracking-wider text-muted-ash">
        <Send className="size-3" strokeWidth={2.4} />
        Send
      </span>
    </div>
  );
}

function CancelSummary({ s }: { s: ResolvedCancelRedeemStep }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="truncate text-body-sm font-medium text-midnight-ink">
        Cancel withdrawal · {s.vault.name}
      </span>
      <span className="text-caption text-muted-ash">
        req #{s.sequenceNumber}
      </span>
      <span className="ml-auto inline-flex items-center gap-1 text-caption font-medium uppercase tracking-wider text-muted-ash">
        <X className="size-3" strokeWidth={2.4} />
        Cancel
      </span>
    </div>
  );
}

function StepIndex({ n, lit }: { n: number; lit?: boolean }) {
  return (
    <span
      className={cn("rounded-button", 
        "inline-flex size-6 shrink-0 items-center justify-center text-caption font-medium tabular-nums transition-colors",
        lit
          ? "bg-whisper-gray text-midnight-ink group-hover:bg-deliver-green"
          : "bg-whisper-gray text-midnight-ink",
      )}
    >
      {n}
    </span>
  );
}

function MergeSummary({
  s,
  iconLookup,
}: {
  s: ResolvedMergeStep;
  iconLookup: IconLookup;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex flex-wrap items-center gap-1">
        {s.sources.map((src, i) => (
          <span
            key={i}
            className="inline-flex items-center bg-whisper-gray px-1.5 py-0 text-caption tabular-nums text-midnight-ink rounded-card"
          >
            {fmtAmount(src.human)}
          </span>
        ))}
      </span>
      <ArrowRight
        className="size-3 shrink-0 text-muted-ash"
        strokeWidth={2.4}
      />
      <AssetIcon src={iconLookup(s.coinType)} label={s.symbol} size={20} />
      <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
        {fmtAmount(s.totalHuman)}
      </span>
      <span className="text-caption text-muted-ash">{s.symbol}</span>
      <span className="ml-auto inline-flex items-center gap-1 text-caption font-medium uppercase tracking-wider text-muted-ash">
        <Merge className="size-3" strokeWidth={2.4} />
        Merge
      </span>
    </div>
  );
}

function SwapSummary({
  s,
  iconLookup,
}: {
  s: ResolvedSwapStep;
  iconLookup: IconLookup;
}) {
  const impact =
    s.impactPct !== undefined && s.impactPct > 0
      ? s.impactPct < 0.001
        ? "<0.001%"
        : `${s.impactPct.toFixed(3)}%`
      : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AssetIcon
        src={iconLookup(s.fromCoinType)}
        label={s.fromSymbol}
        size={20}
      />
      <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
        {fmtAmount(s.fromAmountHuman)}
      </span>
      <span className="text-caption text-muted-ash">{s.fromSymbol}</span>
      <ArrowRight
        className="size-3 shrink-0 text-muted-ash"
        strokeWidth={2.4}
      />
      <AssetIcon
        src={iconLookup(s.toCoinType)}
        label={s.toSymbol}
        size={20}
      />
      <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
        ≈ {fmtAmount(s.toAmountHuman)}
      </span>
      <span className="text-caption text-muted-ash">{s.toSymbol}</span>
      <span className="ml-auto inline-flex items-center gap-1 text-caption font-medium uppercase tracking-wider text-muted-ash">
        <Repeat className="size-3" strokeWidth={2.4} />
        {impact ? `Swap · ${impact}` : "Swap"}
      </span>
    </div>
  );
}

function SplitSummary({
  s,
  iconLookup,
}: {
  s: ResolvedSplitStep;
  iconLookup: IconLookup;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AssetIcon
        src={iconLookup(s.sourceCoinType)}
        label={s.sourceSymbol}
        size={20}
      />
      <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
        {fmtAmount(s.totalHuman)}
      </span>
      <span className="text-caption text-muted-ash">{s.sourceSymbol}</span>
      <ArrowRight
        className="size-3 shrink-0 text-muted-ash"
        strokeWidth={2.4}
      />
      <span className="flex flex-wrap items-center gap-1">
        {s.portions.map((p, i) => (
          <span
            key={i}
            className="inline-flex items-center bg-whisper-gray px-2 py-0 text-caption font-medium tabular-nums text-midnight-ink rounded-card"
          >
            {(p.bps / 100).toFixed(p.bps % 100 === 0 ? 0 : 2)}%
          </span>
        ))}
      </span>
      <span className="ml-auto inline-flex items-center gap-1 text-caption font-medium uppercase tracking-wider text-muted-ash">
        <Split className="size-3" strokeWidth={2.4} />
        Split
      </span>
    </div>
  );
}

function DepositSummary({
  s,
  iconLookup,
}: {
  s: ResolvedDepositStep;
  iconLookup: IconLookup;
}) {
  const lockup = s.vault.withdrawalPeriodDays
    ? `${s.vault.withdrawalPeriodDays}d lockup`
    : null;
  return (
    <div className="flex w-full items-center gap-2.5">
      <div className="flex shrink-0 items-center gap-1.5">
        <AssetIcon
          src={iconLookup(s.sourceCoinType)}
          label={s.sourceSymbol}
          size={20}
        />
        <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
          {fmtAmount(s.amountHuman)}
        </span>
        <span className="text-caption text-muted-ash">{s.sourceSymbol}</span>
      </div>
      <ArrowRight
        className="size-3 shrink-0 text-muted-ash"
        strokeWidth={2.4}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-sm font-medium leading-tight text-midnight-ink">
          {s.vault.name}
        </div>
        <div className="truncate text-caption leading-tight text-muted-ash">
          {s.vault.category}
          {lockup ? ` · ${lockup}` : ""}
        </div>
        <RiskTags vault={s.vault} />
      </div>
      <div className="text-right leading-tight">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-ash">
          APY
        </div>
        <div className="text-body-sm font-medium tabular-nums text-midnight-ink">
          {fmtPct(s.vault.apyPct)}
        </div>
      </div>
    </div>
  );
}

const RISK_PROFILE_TONE: Record<string, "green" | "gold" | "red"> = {
  principal_protected: "green",
  balanced: "gold",
  volatile: "red",
};
const RISK_FLAG_TAGS: Record<
  string,
  { label: string; tone: "neutral" | "gold" | "red" }
> = {
  kyc_required: { label: "KYC", tone: "gold" },
  deprecated: { label: "Deprecated", tone: "red" },
  private: { label: "Private", tone: "neutral" },
  rwa: { label: "RWA", tone: "neutral" },
  beta: { label: "Beta", tone: "gold" },
};

/** Risk-profile + high-signal flag chips for a vault, surfaced on the deposit
 *  row so the classification is visible at a glance (independent of the
 *  agent's Guardian narrative). */
function RiskTags({ vault }: { vault: ResolvedDepositStep["vault"] }) {
  const profile = vault.riskProfile;
  const flags = (vault.flagSlugs ?? [])
    .filter((s) => s in RISK_FLAG_TAGS)
    .slice(0, 2);
  if (!profile && flags.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1">
      {profile && (
        <Tag tone={RISK_PROFILE_TONE[profile.slug] ?? "neutral"}>
          {profile.name}
        </Tag>
      )}
      {flags.map((s) => (
        <Tag key={s} tone={RISK_FLAG_TAGS[s].tone}>
          {RISK_FLAG_TAGS[s].label}
        </Tag>
      ))}
    </div>
  );
}

function summarizeDeposits(deposits: ResolvedDepositStep[]): string {
  if (deposits.length === 0) return "—";
  const byToken = new Map<string, number>();
  for (const d of deposits) {
    byToken.set(
      d.sourceSymbol,
      (byToken.get(d.sourceSymbol) ?? 0) + d.amountHuman,
    );
  }
  if (byToken.size === 1) {
    const [[sym, total]] = Array.from(byToken.entries());
    return `${fmtAmount(total)} ${sym}`;
  }
  return Array.from(byToken.entries())
    .map(([sym, total]) => `${fmtAmount(total)} ${sym}`)
    .join(" + ");
}

function Stat({
  label,
  value,
  struck,
  tone = "default",
}: {
  label: string;
  value: string;
  /** When set, render this struck through (in muted ink) before `value` —
   *  used for the sponsored gas tile (estimate crossed out, "0 SUI" in green). */
  struck?: string;
  tone?: "default" | "lime";
}) {
  return (
    <div
      className={cn("rounded-card",
        "surface-panel px-3 py-2",
        tone === "lime" && "bg-deliver-green/15",
      )}
    >
      <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 text-body font-medium tabular-nums">
        {struck && (
          <span className="text-muted-ash line-through">{struck}</span>
        )}
        <span className={cn(struck ? "text-deliver-green" : "text-midnight-ink")}>
          {value}
        </span>
      </div>
    </div>
  );
}

type GuardianRow = {
  id: string;
  title: string;
  summary: string;
  verdict: RiskVerdict;
  detail: string;
  askPrompt: string;
  /** Optional extra body content rendered below the markdown detail (e.g. a
   *  refresh-balance button on the insufficient-balance row). */
  extra?: React.ReactNode;
};

/**
 * Block-severity row. Demands resolution before signing, so it gets its
 * own destructive-tinted surface, a prominent red icon disk, and
 * canvas-white action buttons that pop above the tint.
 */
function GuardianBlockItem({
  risk,
  onAskAgent,
}: {
  risk: GuardianRow;
  onAskAgent?: (prompt: string) => void;
}) {
  return (
    <div className="rounded-card bg-destructive/[0.06] px-3.5 py-3">
      <div className="flex items-start gap-3">
        <StatusDisk tone="red" solid className="mt-0.5 size-8">
          <OctagonX className="size-4" strokeWidth={2.4} />
        </StatusDisk>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="leading-snug">
            <div className="text-body font-medium text-midnight-ink">
              {risk.title}
            </div>
            {risk.summary && risk.summary !== risk.title && (
              <div className="text-body-sm text-midnight-ink/80">
                {risk.summary}
              </div>
            )}
          </div>
          {risk.detail && <RiskMarkdown>{risk.detail}</RiskMarkdown>}
          {(risk.extra || onAskAgent) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {risk.extra}
              {onAskAgent && (
                <button
                  type="button"
                  onClick={() => onAskAgent(risk.askPrompt)}
                  className="inline-flex cursor-pointer items-center gap-1 bg-canvas-white px-2.5 py-1 text-caption font-medium text-midnight-ink ring-1 ring-hairline transition-colors hover:bg-light-taupe rounded-button"
                >
                  Ask Sprout to explain →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Flag-severity row. Sits on the parent card surface — no per-row bg tint.
 * Click-to-expand: the `title — summary` line stays always visible (carries
 * the key finding for scanning); the educational body collapses behind a
 * chevron. With four flags this turns a 20-line slab into four scannable
 * one-liners, with the option to read more on demand.
 */
function GuardianFlagItem({
  risk,
  onAskAgent,
}: {
  risk: GuardianRow;
  onAskAgent?: (prompt: string) => void;
}) {
  const hasBody = !!risk.detail || !!risk.extra;
  const [open, setOpen] = useState(false);

  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        disabled={!hasBody}
        className={cn(
          "flex w-full items-start gap-2.5 text-left",
          hasBody && "cursor-pointer",
        )}
      >
        <AlertTriangle
          className="mt-[3px] size-3.5 shrink-0 text-warning"
          strokeWidth={2.4}
        />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="text-body-sm font-medium text-midnight-ink">
            {risk.title}
          </span>
          {risk.summary && risk.summary !== risk.title && (
            <span className="text-body-sm text-muted-ash">
              {" — "}
              {risk.summary}
            </span>
          )}
        </p>
        {hasBody && (
          <ChevronDown
            className={cn(
              "mt-[3px] size-3.5 shrink-0 text-muted-ash transition-transform duration-200",
              open && "rotate-180",
            )}
            strokeWidth={2.4}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && hasBody && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="ml-6 mt-2 space-y-2">
              {risk.detail && (
                <RiskMarkdown className="text-caption leading-relaxed text-muted-ash">
                  {risk.detail}
                </RiskMarkdown>
              )}
              {risk.extra && <div>{risk.extra}</div>}
              {onAskAgent && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAskAgent(risk.askPrompt);
                  }}
                  className="inline-flex cursor-pointer items-center gap-1 text-caption font-medium text-muted-ash transition-colors hover:text-midnight-ink"
                >
                  Ask Sprout to explain →
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Collapsed bucket for all "pass" Guardian rows. Keeps the section
 * scannable when most checks clear — one row says "X cleared checks",
 * expanding reveals the individual rows (each still drillable for the
 * full markdown body).
 */
function ClearedRisksDisclosure({
  risks,
  onAskAgent,
}: {
  risks: GuardianRow[];
  onAskAgent?: (prompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {/* Toggle row — sits on the parent card surface (canvas-white). No
       *  surrounding panel chrome; the row itself is the affordance. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2.5 py-1.5 text-left"
        aria-expanded={open}
      >
        <Check
          className="size-3.5 shrink-0 text-deliver-green"
          strokeWidth={3}
        />
        <span className="min-w-0 flex-1 text-body-sm font-medium text-midnight-ink">
          {risks.length} cleared check{risks.length === 1 ? "" : "s"}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-ash transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={2.4}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-hairline/60">
              {risks.map((r) => (
                <VaultRiskDetail
                  key={r.id}
                  title={r.title}
                  summary={r.summary}
                  verdict={r.verdict}
                  detail={r.detail}
                  onAskAgent={
                    onAskAgent ? () => onAskAgent(r.askPrompt) : undefined
                  }
                >
                  {r.extra}
                </VaultRiskDetail>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function buildRisks(
  cached: CachedActionPlan,
  sponsorGas: boolean,
): GuardianRow[] {
  const out: GuardianRow[] = [];
  const deposits = cached.steps.filter(
    (s): s is ResolvedDepositStep => s.kind === "deposit",
  );
  const swaps = cached.steps.filter(
    (s): s is ResolvedSwapStep => s.kind === "swap",
  );
  const splits = cached.steps.filter(
    (s): s is ResolvedSplitStep => s.kind === "split",
  );
  const redeems = cached.steps.filter(
    (s): s is ResolvedRedeemStep => s.kind === "redeemFromVault",
  );
  const sends = cached.steps.filter(
    (s): s is ResolvedSendStep => s.kind === "send",
  );

  out.push(...swapRisks(swaps));
  out.push(...depositRisks(deposits));
  out.push(...splitRisks(splits));
  out.push(...redeemRisks(redeems, deposits.length > 0));
  out.push(...sendRisks(sends));

  // Agent-authored, vault-specific risk rows (the dynamic Guardian). Additive:
  // when the agent supplies none, the static rows above stand in as a fallback.
  for (const [i, r] of (cached.risks ?? []).entries()) {
    const verdict: RiskVerdict =
      r.level === "block" || r.level === "flag" ? r.level : "pass";
    // Derive a one-line summary from the first sentence of the note. Avoids
    // duplicating the title (which the agent sometimes echoes) and gives the
    // "Title — Summary" inline layout something distinct to render. When the
    // first sentence becomes the summary, strip it from the detail so the
    // body doesn't repeat what already sits on the summary line.
    const noteFirst = r.note.split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
    const promoted = noteFirst.length > 0 && noteFirst !== r.title;
    const summary = promoted ? noteFirst : "";
    const detail = promoted
      ? r.note.slice(noteFirst.length).trim()
      : r.note;
    out.push({
      id: `agent-risk-${i}`,
      title: r.title,
      summary,
      verdict,
      detail,
      askPrompt: "Walk me through this risk.",
    });
  }

  const gas = cached.summary.estimatedGasSui;
  if (sponsorGas) {
    out.push({
      id: "gas",
      title: "Gas sponsored by Sprout",
      summary: `Sprout covers the ~${gas.toFixed(4)} SUI network fee — you pay 0`,
      verdict: "pass",
      detail:
        "You sign this transaction, but Sprout pays the SUI gas via Enoki sponsorship — so you don't need any SUI in your wallet to execute it. If sponsorship is unavailable at sign time, it falls back to wallet-paid gas (you'd then need a little SUI).",
      askPrompt: "How does Sprout pay the gas for me?",
    });
  } else {
    let gasV: RiskVerdict = "pass";
    if (gas >= 0.05) gasV = "flag";
    out.push({
      id: "gas",
      title: "Gas cost",
      summary: `~${gas.toFixed(4)} SUI for this transaction`,
      verdict: gasV,
      detail:
        "Gas is the SUI you pay validators to include and execute this transaction. Larger PTBs (more swaps, more deposits) cost more. The number shown is a heuristic estimate; the actual gas is in the receipt after signing.",
      askPrompt: "Why does this plan cost so much gas?",
    });
  }

  return out;
}

function swapRisks(swaps: ResolvedSwapStep[]): GuardianRow[] {
  if (swaps.length === 0) return [];
  const out: GuardianRow[] = [];

  // Vault share tokens can be swapped, but redeeming through the vault usually
  // returns more. Surface the tradeoff (informational flag — not blocking).
  const vaultSwaps = swaps.filter((s) => s.fromVault);
  if (vaultSwaps.length > 0) {
    const syms = Array.from(new Set(vaultSwaps.map((s) => s.fromSymbol)));
    out.push({
      id: "swap-vault-token",
      title: "Vault token swap",
      summary:
        vaultSwaps.length === 1
          ? `${syms[0]} is a ${vaultSwaps[0].fromVault!.vaultName} share — redeeming usually beats swapping`
          : `Swapping vault shares (${syms.join(", ")}) — redeeming usually beats swapping`,
      verdict: "flag",
      detail:
        getGlossary("vault-token-swap") +
        "\n\n**For this plan:** you're selling a vault share on the open market. If you don't need the funds right away, redeeming through the vault (request a withdrawal, wait out the lockup, then swap the underlying) typically returns more.",
      askPrompt: "Should I redeem my vault token instead of swapping it?",
    });
  }

  const unverifiedSymbols = new Set<string>();
  for (const s of swaps) {
    if (s.fromVerified === false) unverifiedSymbols.add(s.fromSymbol);
    if (s.toVerified === false) unverifiedSymbols.add(s.toSymbol);
  }
  out.push({
    id: "swap-token-verification",
    title: "Token verification",
    summary:
      unverifiedSymbols.size === 0
        ? `All swap tokens verified${
            swaps.length === 1
              ? ` (${swaps[0].fromSymbol} & ${swaps[0].toSymbol})`
              : ""
          }`
        : `Unverified: ${Array.from(unverifiedSymbols).join(", ")}`,
    verdict: unverifiedSymbols.size === 0 ? "pass" : "flag",
    detail:
      "Sui's coin list flags tokens whose deployer + metadata have been verified by the ecosystem. Unverified coins can still trade, but they're more likely to be lookalike scams, have hidden admin powers, or get rugged. Treat unverified swap legs with extra skepticism.",
    askPrompt: "Why does token verification matter for swap safety?",
  });

  const maxImpact = Math.max(0, ...swaps.map((s) => s.impactPct ?? 0));
  let impactV: RiskVerdict = "pass";
  if (maxImpact >= 5) impactV = "block";
  else if (maxImpact >= 1) impactV = "flag";
  out.push({
    id: "swap-impact",
    title: "Price impact",
    summary:
      swaps.length === 1
        ? swaps[0].impactPct !== undefined && swaps[0].impactPct > 0
          ? swaps[0].impactPct < 0.001
            ? `<0.001% via ${providerLabel(swaps[0].provider)}`
            : `${swaps[0].impactPct.toFixed(3)}% via ${providerLabel(swaps[0].provider)}`
          : `0% via ${providerLabel(swaps[0].provider)}`
        : `${swaps.length} swaps · max ${maxImpact.toFixed(3)}% impact`,
    verdict: impactV,
    detail:
      getGlossary("price-impact") +
      "\n\n**For this plan:** impact is computed against oracle USD prices, not the SDK's optimistic estimate.",
    askPrompt: "What's price impact and is the swap leg going to cost me?",
  });

  const allDexes = swaps.flatMap((s) => s.dexes);
  const untrusted = untrustedDexes(allDexes);
  out.push({
    id: "swap-route-trust",
    title: "Route trust",
    summary:
      untrusted.length > 0
        ? `Includes unfamiliar venue${untrusted.length === 1 ? "" : "s"}: ${Array.from(new Set(untrusted)).join(", ")}`
        : `Routed via ${Array.from(new Set(allDexes)).join(" + ") || "single DEX"}`,
    verdict: untrusted.length > 0 ? "flag" : "pass",
    detail:
      getGlossary("bluefin7k-aggregator") +
      "\n\n**For this plan:** Sprout only auto-trusts established Sui venues (Cetus, Bluefin, Kriya, Aftermath, Turbos, FlowX, DeepBook). Anything else flags here so you can decide.",
    askPrompt: "Which DEXes is this swap routed through, and are they safe?",
  });

  const tightLegs = swaps.filter(
    (s) => s.impactPct !== undefined && s.slippagePct < s.impactPct,
  );
  out.push({
    id: "swap-slippage",
    title: "Slippage cap",
    summary:
      tightLegs.length > 0
        ? `${tightLegs.length === 1 ? "1 leg" : `${tightLegs.length} legs`} cap is tighter than current impact — may revert`
        : swaps.length === 1
          ? `${swaps[0].slippagePct}% cap leaves headroom vs ${(swaps[0].impactPct ?? 0).toFixed(3)}% impact`
          : `${swaps.map((s) => `${s.slippagePct}%`).join(", ")} caps`,
    verdict: tightLegs.length > 0 ? "flag" : "pass",
    detail: getGlossary("slippage"),
    askPrompt: "How do I pick a safe slippage tolerance?",
  });

  return out;
}

function depositRisks(deposits: ResolvedDepositStep[]): GuardianRow[] {
  if (deposits.length === 0) return [];
  const out: GuardianRow[] = [];

  out.push({
    id: "protocol",
    title: "Protocol risk",
    summary: "Ember smart contracts + FordeFi MPC custody",
    verdict: "flag",
    detail: getGlossary("protocol-risk"),
    askPrompt:
      "What are the protocol risks of depositing to an Ember vault on Sui?",
  });

  const isLP = deposits.some((d) => {
    const c = d.vault.category.toLowerCase();
    return (
      c.includes("liquidity") ||
      c.includes("concentrated") ||
      c.includes("amm")
    );
  });
  const categoryCounts = new Map<string, number>();
  for (const d of deposits) {
    categoryCounts.set(
      d.vault.category,
      (categoryCounts.get(d.vault.category) ?? 0) + 1,
    );
  }
  const categorySummary = Array.from(categoryCounts.entries())
    .map(([c, n]) => (n > 1 ? `${c} ×${n}` : c))
    .join(" · ");
  out.push({
    id: "strategy",
    title: "Strategy risk",
    summary: categorySummary,
    verdict: isLP ? "flag" : "pass",
    detail: isLP
      ? getGlossary("concentrated-liquidity") +
        "\n\n" +
        getGlossary("impermanent-loss")
      : "These vaults don't take LP positions, so impermanent loss doesn't apply. Yield comes from the operator's stated activity (lending, trading) — open each vault's details for the strategy description.",
    askPrompt: isLP
      ? "What's impermanent loss and how does it affect these vaults?"
      : "What do these vault strategies actually do, and how can they lose money?",
  });

  const totalApy = deposits.reduce(
    (s, d) =>
      s +
      d.vault.apyBreakdown.lendingApyPct +
      d.vault.apyBreakdown.rewardApyPct,
    0,
  );
  const rewardApy = deposits.reduce(
    (s, d) => s + d.vault.apyBreakdown.rewardApyPct,
    0,
  );
  const rewardShare = totalApy > 0 ? rewardApy / totalApy : 0;
  const rewardHeavy = rewardShare > 0.5;
  out.push({
    id: "apy",
    title: "APY composition",
    summary:
      rewardShare > 0
        ? `${(rewardShare * 100).toFixed(0)}% of APY is reward emissions`
        : "100% from deposit yield",
    verdict: rewardHeavy ? "flag" : "pass",
    detail:
      getGlossary("apy-composition") +
      (rewardHeavy
        ? "\n\n**For this plan:** more than half the headline APY comes from reward token emissions across the chosen vaults. If emissions drop or the reward token loses value, realized yield drops with it."
        : "\n\n**For this plan:** most yield is from strategy gains — closer to durable yield."),
    askPrompt: "Why is the APY for these vaults so high?",
  });

  const maxLockDays = Math.max(
    ...deposits.map((d) => d.vault.withdrawalPeriodDays ?? 0),
  );
  if (maxLockDays > 0) {
    out.push({
      id: "lockup",
      title: "Withdrawal lockup",
      summary: `Up to ${maxLockDays}-day delay on withdrawal`,
      verdict: "flag",
      detail: getGlossary("withdrawal-lockup"),
      askPrompt: "What happens if I want to withdraw early from these vaults?",
    });
  }

  out.push({
    id: "variable-apy",
    title: "Variable APY",
    summary: "Headline APY is a 30-day average, not a promise",
    verdict: "flag",
    detail: getGlossary("variable-apy"),
    askPrompt: "Will I actually earn this APY?",
  });

  return out;
}

function splitRisks(splits: ResolvedSplitStep[]): GuardianRow[] {
  if (splits.length === 0) return [];
  const out: GuardianRow[] = [];

  for (const s of splits) {
    if (s.portions.length < 3) continue; // 2-way splits are rarely "concentrated"
    const bpsArr = s.portions.map((p) => p.bps);
    const maxBps = Math.max(...bpsArr);
    const concentrated = maxBps >= 7000;
    out.push({
      id: `split-allocation-${s.id}`,
      title: "Allocation balance",
      summary: concentrated
        ? `One portion holds ${(maxBps / 100).toFixed(0)}% of the split — concentration risk`
        : `${s.portions.length}-way split (max portion ${(maxBps / 100).toFixed(0)}%)`,
      verdict: concentrated ? "flag" : "pass",
      detail:
        "Splitting your principal across multiple vaults reduces single-vault risk, but a heavily weighted split brings most of the risk back to the dominant leg. If the largest portion ≥ 70%, the diversification benefit is mostly cosmetic — consider rebalancing or accepting that the dominant vault drives outcomes.",
      askPrompt: "How should I think about splitting deposits across vaults?",
    });
  }

  return out;
}

function sendRisks(sends: ResolvedSendStep[]): GuardianRow[] {
  if (sends.length === 0) return [];
  const recipients = Array.from(
    new Set(sends.map((s) => s.recipientName ?? s.recipient)),
  );
  const named = sends.filter((s) => s.recipientName);
  const who =
    recipients.length === 1 ? recipients[0] : `${recipients.length} recipients`;
  const nameNote =
    named.length > 0
      ? ` ${named
          .map((s) => `${s.recipientName} resolves to ${fmtAddress(s.recipient, 8, 6)}`)
          .join("; ")}.`
      : "";
  return [
    {
      id: "send-irreversible",
      title: "Irreversible transfer",
      summary: `Funds leave your wallet to ${who} — transfers can't be undone`,
      verdict: "flag",
      detail:
        "A send moves coins out of your wallet permanently. There is no recall, refund, or chargeback on Sui — if the recipient is wrong, the funds are gone. Verify the address (or SuiNS name) is exactly who you intend to pay before signing." +
        nameNote,
      askPrompt: "How do I make sure I'm sending to the right address?",
    },
  ];
}

function redeemRisks(
  redeems: ResolvedRedeemStep[],
  hasDeposits: boolean,
): GuardianRow[] {
  if (redeems.length === 0) return [];
  // If this plan also deposits, the deposit's existing "Withdrawal lockup"
  // row already covers the timing concern — don't double-up.
  if (hasDeposits) return [];

  const maxLockDays = Math.max(
    ...redeems.map((r) => r.vault.withdrawalPeriodDays ?? 0),
  );
  if (maxLockDays === 0) {
    return [
      {
        id: "redeem-timing",
        title: "Withdrawal timing",
        summary: "Withdrawals settle as soon as the operator unwinds",
        verdict: "pass",
        detail:
          "These vaults don't enforce a fixed lockup; redeem requests settle on the next operator unwind cycle (usually under a day, often within hours). The strategy can still lose money between request and settlement.",
        askPrompt: "When will my withdrawal actually settle?",
      },
    ];
  }
  return [
    {
      id: "redeem-timing",
      title: "Withdrawal timing",
      summary: `Up to ${maxLockDays}-day settlement window`,
      verdict: "flag",
      detail: getGlossary("withdrawal-lockup"),
      askPrompt: "When will my withdrawal actually settle?",
    },
  ];
}

function PlanReceipt({
  confirming,
  txStatus,
  txError,
  txDigest,
  gasUsedSui,
  sponsored,
  receivedShares,
  deposits,
}: {
  confirming: boolean;
  txStatus?: "success" | "failure";
  txError?: string;
  txDigest?: string;
  gasUsedSui?: number;
  sponsored?: boolean;
  receivedShares?: number[];
  deposits: ResolvedDepositStep[];
}) {
  const success = txStatus === "success";
  const failure = txStatus === "failure";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className={cn("rounded-card", 
        "space-y-2 px-3 py-2.5",
        confirming && "surface-panel",
        success && "bg-deliver-green/15",
        failure && "bg-destructive/15",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-body-sm font-medium text-midnight-ink">
          {confirming ? (
            <>
              <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
              Waiting for finality on Sui…
            </>
          ) : success ? (
            <>
              <span
                className="inline-flex size-5 items-center justify-center bg-deliver-green text-midnight-ink rounded-full"
              >
                <Check className="size-3" strokeWidth={2.8} />
              </span>
              Plan executed
            </>
          ) : (
            <>
              <span
                className="inline-flex size-5 items-center justify-center bg-destructive text-canvas-white rounded-full"
              >
                ✕
              </span>
              Plan failed
            </>
          )}
        </div>
        {txDigest && (
          <a
            href={`https://suiscan.xyz/mainnet/tx/${txDigest}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 surface-panel px-2.5 py-1 font-mono text-caption text-midnight-ink ring-1 ring-hairline rounded-card"
          >
            {txDigest.slice(0, 6)}…{txDigest.slice(-4)}
            <ExternalLink className="size-3" strokeWidth={2.2} />
          </a>
        )}
      </div>

      {success && receivedShares && receivedShares.length > 0 && (
        <ul className="space-y-1 text-caption text-muted-ash">
          {deposits.map((d, i) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{d.vault.name}</span>
              <span className="tabular-nums font-medium text-midnight-ink">
                +{fmtAmount(receivedShares[i] ?? 0)} shares
              </span>
            </li>
          ))}
          {gasUsedSui !== undefined && (
            <li className="flex items-center justify-between gap-2 pt-1">
              <span>Gas</span>
              {sponsored ? (
                <span className="flex items-baseline gap-1.5 tabular-nums font-medium">
                  <span className="text-muted-ash line-through">
                    {gasUsedSui.toFixed(4)} SUI
                  </span>
                  <span className="text-deliver-green">Paid by Sprout</span>
                </span>
              ) : (
                <span className="tabular-nums font-medium text-midnight-ink">
                  {gasUsedSui.toFixed(4)} SUI
                </span>
              )}
            </li>
          )}
        </ul>
      )}

      {failure && txError && (
        <div className="text-caption text-midnight-ink/80">{txError}</div>
      )}
    </motion.div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Insufficient-balance copy helpers
// ───────────────────────────────────────────────────────────────────────

function shortfallSummary(check: BalanceCheck): string {
  const inputs = check.inputShortfalls;
  const gas = check.gasShortfall;
  if (inputs.length === 0 && gas) {
    return `Need ${fmtAmount(gas.deficit)} more ${gas.symbol} for gas`;
  }
  if (inputs.length === 1 && !gas) {
    return `Need ${fmtAmount(inputs[0].deficit)} more ${inputs[0].symbol}`;
  }
  return "Wallet doesn't have enough tokens";
}

function shortfallDetail(check: BalanceCheck): string {
  const lines: string[] = [
    "Your wallet doesn't have enough of the required token(s) to execute this plan. Signing now would burn gas without completing the action.",
    "",
  ];
  for (const s of check.inputShortfalls) {
    lines.push(
      `- **${s.symbol}** — wallet has ${fmtAmount(s.available)}, plan needs ${fmtAmount(s.required)} (short by ${fmtAmount(s.deficit)}).`,
    );
  }
  if (check.gasShortfall) {
    const g = check.gasShortfall;
    lines.push(
      `- **${g.symbol}** (network fee) — wallet has ${fmtAmount(g.available)}, plan needs ~${fmtAmount(g.required)} (short by ${fmtAmount(g.deficit)}).`,
    );
  }
  return lines.join("\n");
}

function shortfallAskPrompt(check: BalanceCheck): string {
  if (check.inputShortfalls.length === 1 && !check.gasShortfall) {
    return `How do I get more ${check.inputShortfalls[0].symbol} on Sui?`;
  }
  if (check.gasShortfall && check.inputShortfalls.length === 0) {
    return "How do I get more SUI for gas on Sui?";
  }
  return "How do I top up my wallet for this plan?";
}

function shortfallButtonLabel(check: BalanceCheck): string {
  const inputs = check.inputShortfalls;
  const gas = check.gasShortfall;
  if (inputs.length === 0 && gas) {
    return `Need ${fmtAmount(gas.deficit)} more ${gas.symbol}`;
  }
  if (inputs.length === 1 && !gas) {
    return `Need ${fmtAmount(inputs[0].deficit)} more ${inputs[0].symbol}`;
  }
  return "Insufficient balance";
}

/* ─────────────────────────────────────────────────────────
 * Per-kind expanded detail panels
 * ───────────────────────────────────────────────────────── */

/**
 * True when `next` consumes a coin handle produced by `current`. Used by
 * the step trail to decide whether to draw a flow connector between two
 * adjacent rows (binding "swap then deposit" into one visual chain).
 */
function stepFlowsInto(current: ResolvedStep, next: ResolvedStep): boolean {
  if (current.kind === "cancelRedeemFromVault") return false;
  if (next.kind === "cancelRedeemFromVault") return false;
  // Cheap heuristic: any step that produces a handle (swap / split /
  // merge) followed immediately by a step that takes a fromHandle reads
  // as a flow. We can't reach into the raw input from the resolved step
  // shape without extra plumbing, but adjacency + non-terminal upstream
  // covers the common composes (swap→deposit, split→deposit, merge→swap).
  const producers = ["swap", "split", "merge"];
  const consumers = ["swap", "split", "merge", "deposit", "redeemFromVault", "send"];
  return producers.includes(current.kind) && consumers.includes(next.kind);
}

/**
 * Vertical line + arrow gutter element drawn between two flowing steps.
 * Lives inside the parent row's positioning context with a short height
 * so the connector visually links the bottom of one row to the top of
 * the next.
 */
function FlowConnector() {
  return (
    <div className="relative flex h-3 w-full justify-start pl-[1.375rem]">
      <span
        className="h-full w-px bg-gradient-to-b from-deliver-green/60 to-deliver-green/20"
        aria-hidden
      />
    </div>
  );
}

function fmtImpact(pct: number | undefined): string {
  if (pct === undefined || pct <= 0) return "0%";
  if (pct < 0.001) return "<0.001%";
  return `${pct.toFixed(3)}%`;
}

function SwapDetail({
  s,
  iconLookup,
}: {
  s: ResolvedSwapStep;
  iconLookup: IconLookup;
}) {
  const rate =
    s.fromAmountHuman > 0 ? s.toAmountHuman / s.fromAmountHuman : 0;
  const minReceived = s.toAmountHuman * (1 - s.slippagePct / 100);
  const impactPct = s.impactPct ?? 0;
  const verdict: "pass" | "warn" | "block" =
    impactPct >= 5 ? "block" : impactPct >= 1 ? "warn" : "pass";
  const verdictCaption =
    verdict === "block" ? "High" : verdict === "warn" ? "Elevated" : "Low";
  const slippageTight =
    impactPct > 0 && s.slippagePct < impactPct;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <NumericHero
          label="Effective rate"
          value={rate.toFixed(6)}
          unit={`${s.toSymbol} per ${s.fromSymbol}`}
        />
        <VerdictChip
          label="Price impact"
          value={fmtImpact(s.impactPct)}
          verdict={verdict}
          caption={verdictCaption}
        />
      </div>
      <div className="flex flex-wrap gap-2.5">
        <DetailChip
          label="Slippage cap"
          value={`${s.slippagePct}%`}
          tone={slippageTight ? "warn" : "default"}
        />
        <DetailChip
          label="Min received"
          value={`${fmtAmount(minReceived)} ${s.toSymbol}`}
        />
      </div>
      <RouteBreakdown s={s} iconLookup={iconLookup} />
    </div>
  );
}

function symbolFromType(coinType?: string): string {
  if (!coinType) return "?";
  const parts = coinType.split("::");
  return parts[parts.length - 1] || "?";
}

function TokenChip({
  coinType,
  iconLookup,
}: {
  coinType?: string;
  iconLookup: IconLookup;
}) {
  const sym = symbolFromType(coinType);
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-card bg-whisper-gray px-2 py-1 text-caption font-medium text-midnight-ink ring-1 ring-hairline">
      <AssetIcon
        src={coinType ? iconLookup(coinType) : undefined}
        label={sym}
        size={14}
      />
      {sym}
    </span>
  );
}

/**
 * Route breakdown for a swap — the 7K Meta Aggregator picks the best provider
 * across Bluefin7K / Cetus / FlowX; we show which won, how much better, and the
 * token-by-token path: which token swaps to which at which venue.
 */
function RouteBreakdown({
  s,
  iconLookup,
}: {
  s: ResolvedSwapStep;
  iconLookup: IconLookup;
}) {
  const splits = (s.routeSplits ?? []).filter((sp) => sp.hops.length > 0);
  const tied =
    s.comparedProvider !== undefined &&
    (s.rateImprovementPct ?? 0) < 0.01;
  return (
    <div className="space-y-2.5 pt-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">
          Route
        </span>
        <span className="text-caption tabular-nums text-muted-ash">
          via {providerLabel(s.provider)}
          {s.hops > 1 ? ` · ${s.hops} hops` : ""}
        </span>
      </div>
      <div className="text-body-sm text-muted-ash">
        Best route for {s.fromSymbol} → {s.toSymbol} via{" "}
        <span className="font-medium text-midnight-ink">
          {providerLabel(s.provider)}
        </span>
        {s.comparedProvider ? (
          tied ? (
            <> — matched {providerLabel(s.comparedProvider)}.</>
          ) : (
            <>
              {" — "}
              <span className="font-medium text-deliver-green">
                {(s.rateImprovementPct ?? 0).toFixed(2)}% better
              </span>{" "}
              than {providerLabel(s.comparedProvider)}.
            </>
          )
        ) : (
          "."
        )}
      </div>
      {splits.length > 0 ? (
        <div className="space-y-2">
          {splits.map((sp, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5"
            >
              {splits.length > 1 && (
                <span className="inline-flex min-w-[40px] shrink-0 items-center justify-center rounded-card bg-whisper-gray px-2 py-1 text-caption font-medium tabular-nums text-muted-ash ring-1 ring-hairline">
                  {Math.round(sp.sharePct * 100)}%
                </span>
              )}
              <TokenChip
                coinType={sp.hops[0]?.tokenIn ?? s.fromCoinType}
                iconLookup={iconLookup}
              />
              {sp.hops.map((h, j) => (
                <Fragment key={j}>
                  <span className="inline-flex shrink-0 items-center gap-1 text-caption text-muted-ash">
                    <ArrowRight className="size-3" strokeWidth={2.4} />
                    <span className="font-medium text-midnight-ink">
                      {dexLabel(h.dex)}
                    </span>
                    <ArrowRight className="size-3" strokeWidth={2.4} />
                  </span>
                  <TokenChip
                    coinType={
                      h.tokenOut ??
                      (j === sp.hops.length - 1 ? s.toCoinType : undefined)
                    }
                    iconLookup={iconLookup}
                  />
                </Fragment>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-caption text-muted-ash">
          Routed via {providerLabel(s.provider)}.
        </div>
      )}
    </div>
  );
}

function DepositDetail({
  s,
  onOpenVault,
}: {
  s: ResolvedDepositStep;
  onOpenVault: (vaultId: string) => void;
}) {
  const v = s.vault;
  const lendApy = v.apyBreakdown.lendingApyPct;
  const rewardApy = v.apyBreakdown.rewardApyPct;
  const totalApy = lendApy + rewardApy;
  const rewardShare = totalApy > 0 ? rewardApy / totalApy : 0;
  const rewardHeavy = rewardShare > 0.5;
  const composedFromBoth = lendApy > 0 && rewardApy > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">
            APY · 30-day average
          </div>
          <div
            className="font-medium tabular-nums leading-none text-midnight-ink text-[28px] tracking-[-0.02em]"
          >
            {fmtPct(v.apyPct)}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenVault(v.id);
          }}
          className="inline-flex shrink-0 items-center gap-1.5 self-start bg-whisper-gray px-3 py-1.5 text-caption font-medium text-midnight-ink ring-1 ring-hairline transition-colors hover:bg-light-taupe rounded-button"
        >
          Full vault info
          <ExternalLink className="size-3" strokeWidth={2.4} />
        </button>
      </div>
      {composedFromBoth ? (
        <ApyComposition lendApy={lendApy} rewardApy={rewardApy} />
      ) : (
        <div className="text-caption text-muted-ash">
          {rewardApy === 0
            ? "100% from deposit yield — no reward emissions."
            : "100% from reward emissions — no underlying yield."}
        </div>
      )}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <DetailChip label="Strategy" value={v.category} />
        {v.tvlUsd !== undefined && (
          <DetailChip
            label="TVL"
            value={`$${Math.round(v.tvlUsd).toLocaleString()}`}
          />
        )}
        <DetailChip
          label="Withdrawal"
          value={
            v.withdrawalPeriodDays
              ? `≤${v.withdrawalPeriodDays}d`
              : "Soon"
          }
        />
      </div>
      {rewardHeavy && (
        <div
          className="flex items-start gap-2 border-l-2 border-warning bg-warning/10 px-3 py-2 text-caption text-muted-ash rounded-button"
        >
          <span className="mt-0.5 inline-block size-1.5 shrink-0 rounded-full bg-warning" />
          {Math.round(rewardShare * 100)}% of headline APY is reward emissions
          — variable, not durable yield.
        </div>
      )}
    </div>
  );
}

/**
 * Visual APY composition bar — yield (lime) + rewards (white/40) stacked.
 * Communicates the "durable vs emissions" mix at a glance.
 */
function ApyComposition({
  lendApy,
  rewardApy,
}: {
  lendApy: number;
  rewardApy: number;
}) {
  const total = lendApy + rewardApy;
  if (total <= 0) return null;
  const yieldShare = (lendApy / total) * 100;
  return (
    <div className="space-y-2">
      <div
        className="h-1.5 w-full overflow-hidden bg-whisper-gray rounded-full"
      >
        <div className="flex h-full">
          <div
            className="bg-deliver-green"
            style={{ width: `${yieldShare}%` }}
          />
          <div
            className="bg-muted-ash/40"
            style={{ width: `${100 - yieldShare}%` }}
          />
        </div>
      </div>
      <div className="flex items-baseline gap-4 text-caption">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-deliver-green" />
          <span className="text-muted-ash">Yield</span>
          <span className="tabular-nums text-midnight-ink">
            {fmtPct(lendApy)}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-muted-ash/40" />
          <span className="text-muted-ash">Rewards</span>
          <span className="tabular-nums text-midnight-ink">
            {fmtPct(rewardApy)}
          </span>
        </span>
      </div>
    </div>
  );
}

/** One thin stacked bar showing how N segments split a whole. Each
 *  segment is drawn in a decreasing-opacity lime shade so the rhythm
 *  reads as "first portion is dominant, then descending." Used by both
 *  split and merge details. */
function PortionsBar({ values }: { values: number[] }) {
  const sum = values.reduce((acc, v) => acc + v, 0);
  if (sum <= 0) return null;
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden bg-whisper-gray rounded-full"
    >
      {values.map((v, i) => (
        <div
          key={i}
          className={cn(
            i === 0 && "bg-deliver-green",
            i === 1 && "bg-deliver-green/65",
            i === 2 && "bg-deliver-green/40",
            i >= 3 && "bg-deliver-green/25",
          )}
          style={{ width: `${(v / sum) * 100}%` }}
        />
      ))}
    </div>
  );
}

function SegmentDot({ index }: { index: number }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        index === 0 && "bg-deliver-green",
        index === 1 && "bg-deliver-green/65",
        index === 2 && "bg-deliver-green/40",
        index >= 3 && "bg-deliver-green/25",
      )}
    />
  );
}

function SplitDetail({ s }: { s: ResolvedSplitStep }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">
            Source
          </div>
          <div
            className="font-medium tabular-nums leading-none text-midnight-ink text-[22px] tracking-[-0.015em]"
          >
            {fmtAmount(s.totalHuman)} {s.sourceSymbol}
          </div>
        </div>
        <span className="shrink-0 self-start text-caption text-muted-ash">
          {s.portions.length}-way split
        </span>
      </div>
      <PortionsBar values={s.portions.map((p) => p.bps)} />
      <div className="space-y-1">
        {s.portions.map((p, i) => {
          const pct = (p.bps / 100).toFixed(p.bps % 100 === 0 ? 0 : 2);
          return (
            <div
              key={i}
              className="flex items-center justify-between border-t border-hairline py-2 first:border-t-0 first:pt-0"
            >
              <span className="flex items-center gap-2 text-body-sm text-muted-ash">
                <SegmentDot index={i} />
                Portion {i + 1}
              </span>
              <span className="flex items-baseline gap-2 text-body-sm">
                <span className="font-medium text-midnight-ink">
                  {pct}%
                </span>
                <span className="tabular-nums text-muted-ash">
                  {fmtAmount(p.human)} {s.sourceSymbol}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function describeMergeSource(
  rawLabel: string,
  cached: CachedActionPlan,
): string {
  if (rawLabel.startsWith("balance:")) {
    const sym = rawLabel.split(":")[1];
    return `Your ${sym} balance`;
  }
  const upstreamId = rawLabel.split(".")[0];
  const upstream = cached.steps.find((step) => step.id === upstreamId);
  if (upstream?.kind === "swap") {
    return `Swap ${upstream.fromSymbol} → ${upstream.toSymbol}`;
  }
  if (upstream?.kind === "split") {
    const portionIdx = parseInt(rawLabel.split(".")[1] ?? "0", 10);
    return `Split portion ${portionIdx + 1}`;
  }
  return rawLabel;
}

function MergeDetail({
  s,
  cached,
}: {
  s: ResolvedMergeStep;
  cached: CachedActionPlan;
}) {
  // Sort sources by contribution descending so the bar's lime gradient
  // reads "biggest contributor first, smallest last."
  const ordered = [...s.sources]
    .map((src, originalIndex) => ({ src, originalIndex }))
    .sort((a, b) => b.src.human - a.src.human);
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">
            Combined
          </div>
          <div
            className="font-medium tabular-nums leading-none text-midnight-ink text-[22px] tracking-[-0.015em]"
          >
            {fmtAmount(s.totalHuman)} {s.symbol}
          </div>
        </div>
        <span className="shrink-0 self-start text-caption text-muted-ash">
          {s.sources.length} sources
        </span>
      </div>
      <PortionsBar values={ordered.map(({ src }) => src.human)} />
      <div className="space-y-1">
        {ordered.map(({ src }, i) => {
          const pct = s.totalHuman > 0 ? (src.human / s.totalHuman) * 100 : 0;
          return (
            <div
              key={i}
              className="flex items-center justify-between border-t border-hairline py-2 first:border-t-0 first:pt-0"
            >
              <span className="flex items-center gap-2 text-body-sm text-muted-ash">
                <SegmentDot index={i} />
                {describeMergeSource(src.label, cached)}
              </span>
              <span className="flex items-baseline gap-2 text-body-sm">
                <span className="font-medium text-midnight-ink">
                  {pct.toFixed(pct % 1 === 0 ? 0 : 1)}%
                </span>
                <span className="tabular-nums text-muted-ash">
                  {fmtAmount(src.human)} {s.symbol}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RedeemDetail({ s }: { s: ResolvedRedeemStep }) {
  const v = s.vault;
  return (
    <div className="space-y-3">
      <DetailHero
        label="Redeem"
        value={
          <>
            {fmtAmount(s.sharesHuman)} {s.receiptSymbol}
          </>
        }
        trailing={
          <DetailChip
            label="Settles in"
            value={
              v.withdrawalPeriodDays
                ? `≤${v.withdrawalPeriodDays}d`
                : "Soon"
            }
          />
        }
      />
      <p className="text-caption leading-relaxed text-muted-ash">
        Funds arrive after the operator unwinds the strategy — they
        don&apos;t show up in this transaction. Track the request in your
        portfolio.
      </p>
    </div>
  );
}

function SendDetail({
  s,
  iconLookup,
}: {
  s: ResolvedSendStep;
  iconLookup: IconLookup;
}) {
  return (
    <div className="space-y-3">
      <DetailHero
        label="Send"
        value={
          <>
            {fmtAmount(s.amountHuman)} {s.symbol}
          </>
        }
        trailing={
          <AssetIcon src={iconLookup(s.coinType)} label={s.symbol} size={32} />
        }
      />
      <div className="space-y-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">
          Recipient
        </div>
        {s.recipientName ? (
          <div className="text-body-sm leading-snug text-midnight-ink">
            <span className="font-medium">{s.recipientName}</span>
            <span className="text-muted-ash">
              {" → "}
              {fmtAddress(s.recipient, 10, 6)}
            </span>
          </div>
        ) : (
          <div className="break-all text-body-sm font-medium tabular-nums text-midnight-ink">
            {s.recipient}
          </div>
        )}
      </div>
      <p className="text-caption leading-relaxed text-muted-ash">
        Transfers are irreversible
        {s.recipientName
          ? " — confirm the SuiNS name resolved to the address above"
          : " — double-check the recipient address"}
        .
      </p>
    </div>
  );
}

function CancelDetail({ s }: { s: ResolvedCancelRedeemStep }) {
  return (
    <div className="space-y-3">
      <DetailHero
        label={`Cancel withdrawal · ${s.vault.name}`}
        value={<>req #{s.sequenceNumber}</>}
      />
      <div className="text-caption text-muted-ash">
        Shares return to your wallet on confirmation. No fees beyond gas.
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * Aggregate stats — picks tiles based on which step kinds
 * are present. Solo swap looks different from a deposit plan
 * looks different from a redeem.
 * ───────────────────────────────────────────────────────── */

type StatTile = {
  id: string;
  label: string;
  value: string;
  /** Struck-through prefix (sponsored gas: crossed-out estimate before "0 SUI"). */
  struck?: string;
  tone?: "default" | "lime";
};

function PlanStats({
  cached,
  sponsorGas,
}: {
  cached: CachedActionPlan;
  sponsorGas: boolean;
}) {
  const tiles = computeStatTiles(cached, sponsorGas);
  const cols =
    tiles.length >= 4 ? "sm:grid-cols-4"
    : tiles.length === 3 ? "sm:grid-cols-3"
    : "sm:grid-cols-2";
  return (
    <>
      {/* Mobile: compact label→value rows in one recessed panel — tighter and
       *  easier to scan than full-width stacked tiles on a narrow screen. */}
      <div className="surface-panel divide-y divide-hairline rounded-card sm:hidden">
        {tiles.map((tile) => (
          <div
            key={tile.id}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <span className="shrink-0 text-caption font-medium uppercase tracking-wider text-muted-ash">
              {tile.label}
            </span>
            <span className="flex min-w-0 items-baseline justify-end gap-1.5 text-right text-body-sm font-medium tabular-nums">
              {tile.struck && (
                <span className="text-muted-ash line-through">{tile.struck}</span>
              )}
              <span
                className={cn(
                  tile.struck ? "text-deliver-green" : "text-midnight-ink",
                )}
              >
                {tile.value}
              </span>
            </span>
          </div>
        ))}
      </div>
      {/* Desktop: tile grid */}
      <div className={cn("hidden gap-2 sm:grid", cols)}>
        {tiles.map((tile) => (
          <Stat
            key={tile.id}
            label={tile.label}
            value={tile.value}
            struck={tile.struck}
            tone={tile.tone}
          />
        ))}
      </div>
    </>
  );
}

function computeStatTiles(
  cached: CachedActionPlan,
  sponsorGas: boolean,
): StatTile[] {
  const { swapCount, depositCount, redeemCount, cancelCount, sendCount } =
    cached.summary;
  const swaps = cached.steps.filter(
    (s): s is ResolvedSwapStep => s.kind === "swap",
  );
  const deposits = cached.steps.filter(
    (s): s is ResolvedDepositStep => s.kind === "deposit",
  );
  const redeems = cached.steps.filter(
    (s): s is ResolvedRedeemStep => s.kind === "redeemFromVault",
  );
  const sends = cached.steps.filter(
    (s): s is ResolvedSendStep => s.kind === "send",
  );
  const gas = cached.summary.estimatedGasSui;
  // Sponsored: cross out the estimate and show "0 SUI" in Deliver Green.
  const gasTile: StatTile = sponsorGas
    ? {
        id: "gas",
        label: "Network fee",
        value: "0 SUI",
        struck: `~${gas.toFixed(4)} SUI`,
        tone: "lime",
      }
    : {
        id: "gas",
        label: "Network fee",
        value: `~${gas.toFixed(4)} SUI`,
      };

  // Deposit-driven plans (with or without an upstream swap)
  if (depositCount > 0) {
    return [
      {
        id: "deposit",
        label: depositCount === 1 ? "Deposit" : "Total deposit",
        value: summarizeDeposits(deposits),
      },
      {
        id: "apy",
        label: "Blended APY",
        value: fmtPct(cached.summary.blendedApyPct),
      },
      gasTile,
    ];
  }

  // Solo redeem
  if (redeemCount > 0) {
    const maxLock = Math.max(
      ...redeems.map((r) => r.vault.withdrawalPeriodDays ?? 0),
    );
    return [
      {
        id: "shares",
        label: redeemCount === 1 ? "Burning" : "Total redeem",
        value: summarizeRedeems(redeems),
      },
      {
        id: "settle",
        label: "Settlement",
        value: maxLock > 0 ? `≤${maxLock} days` : "Soon",
      },
      gasTile,
    ];
  }

  // Pure cancel
  if (cancelCount > 0 && swapCount === 0) {
    return [
      {
        id: "cancels",
        label: "Cancellations",
        value: `${cancelCount}`,
      },
      gasTile,
    ];
  }

  // Send-driven plans (bare send, or swap/split → send). Headline the transfer.
  if (sendCount > 0 && depositCount === 0 && redeemCount === 0) {
    const recipients = new Set(sends.map((s) => s.recipientName ?? s.recipient));
    return [
      {
        id: "send",
        label: sendCount === 1 ? "Sending" : "Total sent",
        value: summarizeSends(sends),
      },
      {
        id: "recipient",
        label: recipients.size === 1 ? "Recipient" : "Recipients",
        value:
          recipients.size === 1
            ? (sends[0].recipientName ?? fmtAddress(sends[0].recipient))
            : `${recipients.size} addresses`,
      },
      gasTile,
    ];
  }

  // Solo or chained swaps without follow-on deposit
  if (swapCount > 0) {
    const s = swaps[0];
    const rate =
      s.fromAmountHuman > 0 ? s.toAmountHuman / s.fromAmountHuman : 0;
    const maxImpact = Math.max(0, ...swaps.map((sw) => sw.impactPct ?? 0));
    return [
      {
        id: "rate",
        label: swapCount === 1 ? "Effective rate" : "Best leg rate",
        value: `1 ${s.fromSymbol} ≈ ${rate.toFixed(6)} ${s.toSymbol}`,
      },
      {
        id: "impact",
        label: "Price impact",
        value: fmtImpact(maxImpact),
      },
      gasTile,
    ];
  }

  // Empty / unknown — should be unreachable
  return [gasTile];
}

function summarizeRedeems(redeems: ResolvedRedeemStep[]): string {
  if (redeems.length === 0) return "—";
  if (redeems.length === 1) {
    const r = redeems[0];
    return `${fmtAmount(r.sharesHuman)} ${r.receiptSymbol}`;
  }
  const byToken = new Map<string, number>();
  for (const r of redeems) {
    byToken.set(
      r.receiptSymbol,
      (byToken.get(r.receiptSymbol) ?? 0) + r.sharesHuman,
    );
  }
  return Array.from(byToken.entries())
    .map(([sym, total]) => `${fmtAmount(total)} ${sym}`)
    .join(" + ");
}

function summarizeSends(sends: ResolvedSendStep[]): string {
  if (sends.length === 0) return "—";
  const byToken = new Map<string, number>();
  for (const s of sends) {
    byToken.set(s.symbol, (byToken.get(s.symbol) ?? 0) + s.amountHuman);
  }
  return Array.from(byToken.entries())
    .map(([sym, total]) => `${fmtAmount(total)} ${sym}`)
    .join(" + ");
}
