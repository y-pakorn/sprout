"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, ShieldCheck, AlertTriangle, OctagonX } from "lucide-react";
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
  pass: "Clear",
  flag: "Heads up",
  block: "Blocked",
};

function VerdictBadge({ v }: { v: RiskVerdict }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        v === "pass" && "bg-cash-lime text-midnight-black",
        v === "flag" && "bg-warning text-midnight-black",
        v === "block" && "bg-destructive text-canvas-white",
      )}
      style={{ borderRadius: 9999 }}
    >
      {VERDICT_LABEL[v]}
    </span>
  );
}

function VerdictIcon({ v }: { v: RiskVerdict }) {
  if (v === "pass") {
    return (
      <ShieldCheck
        className="size-3.5 text-midnight-black"
        strokeWidth={2.4}
      />
    );
  }
  if (v === "flag") {
    return (
      <AlertTriangle
        className="size-3.5 text-warning"
        strokeWidth={2.4}
      />
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
    <div className="overflow-hidden">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        className={cn(
          "flex w-full items-center gap-2.5 py-1.5 text-left",
          expandable && "cursor-pointer",
        )}
      >
        <VerdictIcon v={verdict} />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 leading-tight">
          <span className="text-body-sm font-medium text-midnight-black">
            {title}
          </span>
          <span className="truncate text-caption text-subtle-gray">
            {summary}
          </span>
        </div>
        <VerdictBadge v={verdict} />
        {expandable && (
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-subtle-gray transition-transform duration-200",
              open && "rotate-180",
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
            <div className="pb-2.5 pl-6 pr-2 text-body-sm text-subtle-gray">
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
                        <strong className="font-semibold text-midnight-black">
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
                  className="mt-2.5 inline-flex items-center gap-1 bg-canvas-white px-2.5 py-1 text-caption font-medium text-midnight-black transition-colors hover:bg-cash-lime"
                  style={{ borderRadius: 9999 }}
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
