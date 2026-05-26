"use client";

import { motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { Tag } from "@/components/ui/tag";
import { CoinFlow } from "@/components/parts/coin-flow";
import { shortAddr } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import type { TxActivity } from "@/lib/tx-history";

function explorerTxUrl(digest: string): string {
  return `https://suiscan.xyz/mainnet/tx/${digest}`;
}

/**
 * Compact recent-activity list rendered after getTxHistory resolves. Each row
 * links to the tx on Suiscan. Mirrors the in-chat VaultListCard chrome.
 */
export function TxHistoryCard({
  items,
  address,
  hasNextPage = false,
}: {
  items: TxActivity[];
  address: string;
  hasNextPage?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className="surface-card max-w-[520px] rounded-card p-2"
    >
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
          Recent activity
        </span>
        <span className="font-mono text-caption text-muted-ash">
          {address ? shortAddr(address) : ""}
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((a, i) => (
          <li key={`${a.digest}:${i}`}>
            <a
              href={explorerTxUrl(a.digest)}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "group flex items-center gap-2.5 rounded-card bg-whisper-gray px-3 py-2",
                "transition-colors hover:bg-light-taupe",
              )}
            >
              <AssetIcon
                src={a.protocol?.img}
                label={a.protocol?.name ?? a.activity}
                size={28}
              />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-body-sm font-medium text-midnight-ink">
                    {a.activity}
                  </span>
                  {a.protocol?.name && (
                    <span className="truncate text-caption text-muted-ash">
                      · {a.protocol.name}
                    </span>
                  )}
                  {a.status && a.status !== "SUCCESS" && (
                    <Tag tone="red" className="ml-0.5 shrink-0">
                      Failed
                    </Tag>
                  )}
                </div>
                <div className="mt-0.5 text-caption text-muted-ash">
                  <CoinFlow coins={a.coins} />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-caption text-muted-ash">
                <RelativeTime ms={a.timestampMs} />
                <ExternalLink
                  className="size-3 opacity-60 transition-opacity group-hover:opacity-100"
                  strokeWidth={2.2}
                />
              </div>
            </a>
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <p className="px-2 pb-1 pt-2 text-caption text-muted-ash">
          Showing the {items.length} most recent.
        </p>
      )}
    </motion.div>
  );
}
