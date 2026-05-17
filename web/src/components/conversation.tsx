"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChatInput } from "@/components/chat-input";
import { ExamplePrompts } from "@/components/example-prompts";
import { ThinkingBlock } from "@/components/agent-blocks/thinking-block";
import { ProposalBlock } from "@/components/agent-blocks/proposal-block";
import { GuardianBlock } from "@/components/agent-blocks/guardian-block";
import { ReceiptBlock } from "@/components/agent-blocks/receipt-block";
import { OverrideDialog } from "@/components/override-dialog";
import { SigningProgress } from "@/components/signing-progress";
import {
  DEFAULT_INTENT,
  DEFAULT_TUNE,
  type IntentInput,
  type TuneState,
} from "@/lib/intent";
import { parseIntent } from "@/lib/parse-intent";
import { buildMockAllocation } from "@/lib/mock-allocation";
import { evaluateGuardian } from "@/lib/mock-guardian";
import { fadeUp, slideInRight, SPRING } from "@/lib/motion";

type Stage =
  | "idle"
  | "thinking"
  | "proposed"
  | "wallet_pending"
  | "submitting"
  | "finalizing"
  | "confirmed";

const IS_SIGNING_STAGE = (s: Stage): s is "wallet_pending" | "submitting" | "finalizing" =>
  s === "wallet_pending" || s === "submitting" || s === "finalizing";

function makeDigest() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 44; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function Conversation() {
  const [stage, setStage] = useState<Stage>("idle");
  const [draft, setDraft] = useState("");
  const [userMessage, setUserMessage] = useState<string>("");
  const [intent, setIntent] = useState<IntentInput>(DEFAULT_INTENT);
  const [tune, setTune] = useState<TuneState>(DEFAULT_TUNE);
  const [digest, setDigest] = useState<string>("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const allocation = useMemo(
    () => (stage !== "idle" ? buildMockAllocation(intent) : null),
    [intent, stage],
  );
  const risks = useMemo(
    () => (allocation ? evaluateGuardian(intent, allocation) : []),
    [intent, allocation],
  );
  const blocking = risks.some((r) => r.verdict === "block");

  useEffect(() => {
    if (stage === "thinking" || stage === "confirmed") {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [stage]);

  function submit(text: string) {
    if (!text.trim()) return;
    setUserMessage(text);
    setIntent(parseIntent(text, DEFAULT_INTENT));
    setDraft("");
    setStage("thinking");
    setTimeout(() => setStage("proposed"), 1400);
  }

  function executeConfirm() {
    setOverrideOpen(false);
    // Stage 1: hand off to wallet (mock — user sees the wallet popup)
    setStage("wallet_pending");
    setTimeout(() => {
      // Stage 2: user signed, broadcasting
      setDigest(makeDigest());
      setStage("submitting");
      setTimeout(() => {
        // Stage 3: tx submitted, waiting for finalization
        setStage("finalizing");
        setTimeout(() => {
          // Done
          setStage("confirmed");
        }, 1000);
      }, 1300);
    }, 1800);
  }

  function cancelSigning() {
    setStage("proposed");
    setDigest("");
  }

  function confirm() {
    if (blocking) {
      setOverrideOpen(true);
      return;
    }
    executeConfirm();
  }

  function reset() {
    setStage("idle");
    setUserMessage("");
    setDraft("");
    setIntent(DEFAULT_INTENT);
    setTune(DEFAULT_TUNE);
    setDigest("");
    setOverrideOpen(false);
  }

  if (stage === "idle") {
    return <IdleHero draft={draft} onDraftChange={setDraft} onSubmit={submit} />;
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8 pb-32">
      <motion.div
        variants={slideInRight}
        initial="initial"
        animate="animate"
        className="flex justify-end"
      >
        <div
          className="max-w-[80%] bg-cloud-gray px-5 py-3 text-body text-midnight-black"
          style={{ borderRadius: 24 }}
        >
          {userMessage}
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {stage === "thinking" && (
          <motion.div
            key="thinking"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <ThinkingBlock />
          </motion.div>
        )}
      </AnimatePresence>

      {(stage === "proposed" || IS_SIGNING_STAGE(stage)) && allocation && (
        <>
          {stage === "proposed" && (
            <>
              <ProposalBlock
                intent={intent}
                allocation={allocation}
                tune={tune}
                onIntentChange={setIntent}
                onTuneChange={setTune}
              />
              <GuardianBlock risks={risks} />
            </>
          )}

          <AnimatePresence>
            {IS_SIGNING_STAGE(stage) && (
              <motion.div
                key="signing"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ ...SPRING }}
              >
                <SigningProgress
                  stage={stage}
                  digest={digest || undefined}
                  gasUsd={allocation.estimatedGasUsd}
                  onCancel={
                    stage === "wallet_pending" ? cancelSigning : undefined
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>

          {stage === "proposed" && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 0.4 }}
            className="sticky bottom-5 z-30"
          >
            <div
              className="flex flex-col gap-3 bg-cloud-gray p-3 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.18)] sm:flex-row sm:items-center sm:justify-between sm:pl-6"
              style={{ borderRadius: 9999 }}
            >
              <div className="text-body-sm sm:pl-2">
                {blocking ? (
                  <span className="text-destructive">
                    <span className="font-semibold">Guardian flagged risk</span> ·
                    sign anyway?
                  </span>
                ) : (
                  <span className="text-subtle-gray">
                    {allocation.legs.length}{" "}
                    {allocation.legs.length === 1 ? "step" : "legs"} · 1 atomic
                    PTB · ~${allocation.estimatedGasUsd.toFixed(3)} gas
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <motion.button
                  onClick={reset}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{
                    type: "spring",
                    visualDuration: 0.2,
                    bounce: 0.3,
                  }}
                  className="bg-canvas-white px-5 py-2.5 text-body-sm font-medium text-midnight-black"
                  style={{ borderRadius: 9999 }}
                >
                  Start over
                </motion.button>
                <motion.button
                  onClick={confirm}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{
                    type: "spring",
                    visualDuration: 0.2,
                    bounce: 0.3,
                  }}
                  className={`px-6 py-2.5 text-body-sm font-semibold ${
                    blocking
                      ? "bg-destructive text-canvas-white"
                      : "bg-cash-lime text-midnight-black"
                  }`}
                  style={{ borderRadius: 9999 }}
                >
                  {blocking ? "Sign anyway →" : "Confirm & sign →"}
                </motion.button>
              </div>
            </div>
          </motion.div>
          )}
        </>
      )}

      {stage === "confirmed" && allocation && digest && (
        <>
          <ReceiptBlock
            digest={digest}
            allocation={allocation}
            asset={intent.asset}
            amount={intent.amount}
          />
          <motion.div
            variants={fadeUp}
            initial="initial"
            animate="animate"
            transition={{ ...SPRING, delay: 0.6 }}
            className="space-y-3 pt-4"
          >
            <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
              What&apos;s next?
            </div>
            <ChatInput
              value={draft}
              onChange={setDraft}
              onSubmit={() => submit(draft)}
              placeholder="Plant another goal…"
            />
          </motion.div>
        </>
      )}

      <div ref={endRef} />

      <OverrideDialog
        open={overrideOpen}
        risks={risks}
        onCancel={() => setOverrideOpen(false)}
        onConfirm={executeConfirm}
      />
    </section>
  );
}

function IdleHero({
  draft,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onSubmit: (text: string) => void;
}) {
  return (
    <section className="bg-canvas-white">
      <div
        className="mx-auto flex w-full max-w-4xl flex-col justify-center gap-8 px-6 py-12"
        style={{ minHeight: "calc(100vh - 56px - 80px)" }}
      >
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", visualDuration: 0.6, bounce: 0.15 }}
          className="display-tight font-semibold leading-[1.0] text-midnight-black"
          style={{ fontSize: "clamp(40px, 6vw, 72px)" }}
        >
          What do you want{" "}
          <span className="whitespace-nowrap">
            <span className="text-shimmer-lime">your money</span> to do?
          </span>
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            visualDuration: 0.6,
            bounce: 0.15,
            delay: 0.2,
          }}
          className="w-full max-w-2xl space-y-4"
        >
          <ChatInput
            value={draft}
            onChange={onDraftChange}
            onSubmit={() => onSubmit(draft)}
            autoFocus
            placeholder="Tell me a goal…"
          />
          <ExamplePrompts onPick={onSubmit} />
        </motion.div>
      </div>
    </section>
  );
}
