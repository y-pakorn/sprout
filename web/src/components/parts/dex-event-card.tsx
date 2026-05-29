"use client";

import { Repeat, Plus, Minus } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { fmtAmount } from "@/lib/format";
import { FeedRow, type FeedAction } from "@/components/parts/feed-row";
import type { DexEvent, DexKind, SwapLeg } from "@/lib/dex-activity";

type Props = {
  event: DexEvent;
  /** True when the actor is the connected wallet. */
  isSelf?: boolean;
  /** True for events that just arrived live — flashes a brief highlight. */
  fresh?: boolean;
};

/** An inline "147.16 WAL" token mention — icon + emphasized (absolute) amount. */
function Mention({ leg }: { leg: SwapLeg }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
      <AssetIcon src={leg.iconUrl} label={leg.symbol} size={14} />
      <span className="font-medium tabular-nums text-midnight-ink">
        {fmtAmount(Math.abs(leg.amount), 2)} {leg.symbol}
      </span>
    </span>
  );
}

const VERB: Record<DexKind, string> = {
  swap: "Swapped",
  add_liquidity: "Added",
  remove_liquidity: "Removed",
};

const PREP: Record<DexKind, string> = {
  swap: "on",
  add_liquidity: "to",
  remove_liquidity: "from",
};

/** Avatar-corner action mark per DEX kind (mirrors the filter icons). */
const ACTION: Record<DexKind, FeedAction> = {
  swap: { icon: Repeat, tone: "neutral", label: "Swap" },
  add_liquidity: { icon: Plus, tone: "green", label: "Add liquidity" },
  remove_liquidity: { icon: Minus, tone: "gold", label: "Remove liquidity" },
};

export function DexEventCard({ event, isSelf = false, fresh = false }: Props) {
  const { kind, coins, projectName: project } = event;
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
      action={ACTION[kind]}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body text-muted-ash">
        <span>{VERB[kind]}</span>
        {kind === "swap" ? (
          <>
            <Mention leg={coins[0]} />
            <span>for</span>
            <Mention leg={coins[1]} />
          </>
        ) : (
          coins.map((c, i) => (
            <span
              key={c.coinType}
              className="inline-flex items-center gap-1.5"
            >
              {i > 0 && <span>+</span>}
              <Mention leg={c} />
            </span>
          ))
        )}
        {project && (
          <>
            <span>{PREP[kind]}</span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
              {event.projectImg && (
                <AssetIcon src={event.projectImg} label={project} size={14} />
              )}
              <span className="font-medium text-midnight-ink">{project}</span>
            </span>
          </>
        )}
      </div>
    </FeedRow>
  );
}
