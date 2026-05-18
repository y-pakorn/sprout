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
} from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import type { CachedQuote } from "@/lib/ai/quote-cache";
import { SLIPPAGE_OPTIONS } from "@/lib/intent";
import { extractRoute, dexLabel } from "@/lib/bluefin7k";
import { truncateCoinType } from "@/lib/client-coins";
import { fadeUp, scaleIn, stagger, SPRING_BOUNCY } from "@/lib/motion";

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
  executed: boolean;
  txDigest?: string;
  walletConnected: boolean;
};

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
      summary: `${impactPct.toFixed(3)}% — ${impactVerdict === "block" ? "very high" : impactVerdict === "flag" ? "elevated" : "low"}`,
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
  executed,
  txDigest,
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

  // Auto-refresh: every 5s + immediately after slippage change. Skipped
  // while signing or after execution.
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const refresh = async () => {
    if (signing || executed || inFlight.current) return;
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
    if (signing || executed) return;
    const id = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signing, executed]);

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
      className="space-y-5 bg-cloud-gray p-6"
      style={{ borderRadius: 24 }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-caption font-medium uppercase tracking-wider text-cash-lime">
          Swap quote · live from Bluefin7K
        </div>
        <div className="flex items-center gap-1.5 text-caption text-subtle-gray">
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
        className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"
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
          className="inline-flex size-9 shrink-0 items-center justify-center self-center bg-cash-lime text-midnight-black"
          style={{ borderRadius: 9999 }}
        >
          <ArrowRight className="hidden size-4 sm:block" strokeWidth={2.5} />
          <ArrowDown className="size-4 sm:hidden" strokeWidth={2.5} />
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Rate" value={`1 ${fromSymbol} ≈ ${rate.toFixed(6)} ${toSymbol}`} />
        <Stat
          label="Price impact"
          value={`${impactPct.toFixed(3)}%`}
          tone={
            impactPct >= 5 ? "block" : impactPct >= 1 ? "warn" : "default"
          }
        />
        <Stat label="Network fee" value={`~$${(0.018).toFixed(3)}`} />
      </div>

      {/* Comprehensive route breakdown — every split, every DEX */}
      <RouteBreakdown cached={cached} iconLookup={iconLookup} />

      {/* Guardian — inline risk panel (warning row removed; impact verdict already covers it) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex size-7 items-center justify-center bg-cash-lime text-midnight-black"
            style={{ borderRadius: 12 }}
          >
            <ShieldCheck className="size-3.5" strokeWidth={2.4} />
          </span>
          <div>
            <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
              Guardian
            </div>
            <div className="text-body-sm font-semibold leading-tight">
              {flagged === 0
                ? "All clear"
                : `${flagged} need${flagged === 1 ? "s" : ""} attention`}
            </div>
          </div>
        </div>
        <div className="divide-y divide-ghost-border">
          {risks.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 py-2 first:pt-1 last:pb-1"
            >
              <span
                className={`inline-block size-1.5 shrink-0 ${verdictDot(r.verdict)}`}
                style={{ borderRadius: 9999 }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-body-sm font-medium leading-tight">
                  {r.label}
                </div>
                <div className="truncate text-body-sm text-subtle-gray">
                  {r.summary}
                </div>
              </div>
              <span
                className={`inline-flex shrink-0 items-center px-2 py-0.5 text-caption font-semibold uppercase tracking-wider ${verdictPill(r.verdict)}`}
                style={{ borderRadius: 9999 }}
              >
                {VERDICT_LABEL[r.verdict]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {!executed && (
        <div className="space-y-2 border-t border-ghost-border pt-4">
          <div className="text-body-sm font-medium text-midnight-black">
            Max slippage
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SLIPPAGE_OPTIONS.map((opt) => {
              const active = slippagePct === opt;
              return (
                <motion.button
                  key={opt}
                  type="button"
                  onClick={() => onSlippageChange(opt)}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{
                    type: "spring",
                    visualDuration: 0.2,
                    bounce: 0.3,
                  }}
                  disabled={signing}
                  className={`px-4 py-2 text-body-sm font-medium ${
                    active
                      ? "bg-cash-lime text-midnight-black"
                      : "bg-canvas-white text-midnight-black"
                  }`}
                  style={{ borderRadius: 9999 }}
                >
                  {opt}%
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {!executed ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <motion.button
            onClick={onCancel}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            disabled={signing}
            className="bg-canvas-white px-5 py-2.5 text-body-sm font-medium text-midnight-black disabled:opacity-50"
            style={{ borderRadius: 9999 }}
          >
            Cancel
          </motion.button>
          <motion.button
            onClick={onConfirm}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            disabled={signing || !walletConnected}
            className={`inline-flex items-center gap-2 px-6 py-2.5 text-body-sm font-semibold disabled:bg-hinting-gray disabled:text-canvas-white ${
              blocking
                ? "bg-destructive text-canvas-white"
                : "bg-cash-lime text-midnight-black"
            }`}
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
      ) : (
        <div
          className="flex flex-col gap-2 bg-cash-lime/15 p-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderRadius: 14 }}
        >
          <div className="text-body-sm font-semibold text-midnight-black">
            ✓ Submitted to Sui
          </div>
          {txDigest && (
            <a
              href={`https://suiscan.xyz/mainnet/tx/${txDigest}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 bg-canvas-white px-3 py-1 font-mono text-body-sm text-midnight-black"
              style={{ borderRadius: 9999 }}
            >
              {txDigest.slice(0, 6)}…{txDigest.slice(-4)}
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
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
      className="flex flex-1 items-center gap-3 bg-canvas-white p-4"
      style={{ borderRadius: 18 }}
    >
      <AssetIcon src={iconUrl} label={symbol} size={44} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
          {label}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="truncate text-title font-semibold tabular-nums leading-tight">
            {approximate ? "≈" : ""}
            {amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </span>
          <span className="text-body-sm font-medium text-subtle-gray">
            {symbol}
          </span>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 font-mono text-caption text-subtle-gray transition-colors hover:text-midnight-black"
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
      className={`bg-canvas-white px-4 py-3 ${
        tone === "warn"
          ? "ring-2 ring-warning/40"
          : tone === "block"
            ? "ring-2 ring-destructive/40"
            : ""
      }`}
      style={{ borderRadius: 14 }}
    >
      <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
        {label}
      </div>
      <div
        className={`text-body font-semibold tabular-nums ${
          tone === "block" ? "text-destructive" : ""
        }`}
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

  // Diagnostic so we can verify the raw SDK shape in dev tools
  if (typeof window !== "undefined") {
    console.log(
      "[route] routes=",
      routes.length,
      "shares=",
      withShares.map((r) => Number((r._share * 100).toFixed(2))),
      "dexes=",
      withShares.map((r) =>
        r.hops.map((h) => h.pool?.type).join(" → "),
      ),
    );
  }

  const sorted = [...withShares].sort((a, b) => b._share - a._share);
  const VISIBLE = 4;
  const visible = expanded ? sorted : sorted.slice(0, VISIBLE);
  const remaining = sorted.length - visible.length;

  return (
    <div
      className="space-y-3 bg-canvas-white p-4"
      style={{ borderRadius: 18 }}
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <AssetIcon src={cached.fromIcon} label={cached.fromSymbol} size={20} />
          <span className="text-body-sm font-medium">{cached.fromSymbol}</span>
          <ArrowRight className="size-3 text-subtle-gray" strokeWidth={2.4} />
          <AssetIcon src={cached.toIcon} label={cached.toSymbol} size={20} />
          <span className="text-body-sm font-medium">{cached.toSymbol}</span>
        </div>
        <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
          {sorted.length} split{sorted.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="space-y-1.5">
        {sorted.length === 0 ? (
          <div className="text-body-sm text-subtle-gray">
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
          className="inline-flex items-center gap-1 bg-cloud-gray px-3 py-1 text-caption font-medium text-midnight-black transition-opacity hover:opacity-70"
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
        className="inline-flex shrink-0 items-center bg-cash-lime/20 px-2 py-0.5 font-mono text-caption font-semibold tabular-nums text-midnight-black"
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
                className="size-3 shrink-0 text-subtle-gray"
                strokeWidth={2.4}
              />
            )}
            <span
              className="inline-flex shrink-0 items-center gap-1.5 bg-cloud-gray py-0.5 pl-1 pr-2.5 text-body-sm font-medium text-midnight-black"
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
