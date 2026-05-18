"use client";

import { useRef, type KeyboardEvent } from "react";
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
    if (suggestion && caretAtEnd()) {
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
      className="flex items-center gap-2 bg-cloud-gray pl-6 pr-2 py-2 transition-colors focus-within:bg-canvas-white focus-within:ring-2 focus-within:ring-cash-lime"
      style={{ borderRadius: 9999 }}
    >
      <div className="relative flex-1">
        {/* Mirror — invisible draft + visible suggestion. Sits behind the
            textarea so the textarea's real caret aligns naturally. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 select-none text-midnight-black",
            typeAndPad,
          )}
        >
          <span className="invisible">{value}</span>
          {suggestion && (
            <span className="text-hinting-gray">{suggestion}</span>
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
            "relative w-full resize-none border-0 bg-transparent text-midnight-black placeholder:text-hinting-gray focus:outline-none disabled:opacity-50",
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
        className="inline-flex size-10 shrink-0 items-center justify-center bg-cash-lime text-midnight-black disabled:bg-hinting-gray disabled:text-canvas-white"
        style={{ borderRadius: 9999 }}
      >
        <ArrowUp className="size-5" strokeWidth={2.5} />
      </motion.button>
    </div>
  );
}
