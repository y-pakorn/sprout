"use client";

import { motion } from "motion/react";
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { StatusDisk } from "@/components/ui/status-disk";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { fmtAmount, fmtRelative } from "@/lib/format";
import { shortAddr, avatarLetter, avatarTone } from "@/lib/avatar";
import type { FeedEvent } from "@/lib/sui-events";

type Props = {
  event: FeedEvent;
  /** True when the event's owner is the connected wallet. */
  isSelf?: boolean;
  /** Resolved vault name (best-effort, from the vault list). */
  vaultName?: string;
  vaultLogoUrl?: string;
};

function explorerTxUrl(digest: string): string {
  return `https://suiscan.xyz/mainnet/tx/${digest}`;
}

export function FeedEventCard({
  event,
  isSelf = false,
  vaultName,
  vaultLogoUrl,
}: Props) {
  const name = event.senderName ?? shortAddr(event.sender);
  const isRedeem = event.kind === "redeem";
  const value = isRedeem ? event.sharesHuman : event.amountHuman;

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className={cn(
        "surface-card rounded-card px-4 py-3",
        isSelf && "ring-[1.5px] ring-inset ring-deliver-green"
      )}
    >
      <div className="flex gap-3">
        <span
          aria-hidden
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-canvas-white text-body-sm font-medium tracking-[0]"
          style={{ background: avatarTone(event.sender) }}
        >
          {avatarLetter(event.senderName, event.sender)}
        </span>

        <div className="min-w-0 flex-1">
          {/* Identity + time */}
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
            <span className="ml-auto shrink-0 text-caption text-muted-ash tabular-nums">
              {fmtRelative(event.timestampMs)}
            </span>
          </div>

          {/* Action */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body-sm text-muted-ash">
            <StatusDisk tone={event.tone} className="size-6">
              {isRedeem ? (
                <ArrowUpFromLine className="size-3.5" strokeWidth={2.2} />
              ) : (
                <ArrowDownToLine className="size-3.5" strokeWidth={2.2} />
              )}
            </StatusDisk>
            <span>{event.label}</span>
            {typeof value === "number" && (
              <span className="font-medium text-midnight-ink tabular-nums">
                {fmtAmount(value)}
                {isRedeem ? " shares" : ""}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <AssetIcon
                src={vaultLogoUrl ?? event.iconUrl}
                label={event.symbol}
                size={16}
              />
              <span className="text-midnight-ink">{event.symbol}</span>
            </span>
            {vaultName && (
              <span className="truncate">· {vaultName}</span>
            )}
          </div>

          {/* Tx link */}
          {event.digest && (
            <a
              href={explorerTxUrl(event.digest)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 font-mono text-caption text-muted-ash transition-colors hover:text-midnight-ink"
            >
              {shortAddr(event.digest)}
              <ExternalLink className="size-3" strokeWidth={2.2} />
            </a>
          )}
        </div>
      </div>
    </motion.article>
  );
}
