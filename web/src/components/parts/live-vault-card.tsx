"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  Loader2,
  ShieldCheck,
  Check,
  ExternalLink,
  ChevronRight,
  ArrowRight,
  Repeat,
  Split,
  Merge,
  X,
} from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import {
  VaultRiskDetail,
  type RiskVerdict,
} from "@/components/parts/vault-risk-detail";
import { VaultInfoDialog } from "@/components/parts/vault-info-dialog";
import { getGlossary } from "@/lib/ai/vault-glossary";
import type {
  CachedActionPlan,
  ResolvedDepositStep,
  ResolvedSwapStep,
  ResolvedSplitStep,
} from "@/lib/ai/action-plan-cache";
import { fadeUp, scaleIn, stagger } from "@/lib/motion";
import { fmtAmount, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

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
};


export function LiveVaultCard({
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
}: Props) {
  const [openVaultId, setOpenVaultId] = useState<string | null>(null);
  const depositSteps = cached.steps.filter(
    (s): s is ResolvedDepositStep => s.kind === "deposit",
  );
  const swapSteps = cached.steps.filter(
    (s): s is ResolvedSwapStep => s.kind === "swap",
  );
  const openVault = openVaultId
    ? depositSteps.find((d) => d.vault.id === openVaultId)?.vault ?? null
    : null;

  const rawRisks = buildRisks(cached);
  const severityOrder: Record<RiskVerdict, number> = {
    block: 0,
    flag: 1,
    pass: 2,
  };
  const risks = [...rawRisks].sort(
    (a, b) => severityOrder[a.verdict] - severityOrder[b.verdict],
  );
  const passCount = risks.filter((r) => r.verdict === "pass").length;
  const flagCount = risks.filter((r) => r.verdict === "flag").length;
  const blockCount = risks.filter((r) => r.verdict === "block").length;
  const blocking = blockCount > 0;
  const topIdx = risks.findIndex((r) => r.verdict !== "pass");
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
      className="space-y-3 liquid-glass p-4"
      style={{ borderRadius: 20 }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-caption font-medium uppercase tracking-wider text-cash-lime">
            Plan
          </span>
          <span className="text-caption text-canvas-white/55">
            {swapSteps.length > 0 && (
              <>
                {swapSteps.length} swap
                {swapSteps.length === 1 ? "" : "s"}
                {depositSteps.length > 0 ? " · " : ""}
              </>
            )}
            {depositSteps.length > 0 && (
              <>
                {depositSteps.length} deposit
                {depositSteps.length === 1 ? "" : "s"}
              </>
            )}
          </span>
        </div>
        {depositSteps.length > 0 && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-caption font-medium uppercase tracking-wider text-canvas-white/55">
              Blended APY
            </span>
            <span className="text-body font-semibold tabular-nums text-canvas-white">
              {fmtPct(cached.summary.blendedApyPct)}
            </span>
          </div>
        )}
      </div>

      {/* Step trail */}
      <motion.ol
        variants={stagger(0.05, 0.1)}
        initial="initial"
        animate="animate"
        className="space-y-1.5"
      >
        {cached.steps.map((s, i) => (
          <motion.li key={s.id} variants={fadeUp}>
            <StepRow
              step={s}
              idx={i}
              iconLookup={iconLookup}
              onOpenVault={(id) => setOpenVaultId(id)}
            />
          </motion.li>
        ))}
      </motion.ol>

      {/* Stats */}
      <div className="grid gap-2 sm:grid-cols-2">
        <Stat
          label="Total deposit"
          value={summarizeDeposits(depositSteps)}
          tone="lime"
        />
        <Stat
          label="Network fee"
          value={`~${cached.summary.estimatedGasSui.toFixed(4)} SUI`}
        />
      </div>

      {/* Guardian */}
      <div className="space-y-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex size-5 items-center justify-center",
                blocking
                  ? "bg-destructive text-canvas-white"
                  : flagCount > 0
                    ? "bg-warning text-midnight-black"
                    : "bg-cash-lime text-midnight-black",
              )}
              style={{ borderRadius: 9 }}
            >
              <ShieldCheck className="size-2.5" strokeWidth={2.6} />
            </span>
            <span className="text-caption font-medium uppercase tracking-wider text-canvas-white/55">
              Guardian
            </span>
          </div>
          <p className="text-body-sm leading-snug text-canvas-white">
            {guardianVerdict}
          </p>
        </div>
        <div className="divide-y divide-ghost-border/60">
          {risks.map((r, i) => (
            <VaultRiskDetail
              key={r.id}
              title={r.title}
              summary={r.summary}
              verdict={r.verdict}
              detail={r.detail}
              defaultOpen={i === topIdx}
              onAskAgent={onAskAgent ? () => onAskAgent(r.askPrompt) : undefined}
            />
          ))}
        </div>
      </div>

      {/* Action row */}
      {!executed && !confirming && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-ghost-border/60 pt-3">
          <motion.button
            onClick={onCancel}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            disabled={signing || confirming}
            className="liquid-glass px-3.5 py-1.5 text-body-sm font-medium text-canvas-white disabled:opacity-50"
            style={{ borderRadius: 9999 }}
          >
            Cancel
          </motion.button>
          <motion.button
            onClick={onConfirm}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            disabled={signing || confirming || !walletConnected}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-1.5 text-body-sm font-semibold disabled:bg-hinting-gray disabled:text-canvas-white",
              blocking
                ? "bg-destructive text-canvas-white"
                : "bg-cash-lime text-midnight-black",
            )}
            style={{ borderRadius: 9999 }}
          >
            {signing && (
              <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
            )}
            {signing
              ? "Signing…"
              : !walletConnected
                ? "Connect wallet first"
                : blocking
                  ? "Sign anyway →"
                  : "Confirm & sign →"}
          </motion.button>
        </div>
      )}

      {(confirming || executed) && (
        <PlanReceipt
          confirming={confirming}
          txStatus={txStatus}
          txError={txError}
          txDigest={txDigest}
          gasUsedSui={gasUsedSui}
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
    </motion.div>
  );
}

function StepRow({
  step,
  idx,
  iconLookup,
  onOpenVault,
}: {
  step: CachedActionPlan["steps"][number];
  idx: number;
  iconLookup: IconLookup;
  onOpenVault: (vaultId: string) => void;
}) {
  if (step.kind === "swap") {
    return <SwapStepRow s={step} idx={idx} iconLookup={iconLookup} />;
  }
  if (step.kind === "split") {
    return <SplitStepRow s={step} idx={idx} iconLookup={iconLookup} />;
  }
  if (step.kind === "merge") {
    return <MergeStepRow s={step} idx={idx} iconLookup={iconLookup} />;
  }
  if (step.kind === "redeemFromVault") {
    return <RedeemStepRow s={step} idx={idx} iconLookup={iconLookup} />;
  }
  if (step.kind === "cancelRedeemFromVault") {
    return <CancelStepRow s={step} idx={idx} />;
  }
  return (
    <DepositStepRow
      s={step}
      idx={idx}
      iconLookup={iconLookup}
      onOpen={onOpenVault}
    />
  );
}

function RedeemStepRow({
  s,
  idx,
  iconLookup,
}: {
  s: import("@/lib/ai/action-plan-cache").ResolvedRedeemStep;
  idx: number;
  iconLookup: IconLookup;
}) {
  return (
    <div
      className="flex w-full items-center gap-2.5 liquid-glass px-3 py-2.5"
      style={{ borderRadius: 14 }}
    >
      <StepIndex n={idx + 1} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <AssetIcon
          src={s.vault.logoUrl ?? iconLookup(s.vault.depositCoinType)}
          label={s.vault.name}
          size={20}
        />
        <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
          {fmtAmount(s.sharesHuman)}
        </span>
        <span className="text-caption text-canvas-white/55">
          {s.receiptSymbol}
        </span>
        <ArrowRight
          className="size-3 shrink-0 text-canvas-white/40"
          strokeWidth={2.4}
        />
        <span className="truncate text-body-sm font-semibold text-canvas-white">
          {s.vault.name}
        </span>
      </div>
      <ActionTag
        icon={<Repeat className="size-3 -scale-x-100" strokeWidth={2.4} />}
        label={
          s.vault.withdrawalPeriodDays
            ? `Withdraw · ≤${s.vault.withdrawalPeriodDays}d`
            : "Withdraw"
        }
      />
    </div>
  );
}

function CancelStepRow({
  s,
  idx,
}: {
  s: import("@/lib/ai/action-plan-cache").ResolvedCancelRedeemStep;
  idx: number;
}) {
  return (
    <div
      className="flex w-full items-center gap-2.5 liquid-glass px-3 py-2.5"
      style={{ borderRadius: 14 }}
    >
      <StepIndex n={idx + 1} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-body-sm font-semibold text-canvas-white">
          Cancel withdrawal · {s.vault.name}
        </span>
        <span className="text-caption text-canvas-white/55">
          req #{s.sequenceNumber}
        </span>
      </div>
      <ActionTag
        icon={<X className="size-3" strokeWidth={2.4} />}
        label="Cancel"
      />
    </div>
  );
}

function StepIndex({ n, lit }: { n: number; lit?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center text-caption font-semibold tabular-nums transition-colors",
        lit
          ? "bg-midnight-black/5 text-canvas-white group-hover:bg-cash-lime"
          : "bg-midnight-black/5 text-canvas-white",
      )}
      style={{ borderRadius: 8 }}
    >
      {n}
    </span>
  );
}

function ActionTag({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 text-caption font-medium uppercase tracking-wider text-canvas-white/40">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function MergeStepRow({
  s,
  idx,
  iconLookup,
}: {
  s: import("@/lib/ai/action-plan-cache").ResolvedMergeStep;
  idx: number;
  iconLookup: IconLookup;
}) {
  return (
    <div
      className="flex w-full items-center gap-2.5 liquid-glass px-3 py-2.5"
      style={{ borderRadius: 14 }}
    >
      <StepIndex n={idx + 1} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="flex flex-wrap items-center gap-1">
          {s.sources.map((src, i) => (
            <span
              key={i}
              className="inline-flex items-center liquid-glass px-1.5 py-0 text-caption tabular-nums text-canvas-white"
              style={{ borderRadius: 9999 }}
            >
              {fmtAmount(src.human)}
            </span>
          ))}
        </span>
        <ArrowRight
          className="size-3 shrink-0 text-canvas-white/40"
          strokeWidth={2.4}
        />
        <AssetIcon src={iconLookup(s.coinType)} label={s.symbol} size={20} />
        <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
          {fmtAmount(s.totalHuman)}
        </span>
        <span className="text-caption text-canvas-white/55">{s.symbol}</span>
      </div>
      <ActionTag
        icon={<Merge className="size-3" strokeWidth={2.4} />}
        label="Merge"
      />
    </div>
  );
}

function SwapStepRow({
  s,
  idx,
  iconLookup,
}: {
  s: ResolvedSwapStep;
  idx: number;
  iconLookup: IconLookup;
}) {
  const impact =
    s.impactPct !== undefined && s.impactPct > 0
      ? s.impactPct < 0.001
        ? "<0.001%"
        : `${s.impactPct.toFixed(3)}%`
      : null;
  return (
    <div
      className="flex w-full items-center gap-2.5 liquid-glass px-3 py-2.5"
      style={{ borderRadius: 14 }}
    >
      <StepIndex n={idx + 1} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <AssetIcon
          src={iconLookup(s.fromCoinType)}
          label={s.fromSymbol}
          size={20}
        />
        <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
          {fmtAmount(s.fromAmountHuman)}
        </span>
        <span className="text-caption text-canvas-white/55">{s.fromSymbol}</span>
        <ArrowRight
          className="size-3 shrink-0 text-canvas-white/40"
          strokeWidth={2.4}
        />
        <AssetIcon
          src={iconLookup(s.toCoinType)}
          label={s.toSymbol}
          size={20}
        />
        <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
          ≈ {fmtAmount(s.toAmountHuman)}
        </span>
        <span className="text-caption text-canvas-white/55">{s.toSymbol}</span>
      </div>
      <ActionTag
        icon={<Repeat className="size-3" strokeWidth={2.4} />}
        label={impact ? `Swap · ${impact}` : "Swap"}
      />
    </div>
  );
}

function SplitStepRow({
  s,
  idx,
  iconLookup,
}: {
  s: ResolvedSplitStep;
  idx: number;
  iconLookup: IconLookup;
}) {
  return (
    <div
      className="flex w-full items-center gap-2.5 liquid-glass px-3 py-2.5"
      style={{ borderRadius: 14 }}
    >
      <StepIndex n={idx + 1} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <AssetIcon
          src={iconLookup(s.sourceCoinType)}
          label={s.sourceSymbol}
          size={20}
        />
        <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
          {fmtAmount(s.totalHuman)}
        </span>
        <span className="text-caption text-canvas-white/55">{s.sourceSymbol}</span>
        <ArrowRight
          className="size-3 shrink-0 text-canvas-white/40"
          strokeWidth={2.4}
        />
        <span className="flex flex-wrap items-center gap-1">
          {s.portions.map((p, i) => (
            <span
              key={i}
              className="inline-flex items-center liquid-glass px-2 py-0 text-caption font-semibold tabular-nums text-canvas-white"
              style={{ borderRadius: 9999 }}
            >
              {(p.bps / 100).toFixed(p.bps % 100 === 0 ? 0 : 2)}%
            </span>
          ))}
        </span>
      </div>
      <ActionTag
        icon={<Split className="size-3" strokeWidth={2.4} />}
        label="Split"
      />
    </div>
  );
}

function DepositStepRow({
  s,
  idx,
  iconLookup,
  onOpen,
}: {
  s: ResolvedDepositStep;
  idx: number;
  iconLookup: IconLookup;
  onOpen: (vaultId: string) => void;
}) {
  const lockup = s.vault.withdrawalPeriodDays
    ? `${s.vault.withdrawalPeriodDays}d lockup`
    : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(s.vault.id)}
      className="group flex w-full items-center gap-2.5 liquid-glass px-3 py-2.5 text-left transition-colors hover:bg-cash-lime/10"
      style={{ borderRadius: 14 }}
    >
      <StepIndex n={idx + 1} lit />

      <div className="flex shrink-0 items-center gap-1.5">
        <AssetIcon
          src={iconLookup(s.sourceCoinType)}
          label={s.sourceSymbol}
          size={20}
        />
        <span className="text-body-sm font-semibold tabular-nums text-canvas-white">
          {fmtAmount(s.amountHuman)}
        </span>
        <span className="text-caption text-canvas-white/55">{s.sourceSymbol}</span>
      </div>

      <ArrowRight
        className="size-3 shrink-0 text-canvas-white/40"
        strokeWidth={2.4}
      />

      <div className="min-w-0 flex-1">
        <div className="truncate text-body-sm font-semibold leading-tight text-canvas-white">
          {s.vault.name}
        </div>
        <div className="truncate text-caption leading-tight text-canvas-white/55">
          {s.vault.category}
          {lockup ? ` · ${lockup}` : ""}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="text-right leading-tight">
          <div className="text-[10px] font-medium uppercase tracking-wider text-canvas-white/55">
            APY
          </div>
          <div className="text-body-sm font-semibold tabular-nums text-canvas-white">
            {fmtPct(s.vault.apyPct)}
          </div>
        </div>
        <ChevronRight
          className="size-4 text-canvas-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-canvas-white"
          strokeWidth={2.4}
        />
      </div>
    </button>
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
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "lime";
}) {
  return (
    <div
      className={cn(
        "liquid-glass px-3 py-2",
        tone === "lime" && "bg-cash-lime/15",
      )}
      style={{ borderRadius: 14 }}
    >
      <div className="text-caption font-medium uppercase tracking-wider text-canvas-white/55">
        {label}
      </div>
      <div className="text-body font-semibold tabular-nums text-canvas-white">
        {value}
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
};

function buildRisks(cached: CachedActionPlan): GuardianRow[] {
  const out: GuardianRow[] = [];
  const deposits = cached.steps.filter(
    (s): s is ResolvedDepositStep => s.kind === "deposit",
  );
  const swaps = cached.steps.filter(
    (s): s is ResolvedSwapStep => s.kind === "swap",
  );

  if (deposits.length > 0) {
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
      return c.includes("liquidity") || c.includes("concentrated") || c.includes("amm");
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
  }

  if (swaps.length > 0) {
    const maxImpact = Math.max(
      0,
      ...swaps.map((s) => s.impactPct ?? 0),
    );
    let v: RiskVerdict = "pass";
    if (maxImpact >= 5) v = "block";
    else if (maxImpact >= 1) v = "flag";
    out.push({
      id: "swap-impact",
      title: `Swap leg${swaps.length > 1 ? "s" : ""} · price impact`,
      summary:
        swaps.length === 1
          ? `${(swaps[0].impactPct ?? 0).toFixed(3)}% impact across ${swaps[0].hops} hop(s) on ${swaps[0].dexes.join(" + ")}`
          : `${swaps.length} swaps · max ${maxImpact.toFixed(3)}% impact`,
      verdict: v,
      detail:
        getGlossary("price-impact") +
        "\n\n**For this plan:** impact is computed against oracle USD prices, not the SDK's optimistic estimate.",
      askPrompt:
        "What's price impact and is the swap leg going to cost me?",
    });
  }

  const gas = cached.summary.estimatedGasSui;
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

  return out;
}

function PlanReceipt({
  confirming,
  txStatus,
  txError,
  txDigest,
  gasUsedSui,
  receivedShares,
  deposits,
}: {
  confirming: boolean;
  txStatus?: "success" | "failure";
  txError?: string;
  txDigest?: string;
  gasUsedSui?: number;
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
      className={cn(
        "space-y-2 px-3 py-2.5",
        confirming && "liquid-glass",
        success && "bg-cash-lime/15",
        failure && "bg-destructive/15",
      )}
      style={{ borderRadius: 14 }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-body-sm font-semibold text-canvas-white">
          {confirming ? (
            <>
              <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
              Waiting for finality on Sui…
            </>
          ) : success ? (
            <>
              <span
                className="inline-flex size-5 items-center justify-center bg-cash-lime text-midnight-black"
                style={{ borderRadius: 9999 }}
              >
                <Check className="size-3" strokeWidth={2.8} />
              </span>
              Plan executed
            </>
          ) : (
            <>
              <span
                className="inline-flex size-5 items-center justify-center bg-destructive text-canvas-white"
                style={{ borderRadius: 9999 }}
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
            className="inline-flex items-center gap-1 liquid-glass px-2.5 py-1 font-mono text-caption text-canvas-white"
            style={{ borderRadius: 9999 }}
          >
            {txDigest.slice(0, 6)}…{txDigest.slice(-4)}
            <ExternalLink className="size-3" strokeWidth={2.2} />
          </a>
        )}
      </div>

      {success && receivedShares && receivedShares.length > 0 && (
        <ul className="space-y-1 text-caption text-canvas-white/55">
          {deposits.map((d, i) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{d.vault.name}</span>
              <span className="tabular-nums font-semibold text-canvas-white">
                +{fmtAmount(receivedShares[i] ?? 0)} shares
              </span>
            </li>
          ))}
          {gasUsedSui !== undefined && (
            <li className="flex items-center justify-between gap-2 pt-1">
              <span>Gas</span>
              <span className="tabular-nums font-semibold text-canvas-white">
                {gasUsedSui.toFixed(4)} SUI
              </span>
            </li>
          )}
        </ul>
      )}

      {failure && txError && (
        <div className="text-caption text-destructive">{txError}</div>
      )}
    </motion.div>
  );
}
