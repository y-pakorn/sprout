"use client";

import { useEffect, useRef } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260331_074327_a4d6275d-82d9-4c83-bfbe-f1fb2213c17c.mp4";

type Mode = "bright" | "dim";

type Props = {
  /** "bright" = full-color landing hero (only used on `/` idle).
   *  "dim"    = blurred + darkened for in-app surfaces (chat, portfolio). */
  mode?: Mode;
};

const TRANSITION = { type: "tween", duration: 0.9, ease: "easeInOut" } as const;

/**
 * Full-viewport video background with mouse parallax + scrims.
 * Two modes (smoothly crossfade between them via motion):
 *   - bright: full color, light scrims, ±20px parallax (landing).
 *   - dim:    blur + brightness filter + dark overlay so cards read clean.
 * Mounted ONCE at the root so the video and parallax persist across
 * page/state transitions. Respects prefers-reduced-motion.
 */
export function HeroVideoBg({ mode = "bright" }: Props = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reducedMotion = useReducedMotion();
  const isDim = mode === "dim";
  const PARALLAX = isDim ? 12 : 20;

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, { stiffness: 50, damping: 20, mass: 0.6 });
  const y = useSpring(rawY, { stiffness: 50, damping: 20, mass: 0.6 });

  useEffect(() => {
    if (reducedMotion) return;
    function onMove(e: MouseEvent) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      rawX.set(((e.clientX - cx) / cx) * PARALLAX);
      rawY.set(((e.clientY - cy) / cy) * PARALLAX);
    }
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [rawX, rawY, reducedMotion, PARALLAX]);

  function bumpRate() {
    const v = videoRef.current;
    if (v) v.playbackRate = 1.25;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-midnight-black">
      <motion.div
        style={{ x, y }}
        animate={{
          filter: isDim
            ? "blur(4px) brightness(0.85) saturate(120%)"
            : "blur(0px) brightness(1) saturate(100%)",
        }}
        transition={TRANSITION}
        className="absolute inset-0 origin-center scale-[1.08]"
      >
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          autoPlay
          muted
          loop
          playsInline
          onLoadedMetadata={bumpRate}
          onCanPlay={bumpRate}
          className="size-full object-cover"
        />
      </motion.div>

      {/* Dim overlay — animated opacity so it crossfades on mode change. */}
      <motion.div
        aria-hidden
        className="absolute inset-0"
        animate={{ opacity: isDim ? 1 : 0 }}
        transition={TRANSITION}
        style={{ background: "rgba(8,12,16,0.28)" }}
      />

      {/* Top scrim — anchors the header. Slightly stronger when dim. */}
      <motion.div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[40vh]"
        animate={{
          background: isDim
            ? "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.18) 60%, rgba(0,0,0,0) 100%)"
            : "linear-gradient(180deg, rgba(8,16,12,0.55) 0%, rgba(8,16,12,0.18) 60%, rgba(0,0,0,0) 100%)",
        }}
        transition={TRANSITION}
      />

      {/* Bottom scrim — strong on bright (anchors chat input), faint on dim. */}
      <motion.div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[55vh]"
        animate={{
          opacity: isDim ? 0 : 1,
        }}
        transition={TRANSITION}
        style={{
          background:
            "linear-gradient(0deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0) 100%)",
        }}
      />
    </div>
  );
}
