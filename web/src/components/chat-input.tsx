"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { ArrowUp } from "lucide-react";
import {
  useAutoComplete,
  type AutoCompleteRecentMessage,
} from "@/lib/ai/use-autocomplete";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Optional recent conversation context to seed autocomplete. */
  recentMessages?: AutoCompleteRecentMessage[];
};

export function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "What do you want your money to do?",
  autoFocus,
  recentMessages,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { suggestion, accept, dismiss } = useAutoComplete(value, {
    disabled,
    recentMessages,
  });

  // Hide the ghost text once the input has wrapped beyond one line. The
  // mirror div wraps based on value+suggestion combined while the
  // textarea wraps on value alone — they diverge mid-line, leaving an
  // ugly visual gap. Single-line cases are pixel-perfect and that's
  // 95% of usage. Re-check whenever the value or suggestion changes.
  const [isMultiLine, setIsMultiLine] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // scrollHeight > clientHeight ⇒ content has wrapped. clientHeight is
    // 1-line tall since rows={1} and resize-none.
    const wrapped = el.scrollHeight > el.clientHeight + 4;
    setIsMultiLine(wrapped);
  }, [value, suggestion]);
  const ghostText = isMultiLine ? "" : suggestion;

  function caretAtEnd(): boolean {
    const el = ref.current;
    if (!el) return false;
    return el.selectionStart === value.length && el.selectionEnd === value.length;
  }

  function applySuggestion() {
    const tail = accept();
    if (!tail) return;
    onChange(value + tail);
    // Reposition caret to the new end after React applies the value.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const end = value.length + tail.length;
      el.setSelectionRange(end, end);
    });
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
      return;
    }
    if (ghostText && caretAtEnd()) {
      if (e.key === "Tab" || e.key === "ArrowRight") {
        e.preventDefault();
        applySuggestion();
        return;
      }
    }
    if (e.key === "Escape" && suggestion) {
      e.preventDefault();
      dismiss();
    }
  }

  // Shared typography/padding string applied to BOTH the textarea AND
  // the ghost-text mirror so the suggestion renders flush with the caret.
  const typeAndPad =
    "py-3 text-body-lg leading-[1.5] tracking-[-0.015em] whitespace-pre-wrap break-words";

  return (
    <div
      className="flex items-center gap-2 bg-canvas-white pl-6 pr-2 py-2 shadow-button ring-1 ring-hairline transition-[box-shadow] focus-within:ring-midnight-ink/20 rounded-card"
    >
      <div className="relative flex-1">
        {/* Mirror — invisible draft + visible suggestion. Sits behind the
            textarea so the textarea's real caret aligns naturally. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 select-none text-midnight-ink",
            typeAndPad,
          )}
        >
          <span className="invisible">{value}</span>
          {ghostText && (
            <span className="text-muted-ash/70">{ghostText}</span>
          )}
        </div>
        <textarea
          ref={ref}
          autoFocus={autoFocus}
          value={value}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          className={cn(
            "relative w-full resize-none border-0 bg-transparent text-midnight-ink placeholder:text-muted-ash/70 focus:outline-none disabled:opacity-50",
            typeAndPad,
          )}
        />
      </div>
      <motion.button
        type="button"
        onClick={onSubmit}
        disabled={!value.trim() || disabled}
        aria-label="Send"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: "spring", visualDuration: 0.2, bounce: 0.4 }}
        className="inline-flex size-10 shrink-0 items-center justify-center bg-midnight-ink text-canvas-white disabled:bg-light-taupe disabled:text-muted-ash rounded-button"
      >
        <ArrowUp className="size-5" strokeWidth={2.5} />
      </motion.button>
    </div>
  );
}
