"use client";

import { ArrowRight, Repeat } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { fmtAmount } from "@/lib/format";
import { FeedRow, FeedRowBadge } from "@/components/parts/feed-row";
import type { DexSwapEvent, SwapLeg } from "@/lib/dex-activity";

type Props = {
  event: DexSwapEvent;
  /** True when the trader is the connected wallet. */
  isSelf?: boolean;
  /** True for swaps that just arrived live — flashes a brief highlight. */
  fresh?: boolean;
};

function Leg({ leg }: { leg: SwapLeg }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <AssetIcon src={leg.iconUrl} label={leg.symbol} size={16} />
      <span className="truncate">
        {fmtAmount(leg.amount)} {leg.symbol}
      </span>
    </span>
  );
}

export function DexSwapCard({ event, isSelf = false, fresh = false }: Props) {
  const project = event.projectName;

  return (
    <FeedRow
      sender={event.sender}
      senderName={event.senderName}
      timestampMs={event.timestampMs}
      digest={event.digest}
      isSelf={isSelf}
      fresh={fresh}
      badge={
        <FeedRowBadge className="bg-midnight-ink">
          <Repeat className="size-2.5 text-canvas-white" strokeWidth={2.6} />
        </FeedRowBadge>
      }
    >
      {/* Swap pair — the hero line */}
      <div className="mt-0.5 flex items-center gap-1.5 text-body font-medium text-midnight-ink tabular-nums">
        <Leg leg={event.soldLeg} />
        <ArrowRight className="size-3 shrink-0 text-muted-ash" strokeWidth={2.2} />
        <Leg leg={event.boughtLeg} />
      </div>

      {/* Protocol meta */}
      <div className="mt-1 flex items-center gap-1.5 text-caption text-muted-ash">
        {project ? (
          <>
            <AssetIcon src={event.projectImg ?? undefined} label={project} size={14} />
            <span className="truncate">Swapped on {project}</span>
          </>
        ) : (
          <span className="truncate">Swapped</span>
        )}
      </div>
    </FeedRow>
  );
}
