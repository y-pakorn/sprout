"use client";

import { useEffect, useRef } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  useReducedMotion,
  animate,
} from "motion/react";
import { useSuiNetworkStatus } from "@/lib/use-sui-network-status";
import { cn } from "@/lib/utils";

/**
 * Hero "Sui Mainnet" badge — a genuinely live signal, not decor. A gRPC
 * checkpoint subscription streams the height in real time (see
 * useSuiNetworkStatus) and the number is tweened upward so it visibly climbs;
 * the dot pulses to read as live. Layout: [Sui logo] Sui Mainnet | ● 1,284,902
 * (epoch in the title tooltip).
 */
export function LiveMainnetBadge({ className }: { className?: string }) {
  const { checkpoint, epoch, ready, failed } = useSuiNetworkStatus();
  const reduce = useReducedMotion();

  // Count-up: a motion value tweened from the previous height to the next.
  // Stream updates land several times a second, so the tween is short — it
  // reads as a continuous climb rather than discrete jumps.
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => Math.round(v).toLocaleString("en-US"));
  const seeded = useRef(false);

  useEffect(() => {
    if (checkpoint == null) return;
    // First real value seeds directly — no giant sweep up from zero.
    if (!seeded.current || reduce) {
      mv.set(checkpoint);
      seeded.current = true;
      return;
    }
    const controls = animate(mv, checkpoint, {
      duration: 0.5,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [checkpoint, mv, reduce]);

  // Permanent failure → quiet static badge (logo + label). Never surface an
  // error in the hero.
  const showLive = !(failed && !ready);

  return (
    <div
      title={epoch != null ? `Epoch ${epoch}` : undefined}
      className={cn(
        "inline-flex cursor-default items-center gap-2.5 rounded-md border border-hairline bg-canvas-white/80 py-1.5 pl-2.5 pr-3.5 shadow-button backdrop-blur-sm",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sui-logo.png"
          alt="Sui"
          className="size-4 shrink-0 object-contain"
        />
        <span className="text-body-sm font-medium leading-none text-midnight-ink">
          Sui Mainnet
        </span>
      </span>

      {showLive && (
        <>
          <span className="h-3.5 w-px shrink-0 bg-midnight-ink/10" aria-hidden />
          <span className="inline-flex items-center gap-1.5">
            <span className="relative flex size-1.5 shrink-0" aria-hidden>
              <span className="absolute inline-flex size-full rounded-full bg-deliver-green/60 motion-safe:animate-ping" />
              <span className="relative inline-flex size-1.5 rounded-full bg-deliver-green" />
            </span>
            {ready ? (
              <motion.span className="font-mono text-[13px] leading-none tabular-nums text-midnight-ink">
                {display}
              </motion.span>
            ) : (
              <span
                className="inline-block h-3.5 w-16 rounded bg-midnight-ink/10 motion-safe:animate-pulse"
                aria-hidden
              />
            )}
          </span>
        </>
      )}
    </div>
  );
}
