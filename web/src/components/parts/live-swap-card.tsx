"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  ArrowDown,
  Loader2,
  ShieldCheck,
  Check,
  Copy,
  ExternalLink,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import type { CachedQuote } from "@/lib/ai/quote-cache";
import { SLIPPAGE_OPTIONS } from "@/lib/intent";
import { extractRoute, dexLabel } from "@/lib/bluefin7k";
import { truncateCoinType } from "@/lib/client-coins";
import { fadeUp, scaleIn, stagger, SPRING_BOUNCY } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useWalletHoldings } from "@/lib/client-wallet";
import {
  computeBalanceCheckFromRequirements,
  type BalanceCheck,
} from "@/lib/balance-check";
import { fmtAmount } from "@/lib/format";

type IconLookup = (coinType: string) => string | undefined;

type Props = {
  cached: CachedQuote;
  slippagePct: number;
  onSlippageChange: (pct: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRefresh: () => Promise<void>;
  iconLookup: IconLookup;
  signing: boolean;
  confirming: boolean;
  executed: boolean;
  txDigest?: string;
  txStatus?: "success" | "failure";
  txError?: string;
  gasUsedSui?: number;
  receivedAmount?: number;
  walletConnected: boolean;
};

/**
 * Heuristic pre-trade gas estimate (SUI). 7K's estimateGasFee needs a
 * built tx with a signer; this hop-count heuristic is close enough for
 * the guardian panel without a wallet round-trip.
 */
function estimatedGasSui(hops: number): number {
  return Math.max(0.005, Math.min(0.03, hops * 0.006));
}

/**
 * Format a price-impact percent for display. Avoid the misleading
 * "0.000%" that rounding down produces for tiny-but-nonzero impacts —
 * show "<0.001%" instead so the user knows it's not literally zero.
 */
function fmtImpactPct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  if (pct < 0.001) return "<0.001%";
  return `${pct.toFixed(3)}%`;
}

const REFRESH_INTERVAL_MS = 5000;

function humanize(amountBase: string, decimals: number): number {
  const big = BigInt(amountBase);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = Number(big / divisor);
  const frac = Number(big % divisor) / Number(divisor);
  return whole + frac;
}

type RiskVerdict = "pass" | "flag" | "block";
type Risk = {
  id: string;
  label: string;
  summary: string;
  verdict: RiskVerdict;
};

const TRUSTED_DEXES = new Set([
  "cetus",
  "cetus_dlmm",
  "aftermath",
  "kriya",
  "kriya_v3",
  "flowx",
  "flowx_v3",
  "bluefin",
  "deepbook_v3",
  "turbos",
]);

function evaluateRisks(cached: CachedQuote, slippagePct: number): Risk[] {
  const impactPct = cached.impactPct;
  const route = extractRoute(cached.quote);

  // 1. Token verification
  const bothVerified = cached.fromVerified && cached.toVerified;

  // 2. Price impact — INFERRED from marketSp/effectivePrice (not the
  //    flaky `quote.warning` string which often false-positives)
  let impactVerdict: RiskVerdict = "pass";
  if (impactPct >= 5) impactVerdict = "block";
  else if (impactPct >= 1) impactVerdict = "flag";

  // 3. Route trust
  const unknownDexes = route.dexes.filter((d) => !TRUSTED_DEXES.has(d));

  // 4. Slippage adequacy
  let slippageVerdict: RiskVerdict = "pass";
  if (slippagePct < impactPct) slippageVerdict = "flag";

  // 5. Gas cost — heuristic SUI estimate × oracle SUI price.
  //    The SUI price comes from the same getTokenPrices call that powers
  //    the price-impact calc; spotRate (priceIn/priceOut) gets us there
  //    via the destination/source pair when one of them is SUI. As a
  //    fallback we assume $3 SUI to keep the verdict meaningful.
  const gasSui = estimatedGasSui(route.hopCount);
  let suiUsd: number | undefined;
  if (cached.fromSymbol === "SUI" && cached.spotRate > 0) {
    suiUsd = 1 / cached.spotRate; // toUnits per SUI inverted is USD per SUI when to is USDC-ish
  } else if (cached.toSymbol === "SUI" && cached.spotRate > 0) {
    suiUsd = cached.spotRate; // 1 fromUnit ≈ spotRate SUI ⇒ SUI USD ≈ spotRate when from is stable
  }
  // The heuristic above is approximate — use $3 as a sane fallback.
  const gasUsd = (suiUsd ?? 3) * gasSui;
  let gasVerdict: RiskVerdict = "pass";
  if (gasUsd >= 1) gasVerdict = "block";
  else if (gasUsd >= 0.1) gasVerdict = "flag";

  return [
    {
      id: "tokens",
      label: "Token verification",
      verdict: bothVerified ? "pass" : "flag",
      summary: bothVerified
        ? `Both ${cached.fromSymbol} & ${cached.toSymbol} are verified`
        : `One of ${cached.fromSymbol} or ${cached.toSymbol} is unverified`,
    },
    {
      id: "impact",
      label: "Price impact",
      verdict: impactVerdict,
      summary: `${fmtImpactPct(impactPct)} — ${impactVerdict === "block" ? "very high" : impactVerdict === "flag" ? "elevated" : "low"}`,
    },
    {
      id: "route",
      label: "Route trust",
      verdict: unknownDexes.length > 0 ? "flag" : "pass",
      summary:
        unknownDexes.length > 0
          ? `Includes unfamiliar venue: ${unknownDexes.map(dexLabel).join(", ")}`
          : `Routed via ${route.dexes.map(dexLabel).join(" + ") || "single DEX"}`,
    },
    {
      id: "slippage",
      label: "Slippage cap",
      verdict: slippageVerdict,
      summary:
        slippageVerdict === "flag"
          ? `${slippagePct}% cap is tighter than ${impactPct.toFixed(2)}% impact — may revert`
          : `${slippagePct}% cap leaves headroom`,
    },
    {
      id: "gas",
      label: "Gas cost",
      verdict: gasVerdict,
      summary: `~${gasSui.toFixed(3)} SUI (~$${gasUsd.toFixed(3)}) — ${
        gasVerdict === "block"
          ? "high"
          : gasVerdict === "flag"
            ? "elevated"
            : "low"
      }`,
    },
  ];
}

function verdictPill(v: RiskVerdict) {
  if (v === "pass") return "bg-cash-lime text-midnight-black";
  if (v === "flag") return "bg-warning text-midnight-black";
  return "bg-destructive text-canvas-white";
}
function verdictDot(v: RiskVerdict) {
  if (v === "pass") return "bg-cash-lime";
  if (v === "flag") return "bg-warning";
  return "bg-destructive";
}
const VERDICT_LABEL: Record<RiskVerdict, string> = {
  pass: "Clear",
  flag: "Heads up",
  block: "Blocked",
};

export function LiveSwapCard({
  cached,
  slippagePct,
  onSlippageChange,
  onConfirm,
  onCancel,
  onRefresh,
  iconLookup,
  signing,
  confirming,
  executed,
  txDigest,
  txStatus,
  txError,
  gasUsedSui,
  receivedAmount,
  walletConnected,
}: Props) {
  const { quote, fromSymbol, toSymbol, fromDecimals, toDecimals } = cached;
  const fromAmount = humanize(quote.swapAmountWithDecimal, fromDecimals);
  const toAmount = humanize(quote.returnAmountWithDecimal, toDecimals);
  const rate = fromAmount > 0 ? toAmount / fromAmount : 0;
  const impactPct = cached.impactPct;
  const risks = evaluateRisks(cached, slippagePct);
  const flagged = risks.filter((r) => r.verdict !== "pass").length;
  const blocking = risks.some((r) => r.verdict === "block");

  const route = extractRoute(quote);
  const swapGasSui = estimatedGasSui(route.hopCount);
  const walletHoldings = useWalletHoldings();
  const balanceCheck =
    walletHoldings.state.status === "ready"
      ? computeBalanceCheckFromRequirements(
          [
            {
              symbol: cached.fromSymbol,
              coinType: cached.fromCoinType,
              decimals: cached.fromDecimals,
              amount: cached.fromAmountHuman,
            },
          ],
          swapGasSui,
          walletHoldings.state.data,
        )
      : null;
  const insufficient = balanceCheck?.hasAnyShortfall ?? false;

  // Auto-refresh: every 5s + immediately after slippage change. Skipped
  // while signing or after execution.
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const refresh = async () => {
    if (signing || confirming || executed || inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  };

  // Periodic refresh
  useEffect(() => {
    if (signing || confirming || executed) return;
    const id = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signing, confirming, executed]);

  // Refresh on slippage change (skip first render)
  const firstSlippageRender = useRef(true);
  useEffect(() => {
    if (firstSlippageRender.current) {
      firstSlippageRender.current = false;
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slippagePct]);

  // "Updated Xs ago"
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const ageSec = Math.max(0, Math.floor((Date.now() - cached.fetchedAt) / 1000));

  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      className="space-y-3 liquid-glass p-4 text-canvas-white"
      style={{ borderRadius: 20 }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-caption font-medium uppercase tracking-wider text-cash-lime">
          Swap quote · live from Bluefin7K
        </div>
        <div className="flex items-center gap-1.5 text-caption text-canvas-white/55">
          <motion.span
            animate={{ rotate: refreshing ? 360 : 0 }}
            transition={
              refreshing
                ? { duration: 0.8, repeat: Infinity, ease: "linear" }
                : { duration: 0 }
            }
            className="inline-flex"
          >
            <RefreshCw className="size-3" strokeWidth={2.4} />
          </motion.span>
          {refreshing
            ? "Refreshing…"
            : ageSec < 2
              ? "Just updated"
              : `Updated ${ageSec}s ago`}
        </div>
      </div>

      {/* Token cards */}
      <motion.div
        variants={stagger(0.05, 0.1)}
        initial="initial"
        animate="animate"
        className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center"
      >
        <TokenCard
          label="You send"
          amount={fromAmount}
          symbol={fromSymbol}
          iconUrl={cached.fromIcon}
          coinType={cached.fromCoinType}
        />
        <motion.div
          variants={{
            initial: { opacity: 0, scale: 0.6, rotate: -90 },
            animate: {
              opacity: 1,
              scale: 1,
              rotate: 0,
              transition: SPRING_BOUNCY,
            },
          }}
          className="inline-flex size-7 shrink-0 items-center justify-center self-center bg-cash-lime text-midnight-black"
          style={{ borderRadius: 9999 }}
        >
          <ArrowRight className="hidden size-3.5 sm:block" strokeWidth={2.6} />
          <ArrowDown className="size-3.5 sm:hidden" strokeWidth={2.6} />
        </motion.div>
        <TokenCard
          label="You receive"
          amount={toAmount}
          symbol={toSymbol}
          iconUrl={cached.toIcon}
          coinType={cached.toCoinType}
          approximate
        />
      </motion.div>

      {/* Stats */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Rate" value={`1 ${fromSymbol} ≈ ${rate.toFixed(6)} ${toSymbol}`} />
        <Stat
          label="Price impact"
          value={fmtImpactPct(impactPct)}
          tone={
            impactPct >= 5 ? "block" : impactPct >= 1 ? "warn" : "default"
          }
        />
        <Stat label="Network fee" value={`~$${(0.018).toFixed(3)}`} />
      </div>

      {/* Comprehensive route breakdown — every split, every DEX */}
      <RouteBreakdown cached={cached} iconLookup={iconLookup} />

      {/* Guardian — inline risk panel (warning row removed; impact verdict already covers it) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex size-5 items-center justify-center bg-cash-lime text-midnight-black"
            style={{ borderRadius: 9 }}
          >
            <ShieldCheck className="size-2.5" strokeWidth={2.6} />
          </span>
          <span className="text-caption font-medium uppercase tracking-wider text-canvas-white/55">
            Guardian
          </span>
          <span className="text-caption font-semibold text-canvas-white">
            ·{" "}
            {flagged === 0
              ? "All clear"
              : `${flagged} need${flagged === 1 ? "s" : ""} attention`}
          </span>
        </div>
        <div className="divide-y divide-ghost-border/60">
          {risks.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2.5 py-1.5 first:pt-0 last:pb-0"
            >
              <span
                className={cn("inline-block size-1.5 shrink-0", verdictDot(r.verdict))}
                style={{ borderRadius: 9999 }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 leading-tight">
                  <span className="text-body-sm font-medium">{r.label}</span>
                  <span className="truncate text-caption text-canvas-white/55">
                    {r.summary}
                  </span>
                </div>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  verdictPill(r.verdict),
                )}
                style={{ borderRadius: 9999 }}
              >
                {VERDICT_LABEL[r.verdict]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {!executed && insufficient && balanceCheck && (
        <div
          className="flex items-start gap-2 border-l-2 border-destructive bg-destructive/10 px-3 py-2"
          style={{ borderRadius: 10 }}
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-destructive"
            strokeWidth={2.4}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body-sm font-semibold text-canvas-white">
              Insufficient balance
            </span>
            <span className="text-caption text-canvas-white/75">
              {swapShortfallSummary(balanceCheck)}
            </span>
          </div>
          <button
            type="button"
            onClick={walletHoldings.refresh}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 bg-white/[0.08] px-2.5 py-1 text-caption font-medium text-canvas-white transition-colors hover:bg-white/[0.14]"
            style={{ borderRadius: 9999 }}
          >
            <RefreshCw className="size-3" strokeWidth={2.4} />
            Refresh
          </button>
        </div>
      )}

      {!executed && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ghost-border/60 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-caption font-medium uppercase tracking-wider text-canvas-white/55">
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
                    className={cn(
                      "px-2.5 py-1 text-caption font-semibold text-canvas-white disabled:opacity-50",
                      active ? "bg-cash-lime" : "liquid-glass",
                    )}
                    style={{ borderRadius: 9999 }}
                  >
                    {opt}%
                  </motion.button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
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
              whileHover={{ scale: insufficient ? 1 : 1.04 }}
              whileTap={{ scale: insufficient ? 1 : 0.96 }}
              disabled={
                signing || confirming || !walletConnected || insufficient
              }
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-1.5 text-body-sm font-semibold disabled:bg-hinting-gray disabled:text-canvas-white",
                insufficient
                  ? "bg-destructive text-canvas-white"
                  : blocking
                    ? "bg-destructive text-canvas-white"
                    : "bg-cash-lime text-midnight-black",
              )}
              style={{ borderRadius: 9999 }}
            >
              {(signing || confirming) && (
                <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
              )}
              {signing
                ? "Signing…"
                : confirming
                  ? "Confirming…"
                  : !walletConnected
                    ? "Connect wallet first"
                    : insufficient && balanceCheck
                      ? swapShortfallButtonLabel(balanceCheck)
                      : blocking
                        ? "Sign anyway →"
                        : "Confirm & sign →"}
            </motion.button>
          </div>
        </div>
      )}

      {(confirming || executed) && (
        <Receipt
          confirming={confirming}
          txStatus={txStatus}
          txError={txError}
          txDigest={txDigest}
          gasUsedSui={gasUsedSui}
          receivedAmount={receivedAmount}
          toSymbol={toSymbol}
        />
      )}
    </motion.div>
  );
}

function Receipt({
  confirming,
  txStatus,
  txError,
  txDigest,
  gasUsedSui,
  receivedAmount,
  toSymbol,
}: {
  confirming: boolean;
  txStatus?: "success" | "failure";
  txError?: string;
  txDigest?: string;
  gasUsedSui?: number;
  receivedAmount?: number;
  toSymbol: string;
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
              Swap confirmed
            </>
          ) : (
            <>
              <span
                className="inline-flex size-5 items-center justify-center bg-destructive text-canvas-white"
                style={{ borderRadius: 9999 }}
              >
                ✕
              </span>
              Swap failed
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

      {success && (receivedAmount !== undefined || gasUsedSui !== undefined) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-canvas-white/55">
          {receivedAmount !== undefined && (
            <span>
              Received{" "}
              <span className="font-semibold tabular-nums text-canvas-white">
                +{receivedAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </span>{" "}
              {toSymbol}
            </span>
          )}
          {gasUsedSui !== undefined && (
            <span>
              Gas{" "}
              <span className="font-semibold tabular-nums text-canvas-white">
                {gasUsedSui.toFixed(4)}
              </span>{" "}
              SUI
            </span>
          )}
        </div>
      )}

      {failure && txError && (
        <div className="text-caption text-destructive">{txError}</div>
      )}
    </motion.div>
  );
}

function TokenCard({
  label,
  amount,
  symbol,
  iconUrl,
  coinType,
  approximate,
}: {
  label: string;
  amount: number;
  symbol: string;
  iconUrl?: string;
  coinType: string;
  approximate?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(coinType);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <motion.div
      variants={fadeUp}
      className="flex flex-1 items-center gap-2.5 liquid-glass px-3 py-2.5"
      style={{ borderRadius: 14 }}
    >
      <AssetIcon src={iconUrl} label={symbol} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-caption font-medium uppercase tracking-wider text-canvas-white/55">
            {label}
          </span>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-0.5 font-mono text-[10px] text-canvas-white/40 transition-colors hover:text-canvas-white"
            title="Copy coin type"
          >
            {truncateCoinType(coinType)}
            {copied ? (
              <Check className="size-2.5 text-cash-lime" strokeWidth={2.6} />
            ) : (
              <Copy className="size-2.5" strokeWidth={2.2} />
            )}
          </button>
        </div>
        <div className="flex items-baseline gap-1.5 leading-tight">
          <span className="truncate text-body-lg font-semibold tabular-nums">
            {approximate ? "≈" : ""}
            {amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </span>
          <span className="text-body-sm font-medium text-canvas-white/55">
            {symbol}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "block";
}) {
  return (
    <div
      className={cn(
        "liquid-glass px-3 py-2",
        tone === "warn" && "ring-2 ring-warning/40",
        tone === "block" && "ring-2 ring-destructive/40",
      )}
      style={{ borderRadius: 14 }}
    >
      <div className="text-caption font-medium uppercase tracking-wider text-canvas-white/55">
        {label}
      </div>
      <div
        className={cn(
          "text-body font-semibold tabular-nums",
          tone === "block" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * RouteBreakdown — one row per split, each row shows share% and
 * the full DEX chain (with arrows between hops). All data sourced
 * from quote.routes[].hops[].pool.type and route.share (or derived
 * from tokenInAmount when share is missing). Nothing fabricated.
 * ───────────────────────────────────────────────────────────────── */
function RouteBreakdown({
  cached,
  iconLookup,
}: {
  cached: CachedQuote;
  iconLookup: IconLookup;
}) {
  const { quote } = cached;
  const [expanded, setExpanded] = useState(false);
  const routes = quote.routes ?? [];

  // Compute share when the SDK doesn't provide it: ratio of this route's
  // tokenInAmount to the sum across all routes.
  const totalIn = routes.reduce(
    (s, r) => s + (Number(r.tokenInAmount) || 0),
    0,
  );
  const withShares = routes.map((r) => {
    const declared = typeof r.share === "number" ? r.share : null;
    const derived = totalIn > 0 ? Number(r.tokenInAmount) / totalIn : 0;
    return { ...r, _share: declared ?? derived };
  });

  const sorted = [...withShares].sort((a, b) => b._share - a._share);
  const VISIBLE = 4;
  const visible = expanded ? sorted : sorted.slice(0, VISIBLE);
  const remaining = sorted.length - visible.length;

  return (
    <div
      className="space-y-3 liquid-glass p-4"
      style={{ borderRadius: 18 }}
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <AssetIcon src={cached.fromIcon} label={cached.fromSymbol} size={20} />
          <span className="text-body-sm font-medium">{cached.fromSymbol}</span>
          <ArrowRight className="size-3 text-canvas-white/55" strokeWidth={2.4} />
          <AssetIcon src={cached.toIcon} label={cached.toSymbol} size={20} />
          <span className="text-body-sm font-medium">{cached.toSymbol}</span>
        </div>
        <div className="text-caption font-medium uppercase tracking-wider text-canvas-white/55">
          {sorted.length} split{sorted.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="space-y-1.5">
        {sorted.length === 0 ? (
          <div className="text-body-sm text-canvas-white/55">
            Single direct route
          </div>
        ) : (
          visible.map((route, i) => (
            <SplitRow key={i} route={route} iconLookup={iconLookup} />
          ))
        )}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1 liquid-glass px-3 py-1 text-caption font-medium text-canvas-white transition-opacity hover:opacity-70"
          style={{ borderRadius: 9999 }}
        >
          <ChevronDown className="size-3" strokeWidth={2.4} />
          {remaining} more split{remaining === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

function symbolFromType(coinType: string): string {
  const parts = coinType.split("::");
  return parts[parts.length - 1] || "?";
}

function SplitRow({
  route,
  iconLookup,
}: {
  route: {
    _share: number;
    hops: Array<{
      pool?: { type?: string };
      tokenIn?: string;
      tokenOut?: string;
    }>;
  };
  iconLookup: IconLookup;
}) {
  const pct = Math.round(route._share * 100);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="inline-flex shrink-0 items-center bg-cash-lime/20 px-2 py-0.5 font-mono text-caption font-semibold tabular-nums text-canvas-white"
        style={{ borderRadius: 9999, minWidth: 40, justifyContent: "center" }}
      >
        {pct}%
      </span>
      {route.hops.map((hop, i) => {
        const type = hop.pool?.type;
        const inIcon = hop.tokenIn ? iconLookup(hop.tokenIn) : undefined;
        const outIcon = hop.tokenOut ? iconLookup(hop.tokenOut) : undefined;
        const inSym = hop.tokenIn ? symbolFromType(hop.tokenIn) : "?";
        const outSym = hop.tokenOut ? symbolFromType(hop.tokenOut) : "?";
        return (
          <Fragment key={i}>
            {i > 0 && (
              <ArrowRight
                className="size-3 shrink-0 text-canvas-white/55"
                strokeWidth={2.4}
              />
            )}
            <span
              className="inline-flex shrink-0 items-center gap-1.5 liquid-glass py-0.5 pl-1 pr-2.5 text-body-sm font-medium text-canvas-white"
              style={{ borderRadius: 9999 }}
              title={`${inSym} → ${outSym} via ${type ?? "unknown"}`}
            >
              <span className="inline-flex -space-x-1">
                <AssetIcon src={inIcon} label={inSym} size={16} />
                <AssetIcon src={outIcon} label={outSym} size={16} />
              </span>
              {type ? dexLabel(type) : "unknown"}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Insufficient-balance copy helpers
// ───────────────────────────────────────────────────────────────────────

function swapShortfallSummary(check: BalanceCheck): string {
  const inputs = check.inputShortfalls;
  const gas = check.gasShortfall;
  if (inputs.length === 0 && gas) {
    return `Wallet is short ${fmtAmount(gas.deficit)} ${gas.symbol} for the network fee (has ${fmtAmount(gas.available)}, plan needs ~${fmtAmount(gas.required)}).`;
  }
  if (inputs.length === 1 && !gas) {
    const s = inputs[0];
    return `Wallet has ${fmtAmount(s.available)} ${s.symbol}, plan needs ${fmtAmount(s.required)} (short by ${fmtAmount(s.deficit)}).`;
  }
  const parts: string[] = [];
  for (const s of inputs) {
    parts.push(`${fmtAmount(s.deficit)} ${s.symbol}`);
  }
  if (gas) parts.push(`${fmtAmount(gas.deficit)} SUI for gas`);
  return `Wallet is short ${parts.join(", ")}.`;
}

function swapShortfallButtonLabel(check: BalanceCheck): string {
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
