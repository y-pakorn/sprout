"use client";

import { useMemo } from "react";
import { Layers, ArrowRight } from "lucide-react";
import type { Transaction } from "@mysten/sui/transactions";
import { ptbCounts } from "@/lib/ptb-view";
import { StatusDisk } from "@/components/ui/status-disk";

// Compact, no-AI, no-network teaser shown inline on a card. Opens the full
// interactive PTB dialog. Reads only counts from the built transaction.

const KIND_LABEL: Record<string, [string, string]> = {
  // [singular, plural]
  MoveCall: ["call", "calls"],
  SplitCoins: ["split", "splits"],
  MergeCoins: ["merge", "merges"],
  TransferObjects: ["transfer", "transfers"],
  MakeMoveVec: ["vector", "vectors"],
  Publish: ["publish", "publishes"],
  Upgrade: ["upgrade", "upgrades"],
};

function kindBreakdown(byKind: Record<string, number>): string {
  return Object.entries(byKind)
    .map(([kind, n]) => {
      const [one, many] = KIND_LABEL[kind] ?? [kind.toLowerCase(), kind.toLowerCase()];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(" · ");
}

export function PtbSummaryStrip({ tx, onOpen }: { tx: Transaction; onOpen: () => void }) {
  const counts = useMemo(() => ptbCounts(tx), [tx]);
  const breakdown = kindBreakdown(counts.byKind);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="surface-panel group flex w-full items-center gap-3 px-3 py-2.5 text-left ring-1 ring-hairline transition-colors hover:bg-whisper-gray rounded-card"
    >
      <StatusDisk tone="neutral" className="size-8">
        <Layers className="size-4" strokeWidth={2.2} />
      </StatusDisk>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-sm font-medium text-midnight-ink">
          {counts.inputs} inputs · {counts.commands} transaction{" "}
          {counts.commands === 1 ? "block" : "blocks"}
        </div>
        {breakdown && (
          <div className="truncate text-caption text-muted-ash">{breakdown}</div>
        )}
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-midnight-ink">
        <span className="hidden sm:inline">View transaction block</span>
        <ArrowRight
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
          strokeWidth={2.4}
        />
      </span>
    </button>
  );
}
