"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { Identicon } from "@/components/ui/identicon";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/format";
import { shortAddr } from "@/lib/avatar";

function explorerTxUrl(digest: string): string {
  return `https://suiscan.xyz/mainnet/tx/${digest}`;
}

type Props = {
  sender: string;
  senderName: string | null;
  timestampMs: number;
  digest: string;
  /** Small glyph anchored to the avatar's bottom-right (action indicator). */
  badge: ReactNode;
  /** True when the row's actor is the connected wallet. */
  isSelf?: boolean;
  /** True for rows that just arrived live — flashes a brief highlight. */
  fresh?: boolean;
  /** Body rows rendered below the identity line. */
  children: ReactNode;
};

/**
 * Shared chrome for a feed row: avatar + action badge, the identity / time /
 * tx-link line, and the live-arrival + self highlights. Vault events and DEX
 * swaps both render through this — only the badge and body differ.
 */
export function FeedRow({
  sender,
  senderName,
  timestampMs,
  digest,
  badge,
  isSelf = false,
  fresh = false,
  children,
}: Props) {
  const name = senderName ?? shortAddr(sender);

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className={cn(
        "relative overflow-hidden border-b border-hairline px-5 py-3.5 transition-colors hover:bg-whisper-gray/50",
        isSelf && "bg-deliver-green/[0.06]",
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
        {/* Avatar + action badge */}
        <div className="relative shrink-0">
          <Identicon address={sender} size={40} />
          {badge}
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          {/* Identity · time · tx */}
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "truncate text-body-sm font-medium text-midnight-ink",
                !senderName && "font-mono",
              )}
            >
              {name}
            </span>
            {isSelf && <Tag tone="green">You</Tag>}
            <span className="ml-auto flex shrink-0 items-center gap-1 text-caption text-muted-ash tabular-nums">
              {fmtRelative(timestampMs)}
              {digest && (
                <a
                  href={explorerTxUrl(digest)}
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

          {children}
        </div>
      </div>
    </motion.article>
  );
}

/** The circular action badge anchored to a row avatar. */
export function FeedRowBadge({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 inline-flex size-4 items-center justify-center rounded-full ring-2 ring-canvas-white",
        className,
      )}
    >
      {children}
    </span>
  );
}
