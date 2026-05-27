"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Loader2,
  Check,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { PillButton } from "@/components/ui/pill-button";
import { PtbSummaryStrip } from "@/components/parts/ptb-summary-strip";
import { PtbDialog } from "@/components/parts/ptb-dialog";
import { scaleIn } from "@/lib/motion";
import { fmtAmount, fmtAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CachedGaslessSend } from "@/lib/ai/action-plan-cache";

type Props = {
  cached: CachedGaslessSend;
  iconLookup: (coinType: string) => string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  signing: boolean;
  confirming: boolean;
  executed: boolean;
  txDigest?: string;
  txStatus?: "success" | "failure";
  txError?: string;
  walletConnected: boolean;
};

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "lime";
}) {
  return (
    <div
      className={cn(
        "surface-panel px-3 py-2 rounded-card",
        tone === "lime" && "bg-deliver-green/15",
      )}
    >
      <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
        {label}
      </div>
      <div className="truncate text-body font-medium tabular-nums text-midnight-ink">
        {value}
      </div>
    </div>
  );
}

export function GaslessSendCard({
  cached,
  iconLookup,
  onConfirm,
  onCancel,
  signing,
  confirming,
  executed,
  txDigest,
  txStatus,
  txError,
  walletConnected,
}: Props) {
  const success = txStatus === "success";
  const failure = txStatus === "failure";
  const recipientLabel = cached.recipientName ?? fmtAddress(cached.recipient);
  const [ptbOpen, setPtbOpen] = useState(false);

  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      className="space-y-3 surface-card p-4 rounded-card"
    >
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
          Transfer
        </span>
        <span className="inline-flex items-center gap-1.5 text-caption font-medium uppercase tracking-wider text-muted-ash">
          <span className="inline-block size-1.5 bg-deliver-green rounded-full" />
          Gasless
        </span>
      </div>

      {/* Transfer row */}
      <div className="flex items-center gap-2.5">
        <AssetIcon
          src={iconLookup(cached.coinType)}
          label={cached.symbol}
          size={28}
        />
        <div className="flex items-baseline gap-1.5">
          <span className="font-medium tabular-nums text-midnight-ink text-[17px] tracking-[-0.005em]">
            {fmtAmount(cached.amountHuman)}
          </span>
          <span className="text-body-sm text-muted-ash">{cached.symbol}</span>
        </div>
        <ArrowRight
          className="size-3.5 shrink-0 text-muted-ash"
          strokeWidth={2.4}
        />
        <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-midnight-ink">
          {recipientLabel}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat
          label="Sending"
          value={`${fmtAmount(cached.amountHuman)} ${cached.symbol}`}
        />
        <Stat label="Recipient" value={recipientLabel} />
        <Stat label="Network fee" value="Free" tone="lime" />
      </div>

      {/* Real PTB — compact teaser; opens the full interactive viewer. */}
      <PtbSummaryStrip tx={cached.tx} onOpen={() => setPtbOpen(true)} />

      {/* Guardian */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-5 items-center justify-center bg-warning text-midnight-ink rounded-[9px]">
            <ShieldCheck className="size-2.5" strokeWidth={2.6} />
          </span>
          <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
            Guardian
          </span>
        </div>
        <p className="text-body-sm leading-snug text-midnight-ink">
          Irreversible transfer — there&apos;s no recall on Sui, so make sure the
          recipient is right.
          {cached.recipientName ? (
            <>
              {" "}
              <span className="text-muted-ash">
                {cached.recipientName} resolves to{" "}
                <span className="font-mono">
                  {fmtAddress(cached.recipient, 10, 6)}
                </span>
                .
              </span>
            </>
          ) : null}
        </p>
      </div>

      {/* Action row */}
      {!executed && !confirming && (
        <div className="flex items-center justify-end gap-1.5 border-t border-hairline/60 pt-3">
          <PillButton variant="secondary" onClick={onCancel} disabled={signing}>
            Cancel
          </PillButton>
          <PillButton onClick={onConfirm} disabled={signing || !walletConnected}>
            {signing && (
              <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
            )}
            {signing
              ? "Signing…"
              : !walletConnected
                ? "Connect wallet first"
                : "Send for free →"}
          </PillButton>
        </div>
      )}

      {/* Receipt */}
      {(confirming || executed) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 rounded-card",
            confirming && "surface-panel",
            success && "bg-deliver-green/15",
            failure && "bg-destructive/15",
          )}
        >
          <div className="flex items-center gap-2 text-body-sm font-medium text-midnight-ink">
            {confirming ? (
              <>
                <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
                Waiting for finality on Sui…
              </>
            ) : success ? (
              <>
                <span className="inline-flex size-5 items-center justify-center bg-deliver-green text-midnight-ink rounded-full">
                  <Check className="size-3" strokeWidth={2.8} />
                </span>
                Sent · $0 fee
              </>
            ) : (
              <span className="text-midnight-ink">
                Transfer failed{txError ? ` — ${txError}` : ""}
              </span>
            )}
          </div>
          {txDigest && (
            <a
              href={`https://suiscan.xyz/mainnet/tx/${txDigest}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 surface-panel px-2.5 py-1 font-mono text-caption text-midnight-ink ring-1 ring-hairline rounded-card"
            >
              {txDigest.slice(0, 6)}…{txDigest.slice(-4)}
              <ExternalLink className="size-3" strokeWidth={2.2} />
            </a>
          )}
        </motion.div>
      )}

      <PtbDialog open={ptbOpen} onOpenChange={setPtbOpen} tx={cached.tx} />
    </motion.div>
  );
}
