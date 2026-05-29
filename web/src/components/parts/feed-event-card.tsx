"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { fmtUsd, fmtAmount } from "@/lib/format";
import { FeedRow, type FeedAction } from "@/components/parts/feed-row";
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
        ? `${fmtAmount(display.nativeAmount, 2)} shares`
        : `${fmtAmount(display.nativeAmount, 2)} ${display.ticker}`
      : display.ticker;
  const valueText = hasUsd ? fmtUsd(display.usd!) : nativeText;

  const verb = isRedeem ? "Withdrew" : "Deposited";
  const connector = isRedeem ? "from" : "into";
  const vaultName = display.vaultName ?? "a vault";

  const action: FeedAction = isRedeem
    ? { icon: ArrowUpRight, tone: "neutral", label: "Vault withdraw" }
    : { icon: ArrowDownLeft, tone: "green", label: "Vault deposit" };

  const askPrompt = `What happened in transaction ${event.digest}?`;

  return (
    <FeedRow
      sender={event.sender}
      senderName={event.senderName}
      timestampMs={event.timestampMs}
      digest={event.digest}
      askPrompt={askPrompt}
      isSelf={isSelf}
      fresh={fresh}
      action={action}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body text-muted-ash">
        <span>{verb}</span>
        <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
          <AssetIcon src={display.tokenIcon} label={display.ticker} size={14} />
          <span className="font-medium tabular-nums text-midnight-ink">
            {valueText}
          </span>
        </span>
        <span>{connector}</span>
        <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
          {display.vaultLogo && (
            <AssetIcon src={display.vaultLogo} label={vaultName} size={14} />
          )}
          <span className="font-medium text-midnight-ink">{vaultName}</span>
        </span>
      </div>
    </FeedRow>
  );
}
