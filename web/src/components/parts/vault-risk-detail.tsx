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

export function VerdictIcon({ v }: { v: RiskVerdict }) {
  if (v === "pass") {
    return <Check className="size-3.5 text-deliver-green" strokeWidth={3} />;
  }
  if (v === "flag") {
    return (
      <AlertTriangle className="size-3.5 text-warning" strokeWidth={2.4} />
    );
  }
  return <OctagonX className="size-3.5 text-destructive" strokeWidth={2.4} />;
}

/**
 * Shared markdown body renderer. Used by both the collapsible Guardian row
 * and the inline Block/Flag items in `live-plan-card.tsx` so the markdown
 * styling stays in one place. Pass `className` to override size/color (e.g.
 * the flag row uses a compact muted treatment so the body reads as
 * supplementary commentary rather than headline).
 */
export function RiskMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose-sprout space-y-1.5 text-body-sm text-midnight-ink/85",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="m-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-1 list-disc pl-4">{children}</ul>
          ),
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-medium text-midnight-ink">
              {children}
            </strong>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Compact collapsible Guardian row — used inside the Cleared disclosure.
 * Header: verdict icon + title + summary + chevron. Click to reveal the
 * markdown body in a nested whisper-gray pocket.
 *
 * Block/Flag rows in the Guardian section render via dedicated components
 * in `live-plan-card.tsx`; this collapsible row is only for cleared passes.
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
  const hasBody = !!detail || !!children;

  return (
    <div
      className={cn(
        "overflow-hidden transition-colors",
        verdict === "pass" && "opacity-70 hover:opacity-100",
      )}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        disabled={!hasBody}
        aria-label={`${VERDICT_LABEL[verdict]}: ${title}`}
        className={cn(
          "flex w-full items-center gap-3 py-2 text-left",
          hasBody && "cursor-pointer",
        )}
      >
        <VerdictIcon v={verdict} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-body-sm font-medium text-midnight-ink">
            {title}
          </div>
          <div className="text-caption text-muted-ash">{summary}</div>
        </div>
        {hasBody && (
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-ash transition-transform duration-200",
              open && "rotate-180 text-muted-ash",
            )}
            strokeWidth={2.4}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && hasBody && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mb-2 ml-7 mr-1 rounded-card bg-whisper-gray px-3 py-2.5 ring-1 ring-hairline">
              {detail && <RiskMarkdown>{detail}</RiskMarkdown>}
              {children && <div className="mt-2 space-y-1">{children}</div>}
              {onAskAgent && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAskAgent();
                  }}
                  className="mt-3 inline-flex cursor-pointer items-center gap-1 bg-canvas-white px-2.5 py-1 text-caption font-medium text-midnight-ink ring-1 ring-hairline transition-colors hover:bg-light-taupe rounded-button"
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
