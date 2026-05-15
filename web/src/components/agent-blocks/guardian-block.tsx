"use client";

import { motion } from "motion/react";
import type { GuardianRisk, RiskVerdict } from "@/lib/mock-guardian";
import { ShieldCheck } from "lucide-react";
import { fadeUp, scaleIn, stagger } from "@/lib/motion";

const VERDICT_LABEL: Record<RiskVerdict, string> = {
  pass: "Clear",
  flag: "Heads up",
  block: "Blocked",
};

function verdictPill(v: RiskVerdict) {
  if (v === "pass") return "bg-cash-lime text-midnight-black";
  if (v === "flag") return "bg-warning text-midnight-black";
  return "bg-destructive text-canvas-white";
}

export function GuardianBlock({ risks }: { risks: GuardianRisk[] }) {
  const flagged = risks.filter((r) => r.verdict !== "pass").length;

  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      className="space-y-4 bg-cloud-gray p-6"
      style={{ borderRadius: 24 }}
    >
      <div className="flex items-center gap-2.5">
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", visualDuration: 0.5, bounce: 0.45 }}
          className="inline-flex size-8 items-center justify-center bg-cash-lime text-midnight-black"
          style={{ borderRadius: 14 }}
        >
          <ShieldCheck className="size-4" strokeWidth={2.2} />
        </motion.span>
        <div>
          <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
            Guardian review
          </div>
          <div className="text-body font-semibold leading-tight">
            {flagged === 0
              ? "All clear"
              : `${flagged} need${flagged === 1 ? "s" : ""} attention`}
          </div>
        </div>
      </div>

      <motion.div
        variants={stagger(0.15, 0.05)}
        initial="initial"
        animate="animate"
        className="divide-y divide-ghost-border"
      >
        {risks.map((r) => (
          <motion.div
            key={r.id}
            variants={fadeUp}
            className="flex flex-col gap-2 py-3 first:pt-1 last:pb-1 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex-1 space-y-0.5">
              <div className="text-body font-semibold leading-tight">
                {r.label}
              </div>
              <div className="text-body-sm text-subtle-gray">{r.detail}</div>
            </div>
            <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
              <div className="text-body-sm text-midnight-black">
                {r.summary}
              </div>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 text-caption font-semibold uppercase tracking-wider ${verdictPill(r.verdict)}`}
                style={{ borderRadius: 9999 }}
              >
                {VERDICT_LABEL[r.verdict]}
              </span>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
