"use client";

import { motion } from "motion/react";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "input-streaming" | "input-available" | "output-available" | "output-error";

type Props = {
  label: string;
  status: Status;
};

export function ToolCallRow({ label, status }: Props) {
  const isWorking = status === "input-streaming" || status === "input-available";
  const isDone = status === "output-available";
  const isError = status === "output-error";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="inline-flex items-center gap-2 bg-cloud-gray px-4 py-2 text-body-sm font-medium text-midnight-black"
      style={{ borderRadius: 9999 }}
    >
      <span
        className={cn(
          "inline-flex size-5 items-center justify-center",
          isDone && "bg-cash-lime text-midnight-black",
          isError && "bg-destructive text-canvas-white",
          !isDone && !isError && "bg-canvas-white text-subtle-gray",
        )}
        style={{ borderRadius: 9999 }}
      >
        {isDone ? (
          <Check className="size-3" strokeWidth={2.8} />
        ) : isError ? (
          <AlertCircle className="size-3" strokeWidth={2.4} />
        ) : (
          <Loader2 className="size-3 animate-spin" strokeWidth={2.4} />
        )}
      </span>
      <span>{label}</span>
      {isWorking && (
        <span className="text-subtle-gray">…</span>
      )}
    </motion.div>
  );
}
