"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { ExternalLink, MessageCircle } from "lucide-react";
import { Identicon } from "@/components/ui/identicon";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";
import { shortAddr } from "@/lib/avatar";
import { askSprout } from "@/lib/ask-sprout";

function explorerTxUrl(digest: string): string {
  return `https://suiscan.xyz/mainnet/tx/${digest}`;
}

type Props = {
  sender: string;
  senderName: string | null;
  timestampMs: number;
  digest: string;
  /** Natural-language question the "Ask Sprout" action sends into the chat. */
  askPrompt: string;
  /** True when the row's actor is the connected wallet. */
  isSelf?: boolean;
  /** True for rows that just arrived live — flashes a brief highlight. */
  fresh?: boolean;
  /** The post body — a human sentence narrating the action. */
  children: ReactNode;
};

/**
 * A social-feed "post": avatar, a tweet-style header line (name · time), the
 * narrated action as the body, and a muted action row (Ask Sprout · View tx).
 * Vault events and DEX swaps both render through this — only the body differs.
 */
export function FeedRow({
  sender,
  senderName,
  timestampMs,
  digest,
  askPrompt,
  isSelf = false,
  fresh = false,
  children,
}: Props) {
  const name = isSelf ? "You" : senderName ?? shortAddr(sender);
  const mono = !isSelf && !senderName;

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className={cn(
        "relative overflow-hidden border-b border-hairline px-5 py-4 transition-colors hover:bg-whisper-gray/50",
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

      <div className="relative flex gap-3">
        <Identicon address={sender} size={40} />

        <div className="min-w-0 flex-1">
          {/* Header — name · time */}
          <div className="flex items-center gap-1.5 text-caption text-muted-ash">
            <span
              className={cn(
                "truncate text-body-sm font-medium text-midnight-ink",
                mono && "font-mono",
              )}
            >
              {name}
            </span>
            <span aria-hidden>·</span>
            <RelativeTime ms={timestampMs} />
          </div>

          {/* Body — the narrated action */}
          <div className="mt-0.5">{children}</div>

          {/* Action row */}
          <div className="mt-2 flex items-center gap-4 text-caption text-muted-ash">
            <button
              type="button"
              onClick={() => askSprout(askPrompt)}
              className="inline-flex items-center gap-1 transition-colors hover:text-midnight-ink"
            >
              <MessageCircle className="size-3.5" strokeWidth={2.2} />
              Ask Sprout
            </button>
            {digest && (
              <a
                href={explorerTxUrl(digest)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 transition-colors hover:text-midnight-ink"
              >
                <ExternalLink className="size-3.5" strokeWidth={2.2} />
                View tx
              </a>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}
