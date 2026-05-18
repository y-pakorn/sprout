"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Sparkles } from "lucide-react";

type Props = {
  text: string;
  streaming: boolean;
};

/**
 * Collapsible "Thinking…" block for AI reasoning output.
 * - Opens automatically while streaming.
 * - Auto-collapses ~700ms after streaming ends, so old reasoning blocks
 *   don't dominate the scroll once the answer has landed.
 * - User can re-expand any time.
 */
export function ThinkingTrail({ text, streaming }: Props) {
  const [open, setOpen] = useState(true);
  // Track whether the user has manually toggled — if so, respect their pref
  const userOverrode = useRef(false);
  const wasStreaming = useRef(streaming);

  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      // Just finished streaming — auto-collapse if user hasn't intervened
      if (!userOverrode.current) {
        const t = setTimeout(() => setOpen(false), 700);
        return () => clearTimeout(t);
      }
    }
    wasStreaming.current = streaming;
  }, [streaming]);

  function toggle() {
    userOverrode.current = true;
    setOpen((v) => !v);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-1.5"
    >
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-2 liquid-glass pl-2 pr-3 py-1 text-caption font-medium uppercase tracking-wider text-canvas-white/55 transition-opacity hover:opacity-70"
        style={{ borderRadius: 9999 }}
      >
        {streaming ? (
          <motion.span
            animate={{ scale: [1, 1.35, 1] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="inline-block size-1.5 bg-cash-lime"
            style={{ borderRadius: 9999 }}
          />
        ) : (
          <Sparkles className="size-3 text-cash-lime" strokeWidth={2.4} />
        )}
        {streaming ? "Thinking…" : "Reasoning"}
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", visualDuration: 0.2, bounce: 0.3 }}
          className="inline-flex"
        >
          <ChevronDown className="size-3" strokeWidth={2.4} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <pre className="whitespace-pre-wrap break-words border-l-2 border-cash-lime/40 liquid-glass/50 px-4 py-3 font-mono text-body-sm leading-relaxed text-canvas-white/55">
              {text || (streaming ? "…" : "")}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
