"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronDown,
  Copy,
  Check,
  Sparkles,
  Box,
  Split,
  Combine,
  Send,
  Layers,
  Loader2,
  ArrowRight,
  CornerDownRight,
} from "lucide-react";
import { Tag } from "@/components/ui/tag";
import { StatusDisk } from "@/components/ui/status-disk";
import { PillButton } from "@/components/ui/pill-button";
import { PtbGraph } from "@/components/parts/ptb-graph";
import { cn } from "@/lib/utils";
import { fmtAddress } from "@/lib/format";
import type {
  PtbView,
  PtbCommand,
  PtbInput,
  PtbArgRef,
  PtbArg,
  PtbCommandKind,
} from "@/lib/ptb-view";
import type { PtbExplainSummary } from "@/lib/ptb-explain";

const EXPAND = { duration: 0.18, ease: "easeOut" as const };

type Props = {
  view: PtbView;
  aiSummary?: PtbExplainSummary | null;
  summarizing?: boolean;
  aiError?: string | null;
  onSummarize?: () => void;
  aiByCommand?: Record<number, string>;
  explainingCommand?: number | null;
  onExplainCommand?: (index: number) => void;
};

export function PtbFlowViewer({
  view,
  aiSummary,
  summarizing,
  aiError,
  onSummarize,
  aiByCommand,
  explainingCommand,
  onExplainCommand,
}: Props) {
  // Default the inspector to the final command — the transaction's outcome.
  const [selected, setSelected] = useState<number>(
    Math.max(0, view.commands.length - 1),
  );
  const selectedCmd = view.commands[selected];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Top strip — pinned. */}
      <div className="shrink-0 space-y-3">
        <AiSummaryBanner
          summary={aiSummary}
          summarizing={summarizing}
          error={aiError}
          onSummarize={onSummarize}
        />
        <div className="flex flex-wrap items-center gap-2 text-caption text-muted-ash">
          {view.sender && (
            <span className="inline-flex items-center gap-1">
              Sender
              <span className="font-mono text-midnight-ink">{fmtAddress(view.sender)}</span>
            </span>
          )}
          <Tag tone="neutral">{view.counts.inputs} inputs</Tag>
          <Tag tone="neutral">{view.counts.commands} commands</Tag>
          <CopyButton text={view.rawJson} />
        </div>
      </div>

      {/* Main split — graph + detail, each scrolls on its own. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4">
        {/* Graph pane — mobile: 60% of the column; desktop: fills the row. */}
        <section className="flex min-h-0 flex-[3] flex-col gap-1.5 lg:flex-1">
          <div className="flex shrink-0 items-center justify-between">
            <SectionLabel>Execution flow</SectionLabel>
            <span className="text-caption text-muted-ash">tap a command to inspect it</span>
          </div>
          {view.commands.length > 0 ? (
            <div className="min-h-0 flex-1">
              <PtbGraph view={view} selected={selected} onSelect={setSelected} />
            </div>
          ) : (
            <p className="text-body-sm text-muted-ash">No commands.</p>
          )}
        </section>

        {/* Detail pane — own scroll. Block (not flex) so children keep their
            natural height and overflow → scroll, instead of flex-shrinking an
            overflow-hidden child (the inputs drawer) down to nothing. */}
        <div className="min-h-0 flex-[2] space-y-3 overflow-y-auto lg:flex-none lg:w-[340px] lg:border-l lg:border-hairline lg:pl-4">
          {selectedCmd && (
            <CommandDetail
              cmd={selectedCmd}
              view={view}
              aiPlain={aiByCommand?.[selectedCmd.index]}
              explaining={explainingCommand === selectedCmd.index}
              onExplain={
                onExplainCommand ? () => onExplainCommand(selectedCmd.index) : undefined
              }
              onSelect={setSelected}
            />
          )}
          <AllInputsDrawer inputs={view.inputs} />
          <p className="text-caption leading-snug text-muted-ash">
            Values are decoded best-effort from the transaction bytes; raw hex is shown where the
            type is ambiguous. AI explanations are best-effort and grounded in the verified plan.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Selected command detail ─────────────────────────────────────────────────

function CommandDetail({
  cmd,
  view,
  aiPlain,
  explaining,
  onExplain,
  onSelect,
}: {
  cmd: PtbCommand;
  view: PtbView;
  aiPlain?: string;
  explaining?: boolean;
  onExplain?: () => void;
  onSelect: (index: number) => void;
}) {
  return (
    <section className="space-y-3 surface-panel ring-1 ring-hairline px-3.5 py-3 rounded-card">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-6 shrink-0 items-center justify-center bg-whisper-gray text-caption font-medium tabular-nums text-midnight-ink rounded-button">
          {cmd.index + 1}
        </span>
        <StatusDisk tone="neutral" className="size-7">
          {kindIcon(cmd.kind)}
        </StatusDisk>
        <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-midnight-ink">
          {cmd.label}
        </span>
        <Tag tone="neutral">{cmd.kind}</Tag>
      </div>

      {/* MoveCall target */}
      {cmd.target && (
        <div className="space-y-1">
          <DetailLabel>Calls</DetailLabel>
          <div className="font-mono text-body-sm leading-relaxed break-all text-midnight-ink">
            <span className="text-muted-ash">
              {cmd.target.packageLabel ?? cmd.target.packageShort}
            </span>
            ::{cmd.target.module}::
            <span className="text-midnight-ink">{cmd.target.function}</span>
          </div>
          {cmd.target.typeArguments.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {cmd.target.typeArguments.map((t, k) => (
                <Tag key={k} tone="violet">
                  {shortType(t)}
                </Tag>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reads — every argument resolved inline. */}
      {cmd.args.length > 0 && (
        <div className="space-y-1.5">
          <DetailLabel>Reads</DetailLabel>
          <div className="flex flex-col gap-1.5">
            {cmd.args.map((a, k) => (
              <ArgDetailRow key={k} arg={a} view={view} onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}

      {/* Feeds — downstream consumers. */}
      {cmd.consumedBy.length > 0 && (
        <div className="space-y-1.5">
          <DetailLabel>Feeds into</DetailLabel>
          <div className="flex flex-wrap items-center gap-1.5">
            {cmd.consumedBy.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onSelect(c)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-button bg-deliver-green/15 px-2 py-0.5 text-caption text-midnight-ink transition-colors hover:bg-deliver-green/25"
              >
                <span className="font-mono">#{c + 1}</span>
                <span className="max-w-[14rem] truncate text-muted-ash">
                  {shortCmdLabel(view.commands[c])}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI per-command explanation (on-demand). */}
      <div className="border-t border-hairline/60 pt-2.5">
        {aiPlain ? (
          <div className="space-y-1">
            <DetailLabel>
              <span className="inline-flex items-center gap-1">
                <Sparkles className="size-3 text-midnight-violet" strokeWidth={2.4} />
                AI explanation
              </span>
            </DetailLabel>
            <p className="text-body-sm leading-relaxed text-midnight-ink">{aiPlain}</p>
          </div>
        ) : onExplain ? (
          <PillButton
            variant="ghost"
            onClick={onExplain}
            disabled={explaining}
            className="px-0 py-0 text-caption"
          >
            {explaining ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2.4} />
            ) : (
              <Sparkles className="size-3.5 text-midnight-violet" strokeWidth={2.4} />
            )}
            {explaining ? "Reading…" : "Explain this step with Sprout"}
          </PillButton>
        ) : null}
      </div>
    </section>
  );
}

function ArgDetailRow({
  arg,
  view,
  onSelect,
}: {
  arg: PtbArg;
  view: PtbView;
  onSelect: (index: number) => void;
}) {
  const { ref } = arg;
  return (
    <div className="flex items-start gap-2 text-body-sm">
      {arg.role && (
        <span className="mt-0.5 min-w-[5.5rem] shrink-0 text-caption text-muted-ash">{arg.role}</span>
      )}
      <div className="min-w-0 flex-1">{renderArgValue(ref, view, onSelect)}</div>
    </div>
  );
}

function renderArgValue(
  ref: PtbArgRef,
  view: PtbView,
  onSelect: (index: number) => void,
) {
  if (ref.kind === "gas") {
    return <span className="rounded-button bg-whisper-gray px-1.5 py-0.5 font-mono text-caption text-muted-ash">GasCoin</span>;
  }
  if (ref.kind === "input") {
    const input = view.inputs[ref.index];
    if (!input) return <span className="font-mono text-caption text-muted-ash">in {ref.index}</span>;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="rounded-button bg-midnight-ink/[0.06] px-1.5 py-0.5 font-mono text-caption text-midnight-ink">
          in {ref.index}
        </span>
        <span className="font-mono text-caption text-midnight-ink">
          {input.display}
          {input.approxDecode && <span className="ml-0.5 text-muted-ash">≈</span>}
        </span>
        {input.label && <Tag tone="green">{input.label}</Tag>}
      </span>
    );
  }
  // result / nestedResult → a producer command output
  const producer = ref.kind === "result" ? ref.index : ref.cmd;
  const cmd = view.commands[producer];
  return (
    <button
      type="button"
      onClick={() => onSelect(producer)}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-button bg-deliver-green/15 px-2 py-0.5 text-caption text-midnight-ink transition-colors hover:bg-deliver-green/25"
    >
      <CornerDownRight className="size-3 text-deliver-green" strokeWidth={2.4} />
      <span className="font-mono">
        from #{producer + 1}
        {ref.kind === "nestedResult" ? `.${ref.out}` : ""}
      </span>
      {cmd && <span className="max-w-[14rem] truncate text-muted-ash">{shortCmdLabel(cmd)}</span>}
    </button>
  );
}

// ─── AI summary banner ───────────────────────────────────────────────────────

function AiSummaryBanner({
  summary,
  summarizing,
  error,
  onSummarize,
}: {
  summary?: PtbExplainSummary | null;
  summarizing?: boolean;
  error?: string | null;
  onSummarize?: () => void;
}) {
  return (
    <div className="surface-panel ring-1 ring-hairline px-3.5 py-3 rounded-card">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-caption font-medium uppercase tracking-wider text-muted-ash">
          <Sparkles className="size-3 text-midnight-violet" strokeWidth={2.4} />
          Plain English
          <Tag tone="violet">AI</Tag>
        </span>
        {!summary && onSummarize && (
          <PillButton
            variant="secondary"
            onClick={onSummarize}
            disabled={summarizing}
            className="px-3 py-1.5 text-caption"
          >
            {summarizing && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.4} />}
            {summarizing ? "Reading…" : "Summarize with Sprout"}
          </PillButton>
        )}
      </div>
      {summary?.summary && (
        <p className="mt-2 text-body-sm leading-relaxed text-midnight-ink">{summary.summary}</p>
      )}
      {!summary && !summarizing && (
        <p className="mt-1.5 text-caption leading-snug text-muted-ash">
          Sprout can read this transaction and explain it in plain English — only when you ask.
        </p>
      )}
      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}
    </div>
  );
}

// ─── All-inputs drawer (secondary) ───────────────────────────────────────────

function AllInputsDrawer({ inputs }: { inputs: PtbInput[] }) {
  const [open, setOpen] = useState(false);
  if (inputs.length === 0) return null;
  return (
    <div className="surface-panel overflow-hidden ring-1 ring-hairline rounded-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-whisper-gray"
      >
        <span className="flex-1 text-body-sm font-medium text-midnight-ink">
          All inputs ({inputs.length})
        </span>
        <span className="text-caption text-muted-ash">raw sources</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-ash transition-transform duration-200",
            open && "rotate-180 text-midnight-ink",
          )}
          strokeWidth={2.4}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={EXPAND}
            className="overflow-hidden"
          >
            <div className="space-y-1 px-2 pb-2">
              {inputs.map((input) => (
                <InputRow key={input.index} input={input} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InputRow({ input }: { input: PtbInput }) {
  const tone = input.objectKind === "SharedObject" ? "violet" : "neutral";
  return (
    <div className="flex items-center gap-2.5 px-1.5 py-1.5">
      <span className="inline-flex h-5 min-w-[2.75rem] shrink-0 items-center justify-center bg-whisper-gray px-1.5 text-[10px] font-medium tabular-nums text-midnight-ink rounded-button">
        in {input.index}
      </span>
      <Tag tone={tone}>{inputKindLabel(input)}</Tag>
      <span className="min-w-0 flex-1 truncate font-mono text-body-sm text-midnight-ink">
        {input.display}
        {input.approxDecode && <span className="ml-1 text-muted-ash">≈</span>}
      </span>
      {input.label && <Tag tone="green">{input.label}</Tag>}
      {input.consumedBy.length > 0 && (
        <span className="hidden shrink-0 items-center gap-1 text-caption text-muted-ash sm:inline-flex">
          <ArrowRight className="size-3" strokeWidth={2.2} />
          {input.consumedBy.map((c) => `#${c + 1}`).join(", ")}
        </span>
      )}
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">{children}</p>
  );
}

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ash">{children}</p>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      className="ml-auto inline-flex cursor-pointer items-center gap-1 bg-whisper-gray px-2 py-1 text-caption font-medium text-midnight-ink transition-colors hover:bg-light-taupe rounded-button"
    >
      {copied ? <Check className="size-3" strokeWidth={2.6} /> : <Copy className="size-3" strokeWidth={2.4} />}
      {copied ? "Copied" : "Copy raw JSON"}
    </button>
  );
}

function inputKindLabel(input: PtbInput): string {
  if (input.kind === "Pure" || input.kind === "UnresolvedPure") return "value";
  if (input.objectKind === "SharedObject") return "shared obj";
  if (input.objectKind === "Receiving") return "receiving";
  return "object";
}

function shortCmdLabel(cmd?: PtbCommand): string {
  if (!cmd) return "";
  return cmd.target ? `${cmd.target.module}::${cmd.target.function}` : cmd.label;
}

function shortType(t: string): string {
  const parts = t.split("::");
  return parts[parts.length - 1] || t;
}

function kindIcon(kind: PtbCommandKind) {
  const cls = "size-3.5";
  const sw = 2.4;
  switch (kind) {
    case "SplitCoins":
      return <Split className={cls} strokeWidth={sw} />;
    case "MergeCoins":
      return <Combine className={cls} strokeWidth={sw} />;
    case "TransferObjects":
      return <Send className={cls} strokeWidth={sw} />;
    case "MakeMoveVec":
      return <Layers className={cls} strokeWidth={sw} />;
    default:
      return <Box className={cls} strokeWidth={sw} />;
  }
}
