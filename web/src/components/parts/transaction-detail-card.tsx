"use client";

import { motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { Tag } from "@/components/ui/tag";
import { CoinFlow } from "@/components/parts/coin-flow";
import { shortAddr } from "@/lib/avatar";
import { fmtAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TransactionDetailView } from "@/lib/transaction-detail";

function explorerTxUrl(digest: string): string {
  return `https://suiscan.xyz/mainnet/tx/${digest}`;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption uppercase tracking-wider text-muted-ash">
        {label}
      </span>
      <span className="text-body-sm text-midnight-ink tabular-nums">
        {children}
      </span>
    </div>
  );
}

export function TransactionDetailCard({
  detail,
}: {
  detail: TransactionDetailView;
}) {
  const ok = detail.status === "SUCCESS";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className="surface-card max-w-[640px] rounded-card p-3"
    >
      {/* Header: status + digest link */}
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-body-sm font-medium text-midnight-ink">
            Transaction
          </span>
          <Tag tone={ok ? "green" : "red"}>{ok ? "Success" : "Failed"}</Tag>
        </div>
        <a
          href={explorerTxUrl(detail.digest)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-caption text-muted-ash transition-colors hover:text-midnight-ink"
        >
          {shortAddr(detail.digest)}
          <ExternalLink className="size-3" strokeWidth={2.2} />
        </a>
      </div>

      {/* Net change */}
      {detail.netChange.length > 0 && (
        <div className="surface-panel mb-3 flex flex-col gap-1 rounded-card px-3 py-2">
          <span className="text-caption uppercase tracking-wider text-muted-ash">
            Net change
          </span>
          <div className="text-body-sm text-midnight-ink">
            <CoinFlow coins={detail.netChange} />
          </div>
        </div>
      )}

      {/* Facts */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Fact label="Sender">
          <span className="font-mono">{shortAddr(detail.sender)}</span>
        </Fact>
        <Fact label="Time">
          <RelativeTime ms={detail.timestampMs} />
        </Fact>
        <Fact label="Gas fee">{fmtAmount(detail.gasFeeSui)} SUI</Fact>
        <Fact label="Commands">{detail.commandCount}</Fact>
        {typeof detail.checkpoint === "number" && (
          <Fact label="Checkpoint">{detail.checkpoint.toLocaleString()}</Fact>
        )}
        <Fact label="Events">{detail.eventCount}</Fact>
      </div>

      {/* Decoded route / activities */}
      {detail.activities.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-3">
          <span className="text-caption uppercase tracking-wider text-muted-ash">
            {detail.activities.length} step
            {detail.activities.length === 1 ? "" : "s"}
          </span>
          <ul className="mt-1.5 space-y-1">
            {detail.activities.map((a, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-center gap-2.5 rounded-card bg-whisper-gray px-3 py-2",
                )}
              >
                <AssetIcon
                  src={a.protocol?.img}
                  label={a.protocol?.name ?? a.activity}
                  size={24}
                />
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-body-sm font-medium text-midnight-ink">
                    {a.activity}
                    {a.protocol?.name ? (
                      <span className="font-normal text-muted-ash">
                        {" "}
                        · {a.protocol.name}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 text-caption text-muted-ash">
                    <CoinFlow coins={a.coins} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
