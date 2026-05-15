"use client";

import { useRef, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { ArrowUp } from "lucide-react";

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
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  }

  return (
    <div
      className="flex items-center gap-2 bg-cloud-gray pl-6 pr-2 py-2 transition-colors focus-within:bg-canvas-white focus-within:ring-2 focus-within:ring-cash-lime"
      style={{ borderRadius: 9999 }}
    >
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={value}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        className="flex-1 resize-none border-0 bg-transparent py-3 text-body-lg text-midnight-black placeholder:text-hinting-gray focus:outline-none disabled:opacity-50"
      />
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
