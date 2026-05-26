"use client";

import { AssetIcon } from "@/components/asset-icon";
import { fmtAmount } from "@/lib/format";
import { FeedRow } from "@/components/parts/feed-row";
import type { DexSwapEvent, SwapLeg } from "@/lib/dex-activity";

type Props = {
  event: DexSwapEvent;
  /** True when the trader is the connected wallet. */
  isSelf?: boolean;
  /** True for swaps that just arrived live — flashes a brief highlight. */
  fresh?: boolean;
};

/** An inline "147.16 WAL" token mention — icon + emphasized amount. */
function Mention({ leg }: { leg: SwapLeg }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
      <AssetIcon src={leg.iconUrl} label={leg.symbol} size={16} />
      <span className="font-medium tabular-nums text-midnight-ink">
        {fmtAmount(leg.amount, 2)} {leg.symbol}
      </span>
    </span>
  );
}

export function DexSwapCard({ event, isSelf = false, fresh = false }: Props) {
  const { soldLeg: sold, boughtLeg: bought, projectName: project } = event;

  const askPrompt = `What do you make of this swap — ${fmtAmount(
    sold.amount,
    2,
  )} ${sold.symbol} for ${fmtAmount(bought.amount, 2)} ${bought.symbol}${
    project ? ` on ${project}` : ""
  }?`;

  return (
    <FeedRow
      sender={event.sender}
      senderName={event.senderName}
      timestampMs={event.timestampMs}
      digest={event.digest}
      askPrompt={askPrompt}
      isSelf={isSelf}
      fresh={fresh}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body text-muted-ash">
        <span>Swapped</span>
        <Mention leg={sold} />
        <span>for</span>
        <Mention leg={bought} />
        {project && (
          <>
            <span>on</span>
            <span className="text-midnight-ink">{project}</span>
          </>
        )}
      </div>
    </FeedRow>
  );
}
