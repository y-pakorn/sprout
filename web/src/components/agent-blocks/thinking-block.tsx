"use client";

import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";

const STEPS = [
  "Reading your intent…",
  "Pricing 7K aggregator routes…",
  "Surveying lending markets…",
  "Checking Ember vaults…",
  "Running the guardian…",
];

export function ThinkingBlock() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setI((prev) => Math.min(prev + 1, STEPS.length - 1));
    }, 280);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", visualDuration: 0.4, bounce: 0.3 }}
      className="inline-flex items-center gap-3 bg-cloud-gray px-5 py-3 text-body text-midnight-black"
      style={{ borderRadius: 9999 }}
    >
      <motion.span
        animate={{ scale: [1, 1.4, 1] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        className="inline-block size-2 bg-cash-lime"
        style={{ borderRadius: 9999 }}
      />
      <AnimatePresence mode="wait">
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {STEPS[i]}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}
