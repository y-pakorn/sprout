"use client";

import { useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 350;
const MIN_CHARS = 3;

export type AutoCompleteRecentMessage = {
  role: "user" | "assistant";
  text: string;
};

type Options = {
  /** When true, skip firing requests entirely (e.g. agent is mid-stream). */
  disabled?: boolean;
  /** Last few completed turns of the conversation for context. */
  recentMessages?: AutoCompleteRecentMessage[];
};

export type AutoCompleteState = {
  suggestion: string;
  loading: boolean;
  /** Returns the suggestion text (to be appended) and clears state. */
  accept: () => string;
  /** Clear suggestion + cancel any in-flight request. */
  dismiss: () => void;
};

/**
 * Streams a short ghost-text completion for the current draft from
 * /api/autocomplete. Debounced + aborted on every keystroke so only
 * the most recent request ever lands in state.
 */
export function useAutoComplete(
  value: string,
  opts: Options = {},
): AutoCompleteState {
  const [suggestion, setSuggestion] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function cancel() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  useEffect(() => {
    // Always blow away the prior suggestion + request when the value
    // changes. We'll re-issue a fresh request after the debounce.
    cancel();
    setSuggestion("");

    if (opts.disabled) return;
    const trimmed = value.trim();
    if (trimmed.length < MIN_CHARS) return;
    // Treat sentence-ending punctuation as "done thought" — no suggestion.
    if (/[.?!]$/.test(trimmed)) return;

    const timer = window.setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      console.log("[autocomplete] fetch", { draft: value });
      try {
        const res = await fetch("/api/autocomplete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            draft: value,
            recentMessages: opts.recentMessages ?? [],
          }),
          signal: ctrl.signal,
        });
        console.log(
          "[autocomplete] response",
          res.status,
          res.headers.get("content-type"),
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.warn("[autocomplete] non-ok response", res.status, errText);
          setLoading(false);
          return;
        }
        if (!res.body) {
          console.warn("[autocomplete] no body");
          setLoading(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          const piece = decoder.decode(chunk, { stream: true });
          acc += piece;
          console.log("[autocomplete] chunk", JSON.stringify(piece));
          if (abortRef.current === ctrl) setSuggestion(acc);
        }
        console.log("[autocomplete] done acc=", JSON.stringify(acc));
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") {
          console.warn("[autocomplete] fetch failed", e);
        }
      } finally {
        if (abortRef.current === ctrl) {
          abortRef.current = null;
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, opts.disabled]);

  function accept() {
    const s = suggestion;
    cancel();
    setSuggestion("");
    setLoading(false);
    return s;
  }

  function dismiss() {
    cancel();
    setSuggestion("");
    setLoading(false);
  }

  return { suggestion, loading, accept, dismiss };
}
