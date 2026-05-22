"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Check, AlertTriangle, OctagonX } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export type RiskVerdict = "pass" | "flag" | "block";

type Props = {
  /** Short label shown in the row header (e.g. "Strategy risk") */
  title: string;
  /** One-line summary shown next to the title when collapsed */
  summary: string;
  verdict: RiskVerdict;
  /** Expanded body — markdown rendered. Optional; row stays non-expandable when absent. */
  detail?: string;
  /** Optional callout to ask Sprout for a deeper explanation (re-triggers a message). */
  onAskAgent?: () => void;
  /** Force the row open on first mount (e.g. for the highest-severity row). */
  defaultOpen?: boolean;
  /** Children render below the markdown body — for vault-specific numbers etc. */
  children?: ReactNode;
};

const VERDICT_LABEL: Record<RiskVerdict, string> = {
  pass: "Cleared",
  flag: "Heads up",
  block: "Blocked",
};

function VerdictIcon({ v }: { v: RiskVerdict }) {
  if (v === "pass") {
    return (
      <Check className="size-3.5 text-cash-lime" strokeWidth={3} />
    );
  }
  if (v === "flag") {
    return (
      <AlertTriangle className="size-3.5 text-warning" strokeWidth={2.4} />
    );
  }
  return (
    <OctagonX className="size-3.5 text-destructive" strokeWidth={2.4} />
  );
}

/**
 * Single Guardian risk row. Header has icon + title + summary + verdict
 * pill + chevron. Expanding reveals the markdown detail body and any
 * children (numbers specific to this deposit).
 */
export function VaultRiskDetail({
  title,
  summary,
  verdict,
  detail,
  onAskAgent,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = !!detail || !!children;

  return (
    <div
      className={cn(
        "overflow-hidden transition-colors",
        verdict === "pass" && "opacity-55 hover:opacity-80",
      )}
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        aria-label={`${VERDICT_LABEL[verdict]}: ${title}`}
        className={cn(
          "flex w-full items-center gap-3 py-2.5 text-left",
          expandable && "cursor-pointer",
        )}
      >
        <VerdictIcon v={verdict} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-body-sm font-medium text-canvas-white">
            {title}
          </div>
          <div className="truncate text-caption text-canvas-white/55">
            {summary}
          </div>
        </div>
        {expandable && (
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-canvas-white/40 transition-transform duration-200",
              open && "rotate-180 text-canvas-white/70",
            )}
            strokeWidth={2.4}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && expandable && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mb-2 ml-7 mr-1 rounded-[10px] bg-white/[0.04] px-3 py-2.5 text-body-sm text-canvas-white/70 ring-1 ring-white/[0.06]">
              {detail && (
                <div className="prose-sprout space-y-2">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="m-0">{children}</p>,
                      ul: ({ children }) => (
                        <ul className="my-1.5 list-disc pl-4">{children}</ul>
                      ),
                      li: ({ children }) => (
                        <li className="my-0.5">{children}</li>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-semibold text-canvas-white">
                          {children}
                        </strong>
                      ),
                    }}
                  >
                    {detail}
                  </ReactMarkdown>
                </div>
              )}
              {children && (
                <div className="mt-2 space-y-1">{children}</div>
              )}
              {onAskAgent && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAskAgent();
                  }}
                  className="mt-3 inline-flex items-center gap-1 rounded-pill bg-white/[0.10] px-2.5 py-1 text-caption font-medium text-canvas-white ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.16]"
                >
                  Ask Sprout to explain →
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
