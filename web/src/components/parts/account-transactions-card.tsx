"use client";

import { motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { Tag } from "@/components/ui/tag";
import { CoinFlow } from "@/components/parts/coin-flow";
import { shortAddr } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import type { AccountTxView } from "@/lib/account-transactions";

function explorerTxUrl(digest: string): string {
  return `https://suiscan.xyz/mainnet/tx/${digest}`;
}

/**
 * Raw transaction list rendered after getAccountTransactions resolves. Each row
 * links to the tx on Suiscan. Mirrors the account-activity card chrome.
 */
export function AccountTransactionsCard({
  items,
  address,
  hasNextPage = false,
}: {
  items: AccountTxView[];
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
          Transactions
        </span>
        <span className="font-mono text-caption text-muted-ash">
          {address ? shortAddr(address) : ""}
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((tx, i) => {
          const title = tx.protocol?.name ?? tx.txType;
          const fn = tx.functions.length
            ? tx.functions.slice(0, 3).join(" · ")
            : null;
          return (
            <li key={`${tx.digest}:${i}`}>
              <a
                href={explorerTxUrl(tx.digest)}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "group flex items-center gap-2.5 rounded-card bg-whisper-gray px-3 py-2",
                  "transition-colors hover:bg-light-taupe",
                )}
              >
                <AssetIcon
                  src={tx.protocol?.img}
                  label={tx.protocol?.name ?? tx.txType}
                  size={28}
                />
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-body-sm font-medium text-midnight-ink">
                      {title}
                    </span>
                    {fn && (
                      <span className="truncate font-mono text-caption text-muted-ash">
                        {fn}
                      </span>
                    )}
                    {tx.status && tx.status !== "SUCCESS" && (
                      <Tag tone="red" className="ml-0.5 shrink-0">
                        Failed
                      </Tag>
                    )}
                  </div>
                  <div className="mt-0.5 text-caption text-muted-ash">
                    {tx.coins.length > 0 ? (
                      <CoinFlow coins={tx.coins} />
                    ) : (
                      <span>
                        {tx.txsCount > 0
                          ? `${tx.txsCount} command${tx.txsCount === 1 ? "" : "s"}`
                          : tx.txType}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 text-caption text-muted-ash">
                  <RelativeTime ms={tx.timestampMs} />
                  <ExternalLink
                    className="size-3 opacity-60 transition-opacity group-hover:opacity-100"
                    strokeWidth={2.2}
                  />
                </div>
              </a>
            </li>
          );
        })}
      </ul>
      {hasNextPage && (
        <p className="px-2 pb-1 pt-2 text-caption text-muted-ash">
          Showing the {items.length} most recent.
        </p>
      )}
    </motion.div>
  );
}
