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

/**
 * Full-viewport video background with subtle mouse parallax + vignette.
 * Used by the idle hero. Respects prefers-reduced-motion.
 */
export function HeroVideoBg() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reducedMotion = useReducedMotion();

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, { stiffness: 50, damping: 20, mass: 0.6 });
  const y = useSpring(rawY, { stiffness: 50, damping: 20, mass: 0.6 });

  useEffect(() => {
    if (reducedMotion) return;
    function onMove(e: MouseEvent) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      rawX.set(((e.clientX - cx) / cx) * 20);
      rawY.set(((e.clientY - cy) / cy) * 20);
    }
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [rawX, rawY, reducedMotion]);

  // Speed the playback up slightly — clouds and grass drift more cinematically.
  // Some browsers reset playbackRate after metadata, so re-apply on canplay too.
  function bumpRate() {
    const v = videoRef.current;
    if (v) v.playbackRate = 1.25;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-midnight-black">
      <motion.div
        style={{ x, y }}
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
      {/* Top scrim — gives the header weight and the headline a frame. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[40vh]"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,16,12,0.55) 0%, rgba(8,16,12,0.18) 60%, rgba(0,0,0,0) 100%)",
        }}
      />
      {/* Bottom scrim — anchors the chat input + chips against the busy grass. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[55vh]"
        style={{
          background:
            "linear-gradient(0deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0) 100%)",
        }}
      />
    </div>
  );
}
