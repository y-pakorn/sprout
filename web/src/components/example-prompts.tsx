"use client";

import { motion } from "motion/react";
import { EXAMPLE_PROMPTS } from "@/lib/parse-intent";
import { fadeUp, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Props = {
  onPick: (text: string) => void;
  /** "default" = light pill on white bg; "glass" = translucent on dark/video bg. */
  tone?: "default" | "glass";
};

export function ExamplePrompts({ onPick, tone = "default" }: Props) {
  return (
    <motion.div
      variants={stagger(0.3, 0.05)}
      initial="initial"
      animate="animate"
      className="flex flex-wrap justify-center gap-2"
    >
      {EXAMPLE_PROMPTS.map((p) => (
        <motion.button
          key={p.label}
          variants={fadeUp}
          whileHover={{ scale: 1.05, y: -1 }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: "spring", visualDuration: 0.2, bounce: 0.3 }}
          type="button"
          onClick={() => onPick(p.text)}
          className={cn(
            "px-4 py-2 text-body-sm font-medium transition-colors",
            tone === "default" &&
              "bg-cloud-gray text-midnight-black",
            tone === "glass" &&
              "liquid-glass text-canvas-white/90 hover:text-canvas-white",
          )}
          style={{ borderRadius: 9999 }}
        >
          {p.label}
        </motion.button>
      ))}
    </motion.div>
  );
}
