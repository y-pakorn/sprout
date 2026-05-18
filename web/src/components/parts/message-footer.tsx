"use client";

import { motion } from "motion/react";
import { RotateCcw } from "lucide-react";
import { computeMessageCost } from "@/lib/ai/pricing";

export type MessageUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
};

export type MessageMeta = {
  usage?: MessageUsage;
  durationMs?: number;
};

type Props = {
  meta?: MessageMeta;
  canRegenerate: boolean;
  onRegenerate?: () => void;
};

function fmtDuration(ms?: number): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

/** Round up to the given decimals — we want to over-report cost, never under. */
function ceilTo(usd: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.ceil(usd * f) / f;
}

function fmtCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return `$${ceilTo(usd, 4).toFixed(4)}`;
  return `$${ceilTo(usd, 3).toFixed(3)}`;
}

/**
 * Subtle per-turn footer: duration · cost · regenerate.
 * Renders nothing if neither duration nor usage are known AND regenerate
 * isn't available — common during streaming.
 */
export function MessageFooter({ meta, canRegenerate, onRegenerate }: Props) {
  const duration = fmtDuration(meta?.durationMs);
  const cost = meta?.usage ? fmtCost(computeMessageCost(meta.usage)) : null;
  const tokens = meta?.usage?.totalTokens;

  const hasStats = duration || cost;
  if (!hasStats && !canRegenerate) return null;

  const tokenLabel = tokens ? `${tokens.toLocaleString()} tokens total` : "";
  const costLabel =
    meta?.usage && cost
      ? `Input ${meta.usage.inputTokens ?? 0}` +
        (meta.usage.cachedInputTokens
          ? ` (cached ${meta.usage.cachedInputTokens})`
          : "") +
        ` · Output ${meta.usage.outputTokens ?? 0}` +
        (tokenLabel ? ` · ${tokenLabel}` : "")
      : "";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, delay: 0.1 }}
      className="mt-1 flex items-center gap-2 text-caption tabular-nums text-hinting-gray"
    >
      {duration && <span>{duration}</span>}
      {duration && cost && <span aria-hidden>·</span>}
      {cost && (
        <span title={costLabel || undefined}>{cost}</span>
      )}
      {canRegenerate && (
        <>
          {hasStats && <span aria-hidden>·</span>}
          <button
            type="button"
            onClick={onRegenerate}
            title="Regenerate response"
            aria-label="Regenerate response"
            className="inline-flex size-5 items-center justify-center text-hinting-gray transition-colors hover:text-midnight-black"
            style={{ borderRadius: 9999 }}
          >
            <RotateCcw className="size-3.5" strokeWidth={2.2} />
          </button>
        </>
      )}
    </motion.div>
  );
}
