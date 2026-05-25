"use client";

import { motion } from "motion/react";
import { AlertTriangle, Sparkles } from "lucide-react";
import type { CoinMap } from "@/lib/client-coins";
import { canonicalCoinType } from "@/lib/client-coins";
import { fmtAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────
 * Friendly error banner. Today we recognize:
 *   • "Insufficient balance of <coinType> for owner <addr>.
 *      Required: <raw>, Available: <raw>"   (7K SDK)
 * Everything else falls back to a minimal generic banner.
 * ───────────────────────────────────────────────────────── */

type InsufficientBalance = {
  coinType: string;
  requiredRaw: string;
  availableRaw: string;
};

function parseInsufficientBalance(
  msg: string,
): InsufficientBalance | null {
  // 7K SDK shape: "Insufficient balance of <coinType> for owner <addr>. Required: <int>, Available: <int>"
  const m = msg.match(
    /Insufficient balance of (\S+) for owner \S+\.\s*Required:\s*(\d+),\s*Available:\s*(\d+)/i,
  );
  if (!m) return null;
  const [, coinType, requiredRaw, availableRaw] = m;
  return {
    coinType: coinType.replace(/[.,]$/, ""),
    requiredRaw,
    availableRaw,
  };
}

function lookupCoin(
  map: CoinMap | null,
  coinType: string,
): { symbol: string; decimals: number } {
  if (map) {
    const canon = canonicalCoinType(coinType);
    for (const [symbol, info] of Object.entries(map)) {
      if (canonicalCoinType(info.coin_type) === canon) {
        return { symbol, decimals: info.decimals };
      }
    }
  }
  // Last-resort fallback: pull the module::TYPE off the coin_type
  const tail = coinType.split("::").pop() ?? "TOKEN";
  return { symbol: tail.toUpperCase(), decimals: 9 };
}

type Props = {
  message: string;
  coinMap: CoinMap | null;
  /** Optional: dispatch a follow-up message to the agent. */
  onAskAgent?: (prompt: string) => void;
  /** Optional: clear the error (cancel plan). */
  onDismiss?: () => void;
};

export function ErrorBanner({
  message,
  coinMap,
  onAskAgent,
  onDismiss,
}: Props) {
  const parsed = parseInsufficientBalance(message);
  if (parsed) {
    const { symbol, decimals } = lookupCoin(coinMap, parsed.coinType);
    const required = Number(parsed.requiredRaw) / 10 ** decimals;
    const available = Number(parsed.availableRaw) / 10 ** decimals;
    const short = Math.max(0, required - available);
    const fixPrompt = `I only have ${fmtAmount(available)} ${symbol} but the plan needs ${fmtAmount(required)} ${symbol}. Rebuild the plan to use at most ${fmtAmount(available)} ${symbol}.`;
    return (
      <BannerShell
        tone="warn"
        icon={<AlertTriangle className="size-4" strokeWidth={2.4} />}
        title={`Not enough ${symbol}`}
        body={`This plan needs more ${symbol} than your wallet has on hand.`}
      >
        <dl className="grid grid-cols-3 gap-2 text-caption text-muted-ash">
          <Row label="Required" value={`${fmtAmount(required)} ${symbol}`} />
          <Row label="You have" value={`${fmtAmount(available)} ${symbol}`} />
          <Row
            label="Short by"
            value={`${fmtAmount(short)} ${symbol}`}
            emphasized
          />
        </dl>
        <Actions>
          {onAskAgent && (
            <ActionButton
              onClick={() => onAskAgent(fixPrompt)}
              primary
              icon={<Sparkles className="size-3.5" strokeWidth={2.4} />}
            >
              Rebuild to fit my balance
            </ActionButton>
          )}
          {onDismiss && (
            <ActionButton onClick={onDismiss}>Cancel plan</ActionButton>
          )}
        </Actions>
      </BannerShell>
    );
  }

  // Generic fallback — still on-brand, just less specific.
  return (
    <BannerShell
      tone="warn"
      icon={<AlertTriangle className="size-4" strokeWidth={2.4} />}
      title="Couldn't complete the action"
      body={message}
    >
      {onDismiss && (
        <Actions>
          <ActionButton onClick={onDismiss}>Cancel</ActionButton>
        </Actions>
      )}
    </BannerShell>
  );
}

function BannerShell({
  tone,
  icon,
  title,
  body,
  children,
}: {
  tone: "warn" | "error";
  icon: React.ReactNode;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.25, bounce: 0.2 }}
      className={cn("rounded-card", 
        "space-y-2.5 p-4",
        tone === "warn" && "bg-warning/15",
        tone === "error" && "bg-destructive/12",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn("rounded-[10px]", 
            "inline-flex size-7 shrink-0 items-center justify-center",
            tone === "warn" && "bg-warning text-midnight-ink",
            tone === "error" && "bg-destructive text-canvas-white",
          )}
        >
          {icon}
        </span>
        <div className="flex-1 space-y-0.5 pt-0.5">
          <div className="text-body-sm font-medium leading-tight text-midnight-ink">
            {title}
          </div>
          {body && (
            <div className="text-body-sm text-muted-ash">{body}</div>
          )}
        </div>
      </div>
      {children}
    </motion.div>
  );
}

function Row({
  label,
  value,
  emphasized,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className="space-y-0 surface-panel px-3 py-2 rounded-card"
    >
      <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
        {label}
      </div>
      <div
        className={cn(
          "text-body-sm font-medium tabular-nums",
          emphasized ? "text-midnight-ink" : "text-midnight-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function ActionButton({
  children,
  onClick,
  primary,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-button", 
        "inline-flex items-center gap-1.5 px-3.5 py-1.5 text-body-sm font-medium transition-transform",
        "hover:scale-[1.03] active:scale-[0.97]",
        primary
          ? "bg-midnight-ink text-canvas-white"
          : "surface-panel text-midnight-ink",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
