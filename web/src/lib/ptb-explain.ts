// Client helper for the on-demand PTB explanation endpoint. Never called
// automatically — only when the user clicks "Summarize" or a command's
// "Explain". Results are memoized per-transaction so re-opening the dialog or
// re-clicking doesn't refetch.

import { apiFetch } from "@/lib/api-client";
import type { PtbView } from "@/lib/ptb-view";
import type { ResolvedStep } from "@/lib/ai/action-plan-cache";

export type PtbExplainRequest = {
  /** Decoded view minus the heavy rawJson blob. */
  view: Omit<PtbView, "rawJson">;
  /** Verified semantic steps (amounts, vault names, swap providers) so the
   *  model maps known truths instead of guessing over opaque DEX bytes. */
  steps?: ResolvedStep[];
  /** When set, return a single deeper explanation for that command index. */
  focusCommand?: number;
};

export type PtbExplainSummary = {
  summary: string;
  commands: { index: number; plain: string }[];
};

export type PtbExplainFocus = { explanation: string };

const summaryCache = new Map<string, PtbExplainSummary>();
const focusCache = new Map<string, string>();

function fingerprint(view: PtbView): string {
  return view.rawJson;
}

async function post(body: PtbExplainRequest): Promise<unknown> {
  const res = await apiFetch("/api/explain-ptb", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error((msg as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/** Plain-English overview of the whole tx + a one-liner per command. Cached. */
export async function explainPtb(
  view: PtbView,
  steps?: ResolvedStep[],
): Promise<PtbExplainSummary> {
  const key = fingerprint(view);
  const hit = summaryCache.get(key);
  if (hit) return hit;
  const { rawJson: _drop, ...rest } = view;
  void _drop;
  const data = (await post({ view: rest, steps })) as PtbExplainSummary;
  const safe: PtbExplainSummary = {
    summary: data.summary ?? "",
    commands: Array.isArray(data.commands) ? data.commands : [],
  };
  summaryCache.set(key, safe);
  return safe;
}

/** Deeper one-off explanation for a single command. Cached per (tx, command). */
export async function explainPtbCommand(
  view: PtbView,
  commandIndex: number,
  steps?: ResolvedStep[],
): Promise<string> {
  const key = `${fingerprint(view)}#${commandIndex}`;
  const hit = focusCache.get(key);
  if (hit) return hit;
  const { rawJson: _drop, ...rest } = view;
  void _drop;
  const data = (await post({ view: rest, steps, focusCommand: commandIndex })) as PtbExplainFocus;
  const text = data.explanation ?? "";
  focusCache.set(key, text);
  return text;
}
