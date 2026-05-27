"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@base-ui/react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Transaction } from "@mysten/sui/transactions";
import { decodePtb, buildPtbContext } from "@/lib/ptb-view";
import { explainPtb, explainPtbCommand, type PtbExplainSummary } from "@/lib/ptb-explain";
import { PtbFlowViewer } from "@/components/parts/ptb-flow-viewer";
import { cn } from "@/lib/utils";
import type { ResolvedStep } from "@/lib/ai/action-plan-cache";

/** True at the `sm` breakpoint and up — drives bottom-sheet vs centered-modal
 *  entry animation. SSR-safe: defaults to mobile until mounted. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tx: Transaction;
  /** Verified plan steps — power vault labels + ground the on-demand AI. */
  steps?: ResolvedStep[];
};

export function PtbDialog({ open, onOpenChange, tx, steps }: Props) {
  const view = useMemo(
    () => decodePtb(tx, buildPtbContext(steps)),
    [tx, steps],
  );
  const isDesktop = useIsDesktop();

  const [aiSummary, setAiSummary] = useState<PtbExplainSummary | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiByCommand, setAiByCommand] = useState<Record<number, string>>({});
  const [explainingCommand, setExplainingCommand] = useState<number | null>(null);

  async function handleSummarize() {
    if (summarizing) return;
    setSummarizing(true);
    setAiError(null);
    try {
      const result = await explainPtb(view, steps);
      setAiSummary(result);
      // Fold per-command one-liners into the per-command map so each row fills
      // in without a second click.
      setAiByCommand((prev) => {
        const next = { ...prev };
        for (const c of result.commands) {
          if (typeof c.index === "number" && c.plain) next[c.index] = c.plain;
        }
        return next;
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Explanation failed.");
    } finally {
      setSummarizing(false);
    }
  }

  async function handleExplainCommand(index: number) {
    if (explainingCommand !== null) return;
    setExplainingCommand(index);
    setAiError(null);
    try {
      const text = await explainPtbCommand(view, index, steps);
      setAiByCommand((prev) => ({ ...prev, [index]: text }));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Explanation failed.");
    } finally {
      setExplainingCommand(null);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop
              render={
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-40 bg-midnight-ink/30 backdrop-blur-sm"
                />
              }
            />
            <Dialog.Popup
              render={
                <motion.div
                  initial={
                    isDesktop
                      ? { opacity: 0, y: 12, scale: 0.98 }
                      : { opacity: 0, y: "100%" }
                  }
                  animate={
                    isDesktop ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1, y: 0 }
                  }
                  exit={
                    isDesktop
                      ? { opacity: 0, y: 6, scale: 0.98 }
                      : { opacity: 0, y: "100%" }
                  }
                  transition={{ type: "spring", visualDuration: 0.28, bounce: 0.12 }}
                  className={cn(
                    "fixed inset-x-0 bottom-0 top-auto z-50 flex h-[92dvh] w-full max-w-none flex-col overflow-hidden bg-canvas-white shadow-header rounded-t-card rounded-b-none",
                    "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:h-[86vh] sm:w-[96vw] sm:max-w-6xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card",
                  )}
                />
              }
            >
              {/* Mobile grab handle */}
              <span className="mx-auto mt-2 h-1 w-9 shrink-0 bg-hairline rounded-full sm:hidden" />
              <div className="flex items-start gap-3 border-b border-hairline/60 px-5 pb-3.5 pt-3.5 sm:pt-5">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="text-body-lg font-medium leading-tight text-midnight-ink">
                    Transaction block
                  </Dialog.Title>
                  <Dialog.Description className="mt-0.5 text-caption text-muted-ash">
                    The exact Programmable Transaction Block your wallet will sign — every input,
                    command, and how they connect.
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  render={
                    <button
                      type="button"
                      aria-label="Close"
                      className="inline-flex size-7 shrink-0 items-center justify-center text-muted-ash transition-colors hover:bg-whisper-gray hover:text-midnight-ink rounded-full"
                    >
                      <X className="size-4" strokeWidth={2.4} />
                    </button>
                  }
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
                <PtbFlowViewer
                  view={view}
                  aiSummary={aiSummary}
                  summarizing={summarizing}
                  aiError={aiError}
                  onSummarize={handleSummarize}
                  aiByCommand={aiByCommand}
                  explainingCommand={explainingCommand}
                  onExplainCommand={handleExplainCommand}
                />
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
