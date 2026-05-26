"use client";

import { motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { Identicon } from "@/components/ui/identicon";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { fmtUsd, fmtAmount, fmtRelative, fmtPct } from "@/lib/format";
import { shortAddr } from "@/lib/avatar";
import type { FeedEvent, EventDisplay } from "@/lib/sui-events";

function explorerTxUrl(digest: string): string {
  return `https://suiscan.xyz/mainnet/tx/${digest}`;
}

type Props = {
  event: FeedEvent;
  display: EventDisplay;
  /** True when the event's owner is the connected wallet. */
  isSelf?: boolean;
  /** True for events that just arrived live — flashes a brief highlight. */
  fresh?: boolean;
};

export function FeedEventCard({
  event,
  display,
  isSelf = false,
  fresh = false,
}: Props) {
  const isRedeem = event.kind === "redeem";
  const name = event.senderName ?? shortAddr(event.sender);
  const hasUsd =
    typeof display.usd === "number" &&
    Number.isFinite(display.usd) &&
    display.usd > 0;

  const nativeText =
    display.nativeAmount != null
      ? display.nativeUnit === "shares"
        ? `${fmtAmount(display.nativeAmount)} shares`
        : `${fmtAmount(display.nativeAmount)} ${display.ticker}`
      : null;

  const headlineValue = hasUsd ? fmtUsd(display.usd!) : nativeText ?? "—";
  const detailText =
    [hasUsd ? nativeText : null, display.vaultName].filter(Boolean).join(" · ") ||
    display.ticker;
  const showApy =
    typeof display.apyPct === "number" && display.apyPct > 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className={cn(
        "relative overflow-hidden surface-card rounded-card px-4 py-3",
        isSelf && "ring-[1.5px] ring-inset ring-deliver-green"
      )}
    >
      {fresh && (
        <motion.span
          aria-hidden
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 2.4, ease: "easeOut" }}
          className="pointer-events-none absolute inset-0 bg-deliver-green/15"
        />
      )}

      <div className="relative flex items-center gap-3">
        {/* Avatar + directional badge (in = green, out = gold) */}
        <div className="relative shrink-0">
          <Identicon address={event.sender} size={40} />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 inline-flex size-4 items-center justify-center rounded-full ring-2 ring-canvas-white",
              isRedeem ? "bg-warning" : "bg-deliver-green"
            )}
          >
            {isRedeem ? (
              <ArrowUpRight
                className="size-2.5 text-midnight-ink"
                strokeWidth={2.6}
              />
            ) : (
              <ArrowDownLeft
                className="size-2.5 text-midnight-ink"
                strokeWidth={2.6}
              />
            )}
          </span>
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          {/* Identity · time · tx */}
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "truncate text-body-sm font-medium text-midnight-ink",
                !event.senderName && "font-mono"
              )}
            >
              {name}
            </span>
            {isSelf && <Tag tone="green">You</Tag>}
            <span className="ml-auto flex shrink-0 items-center gap-1 text-caption text-muted-ash tabular-nums">
              {fmtRelative(event.timestampMs)}
              {event.digest && (
                <a
                  href={explorerTxUrl(event.digest)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View transaction"
                  className="text-muted-ash transition-colors hover:text-midnight-ink"
                >
                  <ExternalLink className="size-3" strokeWidth={2.2} />
                </a>
              )}
            </span>
          </div>

          {/* Action + value */}
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="shrink-0 text-body-sm text-muted-ash">
              {event.label}
            </span>
            <span className="truncate text-body font-medium text-midnight-ink tabular-nums">
              {headlineValue}
            </span>
          </div>

          {/* Token · native · vault · APY */}
          <div className="mt-1 flex items-center gap-1.5 text-caption text-muted-ash">
            <AssetIcon src={display.tokenIcon} label={display.ticker} size={14} />
            <span className="truncate">{detailText}</span>
            {showApy && (
              <Tag tone="green" className="ml-auto shrink-0">
                {fmtPct(display.apyPct)} APY
              </Tag>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}
