"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import type { GuardianRisk } from "@/lib/mock-guardian";

type Props = {
  open: boolean;
  risks: GuardianRisk[];
  onCancel: () => void;
  onConfirm: () => void;
};

export function OverrideDialog({ open, risks, onCancel, onConfirm }: Props) {
  const blocking = risks.filter((r) => r.verdict === "block");
  const flagging = risks.filter((r) => r.verdict === "flag");
  const issues = [...blocking, ...flagging];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onCancel}
            className="fixed inset-0 z-50 bg-midnight-black/30 backdrop-blur-sm"
          />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: "spring", visualDuration: 0.35, bounce: 0.2 }}
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 bg-canvas-white p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)]"
            style={{ borderRadius: 24 }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className="inline-flex size-9 items-center justify-center bg-destructive text-canvas-white"
                  style={{ borderRadius: 14 }}
                >
                  <AlertTriangle className="size-5" strokeWidth={2.2} />
                </span>
                <div>
                  <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
                    Heads up
                  </div>
                  <div className="text-body-lg font-semibold leading-tight">
                    Sign anyway?
                  </div>
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={onCancel}
                aria-label="Cancel"
                className="inline-flex size-8 items-center justify-center bg-cloud-gray text-midnight-black"
                style={{ borderRadius: 9999 }}
              >
                <X className="size-4" strokeWidth={2.4} />
              </motion.button>
            </div>

            <p className="mt-4 text-body text-subtle-gray">
              The guardian flagged{" "}
              <span className="font-semibold text-midnight-black">
                {issues.length} issue{issues.length === 1 ? "" : "s"}
              </span>{" "}
              with this plan. You can still sign — but you&apos;ll be doing so
              against the recommendation.
            </p>

            <div
              className="mt-4 space-y-2 bg-cloud-gray p-4"
              style={{ borderRadius: 18 }}
            >
              {issues.map((r) => (
                <div key={r.id} className="flex items-start gap-2.5">
                  <span
                    className={`mt-1.5 inline-block size-1.5 shrink-0 ${
                      r.verdict === "block"
                        ? "bg-destructive"
                        : "bg-warning"
                    }`}
                    style={{ borderRadius: 9999 }}
                  />
                  <div className="min-w-0">
                    <div className="text-body-sm font-semibold leading-tight">
                      {r.label}
                    </div>
                    <div className="text-body-sm text-subtle-gray">
                      {r.summary}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", visualDuration: 0.2, bounce: 0.3 }}
                onClick={onCancel}
                className="bg-cloud-gray px-5 py-2.5 text-body-sm font-medium text-midnight-black"
                style={{ borderRadius: 9999 }}
              >
                Go back & adjust
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", visualDuration: 0.2, bounce: 0.3 }}
                onClick={onConfirm}
                className="bg-destructive px-5 py-2.5 text-body-sm font-semibold text-canvas-white"
                style={{ borderRadius: 9999 }}
              >
                Yes, sign anyway →
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
