"use client";

import { motion } from "motion/react";
import { BadgeCheck } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { fmtPriceUsd, fmtUsdShort, fmtCompact } from "@/lib/format";
import type { CoinListItem } from "@/lib/blockberry-coins";

const SORT_LABEL: Record<string, string> = {
  MARKET_CAP: "Top coins by market cap",
  HOLDERS: "Top coins by holders",
  AGE: "Newest coins",
  NAME: "Coins A–Z",
  SEARCH: "Token matches",
};

export function CoinListCard({
  items,
  sortBy,
}: {
  items: CoinListItem[];
  sortBy: string;
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
          {SORT_LABEL[sortBy] ?? "Coins"}
        </span>
        <span className="text-caption text-muted-ash tabular-nums">
          {items.length}
        </span>
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {items.map((c, i) => (
          <li
            key={c.coinType}
            className="flex items-center gap-2.5 border-b border-hairline px-2 py-2 last:border-b-0"
          >
            <span className="w-4 shrink-0 text-right text-caption tabular-nums text-muted-ash">
              {i + 1}
            </span>
            <AssetIcon src={c.imgUrl} label={c.symbol} size={32} />
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-body-sm font-medium text-midnight-ink">
                  {c.name}
                </span>
                <span className="shrink-0 bg-midnight-ink/[0.06] px-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-ash rounded-[6px]">
                  {c.symbol}
                </span>
                {c.isVerified && (
                  <BadgeCheck
                    className="size-3.5 shrink-0 text-deliver-green"
                    strokeWidth={2.2}
                  />
                )}
              </div>
              <span className="truncate text-caption tabular-nums text-muted-ash">
                {typeof c.holdersCount === "number"
                  ? `${fmtCompact(c.holdersCount)} holders`
                  : ""}
                {typeof c.volume === "number" && c.volume > 0
                  ? `${typeof c.holdersCount === "number" ? " · " : ""}${fmtUsdShort(c.volume)} vol`
                  : ""}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end leading-tight">
              {typeof c.price === "number" && c.price > 0 && (
                <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
                  {fmtPriceUsd(c.price)}
                </span>
              )}
              {typeof c.marketCap === "number" && c.marketCap > 0 && (
                <span className="text-caption tabular-nums text-muted-ash">
                  {fmtUsdShort(c.marketCap)} mcap
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
