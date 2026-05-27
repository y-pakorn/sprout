"use client";

import { motion } from "motion/react";
import { useVaults } from "@/lib/client-vaults";

type Stat = {
  /** Short value token (number, $0, 1-tx). null = still loading → shimmer. */
  value: string | null;
  label: string;
  /** Live data point — gets a pulsing "live" dot. */
  live?: boolean;
};

/**
 * A thin proof bar under the hero input: one live Sui-native number we already
 * fetch (top vault APY) plus three capability stats — the gasless stablecoin
 * transfer, Enoki-sponsored gas (Sprout pays the gas), and the atomic
 * swap+deposit PTB. Every item reads as value + label for a consistent,
 * restrained row. The APY shimmers until the vault list loads.
 */
export function HeroStatStrip() {
  const vaults = useVaults();
  const apys = vaults?.map((v) => v.apyPct).filter((n) => Number.isFinite(n)) ?? [];
  const topApy = apys.length ? Math.max(...apys) : null;

  const stats: Stat[] = [
    {
      value: topApy != null ? `${topApy.toFixed(1)}%` : null,
      label: "top vault APY",
      live: true,
    },
    { value: "$0", label: "gasless sends" },
    { value: "$0", label: "gas, sponsored by Sprout" },
    { value: "1-tx", label: "swap + deposit" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.6, bounce: 0.1, delay: 0.55 }}
      className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-caption"
    >
      {stats.map((s) => (
        <span key={s.label} className="inline-flex items-baseline gap-1.5">
          {s.live && (
            <span
              className="mb-px size-1.5 shrink-0 self-center rounded-full bg-deliver-green motion-safe:animate-pulse"
              aria-hidden
            />
          )}
          {s.value === null ? (
            <span
              className="inline-block h-3 w-9 self-center rounded bg-midnight-ink/10 motion-safe:animate-pulse"
              aria-hidden
            />
          ) : (
            <span className="font-medium tabular-nums text-midnight-ink">
              {s.value}
            </span>
          )}
          <span className="text-muted-ash">{s.label}</span>
        </span>
      ))}
    </motion.div>
  );
}
