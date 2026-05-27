"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { AtSign, Copy, Check } from "lucide-react";
import { StatusDisk } from "@/components/ui/status-disk";
import { fmtAddress } from "@/lib/format";
import { popIn } from "@/lib/motion";

/**
 * Result of the SuiNS conversion tool: a SuiNS name ↔ Sui address pairing.
 * Shows the name (if any) with the full address available via a copy button
 * (addresses are long, so we render the short form + copy the full one).
 */
export function SuinsCard({ name, address }: { name?: string; address: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <motion.div
      variants={popIn}
      initial="initial"
      animate="animate"
      className="flex w-fit max-w-full items-center gap-3 surface-card px-3.5 py-2.5 rounded-card"
    >
      <StatusDisk tone="neutral" className="size-8">
        <AtSign className="size-4" strokeWidth={2.4} />
      </StatusDisk>
      <div className="min-w-0">
        <div className="text-body-sm font-medium text-midnight-ink">
          {name ?? "No SuiNS name set"}
        </div>
        <button
          type="button"
          onClick={copy}
          title="Copy full address"
          className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-caption text-muted-ash transition-colors hover:text-midnight-ink"
        >
          {fmtAddress(address)}
          {copied ? (
            <Check className="size-3 text-deliver-green" strokeWidth={2.8} />
          ) : (
            <Copy className="size-3" strokeWidth={2.2} />
          )}
        </button>
      </div>
    </motion.div>
  );
}
