"use client";

import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import { Check, Loader2, Wallet, Radio, Anchor, ExternalLink } from "lucide-react";
import { fadeUp, scaleIn, stagger, SPRING_BOUNCY } from "@/lib/motion";

export type SigningStage = "wallet_pending" | "submitting" | "finalizing";

type StepDef = {
  id: SigningStage;
  label: string;
  detailIdle: string;
  detailActive: string;
  detailDone: string;
  Icon: typeof Wallet;
};

const STEPS: StepDef[] = [
  {
    id: "wallet_pending",
    label: "Sign in your wallet",
    detailIdle: "Waiting to start",
    detailActive: "Open your wallet to review and sign",
    detailDone: "Signed",
    Icon: Wallet,
  },
  {
    id: "submitting",
    label: "Submit to Sui",
    detailIdle: "Will broadcast after signing",
    detailActive: "Broadcasting your transaction…",
    detailDone: "Submitted",
    Icon: Radio,
  },
  {
    id: "finalizing",
    label: "Wait for confirmation",
    detailIdle: "Will finalize onchain",
    detailActive: "Finalizing onchain…",
    detailDone: "Confirmed",
    Icon: Anchor,
  },
];

function stageIndex(stage: SigningStage): number {
  return STEPS.findIndex((s) => s.id === stage);
}

type Props = {
  stage: SigningStage;
  digest?: string;
  gasUsd: number;
  onCancel?: () => void;
};

export function SigningProgress({ stage, digest, gasUsd, onCancel }: Props) {
  const activeIdx = stageIndex(stage);

  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      className="space-y-5 bg-cloud-gray p-6 shadow-[0_18px_60px_-20px_rgba(0,0,0,0.18)]"
      style={{ borderRadius: 24 }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="space-y-1">
          <div className="text-caption font-medium uppercase tracking-wider text-cash-lime">
            {stage === "finalizing"
              ? "Almost there"
              : stage === "submitting"
                ? "Broadcasting"
                : "Awaiting signature"}
          </div>
          <div className="text-body-lg font-semibold leading-tight">
            {stage === "wallet_pending"
              ? "Open your wallet."
              : stage === "submitting"
                ? "Submitting to Sui…"
                : "Waiting for confirmation…"}
          </div>
        </div>
        {stage === "wallet_pending" && onCancel && (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", visualDuration: 0.2, bounce: 0.3 }}
            onClick={onCancel}
            className="bg-canvas-white px-4 py-2 text-body-sm font-medium text-midnight-black"
            style={{ borderRadius: 9999 }}
          >
            Cancel
          </motion.button>
        )}
      </div>

      <motion.div
        variants={stagger(0.05, 0.05)}
        initial="initial"
        animate="animate"
        className="space-y-2"
      >
        {STEPS.map((step, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          const upcoming = i > activeIdx;
          const Icon = step.Icon;
          const detail = done
            ? step.detailDone
            : active
              ? step.detailActive
              : step.detailIdle;

          return (
            <motion.div
              key={step.id}
              variants={fadeUp}
              className="flex items-center gap-3 bg-canvas-white p-4"
              style={{ borderRadius: 18 }}
            >
              <div className="relative inline-flex size-10 shrink-0 items-center justify-center">
                {active && (
                  <motion.span
                    aria-hidden
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={SPRING_BOUNCY}
                    className="absolute inset-0 bg-cash-lime"
                    style={{ borderRadius: 14 }}
                  />
                )}
                <span
                  className={`relative inline-flex size-10 items-center justify-center ${
                    done
                      ? "bg-cash-lime text-midnight-black"
                      : active
                        ? "text-midnight-black"
                        : "bg-cloud-gray text-hinting-gray"
                  }`}
                  style={{ borderRadius: 14 }}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {done ? (
                      <motion.span
                        key="check"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={SPRING_BOUNCY}
                      >
                        <Check className="size-5" strokeWidth={2.6} />
                      </motion.span>
                    ) : active ? (
                      <motion.span
                        key="active"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <Loader2
                          className="size-5 animate-spin"
                          strokeWidth={2.4}
                        />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="idle"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <Icon className="size-5" strokeWidth={2.2} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-body font-semibold leading-tight ${
                    upcoming ? "text-hinting-gray" : "text-midnight-black"
                  }`}
                >
                  {step.label}
                </div>
                <div
                  className={`text-body-sm ${
                    upcoming ? "text-hinting-gray" : "text-subtle-gray"
                  }`}
                >
                  {detail}
                </div>
              </div>
              {step.id === "submitting" && digest && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <Link
                    href={`https://suiscan.xyz/mainnet/tx/${digest}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 bg-cloud-gray px-3 py-1 font-mono text-body-sm text-midnight-black"
                    style={{ borderRadius: 9999 }}
                  >
                    {digest.slice(0, 6)}…{digest.slice(-4)}
                    <ExternalLink className="size-3" />
                  </Link>
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      <div className="flex justify-between text-body-sm text-subtle-gray">
        <span>Atomic PTB · 1 transaction</span>
        <span className="tabular-nums">~${gasUsd.toFixed(3)} gas</span>
      </div>
    </motion.div>
  );
}
