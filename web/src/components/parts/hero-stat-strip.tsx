"use client";

import { Fragment } from "react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { Vault, Network, Coins } from "lucide-react";
import { useVaults } from "@/lib/client-vaults";
import { useCoinMap } from "@/lib/client-coins";
import { fmtUsdShort } from "@/lib/format";
import { DEX_SOURCES } from "@/lib/seven-k";

type Item = {
  /** Short value token. null = still loading → shimmer. */
  value: string | null;
  label: string;
  /** The genuinely-live metric — gets a pulsing "live" dot instead of an icon. */
  live?: boolean;
  Icon?: LucideIcon;
};

/**
 * Live ecosystem proof bar under the hero input — every value is real and
 * mostly live: top vault APY + total vault TVL (from the vault list), the
 * number of DEX venues Sprout routes through (the 7K source list), and the
 * count of supported tokens (the coin map). It reads as "Sprout plugs into the
 * whole live Sui DeFi ecosystem." Sits in a translucent bar so it stays
 * legible over the hero's green gradient wash. Values shimmer until loaded.
 */
export function HeroStatStrip() {
  const vaults = useVaults();
  const coinMap = useCoinMap();

  const apys =
    vaults?.map((v) => v.apyPct).filter((n) => Number.isFinite(n)) ?? [];
  const topApy = apys.length ? Math.max(...apys) : null;

  const tvl =
    vaults && vaults.length
      ? vaults.reduce((s, v) => s + (Number.isFinite(v.tvlUsd) ? v.tvlUsd : 0), 0)
      : null;

  const tokenCount = coinMap ? Object.keys(coinMap).length : null;

  const items: Item[] = [
    {
      value: topApy != null ? `${topApy.toFixed(1)}%` : null,
      label: "top vault APY",
      live: true,
    },
    {
      value: tvl != null ? fmtUsdShort(tvl) : null,
      label: "vault TVL",
      Icon: Vault,
    },
    { value: `${DEX_SOURCES.length}+`, label: "DEXs", Icon: Network },
    {
      value:
        tokenCount != null
          ? `${Math.max(10, Math.floor(tokenCount / 10) * 10)}+`
          : null,
      label: "tokens",
      Icon: Coins,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.6, bounce: 0.1, delay: 0.55 }}
      className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-card border border-hairline bg-canvas-white/70 px-4 py-2 text-caption shadow-button backdrop-blur-sm"
    >
      {items.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 && (
            <span
              aria-hidden
              className="hidden h-3 w-px shrink-0 self-center bg-midnight-ink/10 sm:block"
            />
          )}
          <span className="inline-flex items-center gap-1.5">
            {s.live ? (
              <span
                className="size-1.5 shrink-0 self-center rounded-full bg-deliver-green motion-safe:animate-pulse"
                aria-hidden
              />
            ) : s.Icon ? (
              <s.Icon
                className="size-3.5 shrink-0 self-center text-muted-ash"
                strokeWidth={2.2}
                aria-hidden
              />
            ) : null}
            {s.value === null ? (
              <span
                className="inline-block h-3 w-10 self-center rounded bg-midnight-ink/10 motion-safe:animate-pulse"
                aria-hidden
              />
            ) : (
              <span className="font-medium tabular-nums text-midnight-ink">
                {s.value}
              </span>
            )}
            <span className="text-muted-ash">{s.label}</span>
          </span>
        </Fragment>
      ))}
    </motion.div>
  );
}
