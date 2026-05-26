"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { Tag } from "@/components/ui/tag";
import { fmtUsd, fmtAmount, fmtPct } from "@/lib/format";
import { FeedRow, FeedRowBadge } from "@/components/parts/feed-row";
import type { FeedEvent, EventDisplay } from "@/lib/sui-events";

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
  const showApy = typeof display.apyPct === "number" && display.apyPct > 0;

  return (
    <FeedRow
      sender={event.sender}
      senderName={event.senderName}
      timestampMs={event.timestampMs}
      digest={event.digest}
      isSelf={isSelf}
      fresh={fresh}
      badge={
        <FeedRowBadge className={isRedeem ? "bg-warning" : "bg-deliver-green"}>
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
        </FeedRowBadge>
      }
    >
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
    </FeedRow>
  );
}
