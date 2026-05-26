"use client";

import { type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { ArrowUp } from "lucide-react";
import { MAX_USER_MESSAGE_CHARS } from "@/lib/chat-limits";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
};

export function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "What do you want your money to do?",
  autoFocus,
}: Props) {
  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  }

  return (
    <div className="flex items-center gap-2 bg-canvas-white pl-6 pr-2 py-2 shadow-button ring-1 ring-hairline transition-[box-shadow] focus-within:ring-midnight-ink/20 rounded-card">
      <textarea
        autoFocus={autoFocus}
        value={value}
        rows={1}
        maxLength={MAX_USER_MESSAGE_CHARS}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_USER_MESSAGE_CHARS))}
        onKeyDown={handleKey}
        className={cn(
          "relative w-full flex-1 resize-none border-0 bg-transparent text-midnight-ink placeholder:text-muted-ash/70 focus:outline-none disabled:opacity-50",
          "py-3 text-body-lg leading-[1.5] tracking-[-0.015em]",
        )}
      />
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
