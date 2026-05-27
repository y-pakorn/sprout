"use client";

import { motion } from "motion/react";
import { useVaults } from "@/lib/client-vaults";
import { cn } from "@/lib/utils";

type Stat = {
  /** Rendered value; null = still loading (shows a shimmer placeholder). */
  value: string | null;
  label: string;
  /** Live data point — gets a pulsing "live" dot. */
  live?: boolean;
  /** Feature fact (no number, always available). */
  fact?: boolean;
};

/**
 * A thin proof bar under the hero input: live, Sui-native numbers we already
 * fetch (top vault APY, vault count) alongside two capability facts (DEX
 * aggregation, gasless sends). Numbers shimmer until the vault list loads;
 * facts render immediately, so the strip degrades gracefully offline.
 */
export function HeroStatStrip() {
  const vaults = useVaults();
  const apys = vaults?.map((v) => v.apyPct).filter((n) => Number.isFinite(n)) ?? [];
  const topApy = apys.length ? Math.max(...apys) : null;
  const count = vaults?.length ?? null;

  const stats: Stat[] = [
    {
      value: topApy != null ? `${topApy.toFixed(1)}%` : null,
      label: "top vault APY",
      live: true,
    },
    { value: count != null ? String(count) : null, label: "Sui vaults" },
    { value: "Best route", label: "across Sui DEXs", fact: true },
    { value: "Gasless", label: "stablecoin sends", fact: true },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.6, bounce: 0.1, delay: 0.55 }}
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-caption"
    >
      {stats.map((s, i) => (
        <div key={s.label} className="flex items-center gap-4">
          {i > 0 && <span className="h-3 w-px bg-hairline" aria-hidden />}
          <span className="inline-flex items-center gap-1.5">
            {s.live && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-deliver-green motion-safe:animate-pulse"
                aria-hidden
              />
            )}
            {s.value === null ? (
              <span
                className="inline-block h-3 w-9 rounded bg-midnight-ink/10 motion-safe:animate-pulse"
                aria-hidden
              />
            ) : (
              <span
                className={cn(
                  "font-medium text-midnight-ink",
                  !s.fact && "tabular-nums",
                )}
              >
                {s.value}
              </span>
            )}
            <span className="text-muted-ash">{s.label}</span>
          </span>
        </div>
      ))}
    </motion.div>
  );
}
