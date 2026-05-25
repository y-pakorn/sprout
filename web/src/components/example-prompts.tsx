"use client";

import { motion } from "motion/react";
import { EXAMPLE_PROMPTS } from "@/lib/parse-intent";
import { fadeUp, stagger } from "@/lib/motion";

type Props = {
  onPick: (text: string) => void;
};

export function ExamplePrompts({ onPick }: Props) {
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
          className="bg-canvas-white px-4 py-2 text-body-sm font-medium text-midnight-ink shadow-button ring-1 ring-hairline transition-colors hover:bg-whisper-gray rounded-button"
        >
          {p.label}
        </motion.button>
      ))}
    </motion.div>
  );
}
