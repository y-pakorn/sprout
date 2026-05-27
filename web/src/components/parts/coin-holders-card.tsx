"use client";

import { motion } from "motion/react";
import { AssetIcon } from "@/components/asset-icon";
import { Identicon } from "@/components/ui/identicon";
import { fmtUsdShort, fmtCompact, fmtPct } from "@/lib/format";
import { shortAddr } from "@/lib/avatar";
import type { CoinHolder } from "@/lib/blockberry-coins";

export function CoinHoldersCard({
  items,
  symbol,
}: {
  items: CoinHolder[];
  symbol: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className="surface-card max-w-[640px] overflow-hidden rounded-card p-2"
    >
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
          Top {symbol} holders
        </span>
        <span className="text-caption text-muted-ash tabular-nums">
          {items.length}
        </span>
      </div>
      <ul>
        {items.map((h, i) => (
          <li
            key={`${h.address}:${i}`}
            className="flex items-center gap-2.5 border-b border-hairline px-2 py-2 last:border-b-0"
          >
            <span className="w-4 shrink-0 text-right text-caption tabular-nums text-muted-ash">
              {i + 1}
            </span>
            {h.imgUrl ? (
              <AssetIcon src={h.imgUrl} label={h.name ?? h.symbol} size={32} />
            ) : (
              <Identicon address={h.address} size={32} />
            )}
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span
                className={
                  h.name
                    ? "truncate text-body-sm font-medium text-midnight-ink"
                    : "truncate font-mono text-body-sm font-medium text-midnight-ink"
                }
              >
                {h.name ?? shortAddr(h.address)}
              </span>
              <span className="truncate text-caption tabular-nums text-muted-ash">
                {fmtCompact(h.amount)} {h.symbol}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end leading-tight">
              {typeof h.percentage === "number" && (
                <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
                  {fmtPct(h.percentage)}
                </span>
              )}
              {typeof h.usdAmount === "number" && h.usdAmount > 0 && (
                <span className="text-caption tabular-nums text-muted-ash">
                  {fmtUsdShort(h.usdAmount)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
