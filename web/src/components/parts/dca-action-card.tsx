"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Loader2, Check, ExternalLink, Repeat } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { PillButton } from "@/components/ui/pill-button";
import { Switch } from "@/components/ui/switch";
import { GuardianPanel } from "@/components/parts/guardian-panel";
import { PtbSummaryStrip } from "@/components/parts/ptb-summary-strip";
import { PtbDialog } from "@/components/parts/ptb-dialog";
import { scaleIn } from "@/lib/motion";
import { fmtAmount } from "@/lib/format";
import { fmtInterval } from "@/lib/seven-k-dca";
import { cn } from "@/lib/utils";
import type { CachedDcaAction } from "@/lib/ai/dca-cache";

type Props = {
  cached: CachedDcaAction;
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
  sponsorGas: boolean;
  onSponsorGasChange: (next: boolean) => void;
  sponsored: boolean;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-panel px-3 py-2 rounded-card">
      <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
        {label}
      </div>
      <div className="truncate text-body-sm font-medium tabular-nums text-midnight-ink">
        {value}
      </div>
    </div>
  );
}

export function DcaActionCard(props: Props) {
  const { cached } = props;
  const [ptbOpen, setPtbOpen] = useState(false);
  const blocking = cached.risks.some((r) => r.level === "block");

  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      className="space-y-3 surface-card p-4 rounded-card max-w-[640px]"
    >
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
          {cached.kind === "place" ? "DCA order" : "Cancel DCA"}
        </span>
        <span className="inline-flex items-center gap-1.5 text-caption font-medium uppercase tracking-wider text-muted-ash">
          <Repeat className="size-3" strokeWidth={2.4} />
          {cached.kind === "place" ? "Recurring" : "Reclaim funds"}
        </span>
      </div>

      {cached.kind === "place" ? (
        <PlaceBody {...props} cached={cached} onOpenPtb={() => setPtbOpen(true)} />
      ) : (
        <CancelBody {...props} cached={cached} onOpenPtb={() => setPtbOpen(true)} />
      )}

      {/* Guardian */}
      <GuardianPanel risks={cached.risks} />

      {/* Sprout-pays-gas toggle (place only; cancel is trivial) */}
      {cached.kind === "place" &&
        !props.executed &&
        !props.confirming &&
        cached.sponsorEligible && (
          <div className="flex items-center justify-between gap-3 border-t border-hairline/60 pt-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-body-sm font-medium text-midnight-ink">
                Sprout pays gas
              </span>
              <span className="text-caption text-muted-ash">
                {props.sponsorGas
                  ? "You sign — Sprout covers the SUI network fee"
                  : "You pay the SUI network fee from your wallet"}
              </span>
            </div>
            <Switch
              checked={props.sponsorGas}
              onCheckedChange={props.onSponsorGasChange}
              disabled={props.signing}
              aria-label="Sprout pays gas"
            />
          </div>
        )}

      {/* Action footer */}
      {!props.executed && !props.confirming && (
        <div
          className={cn(
            "flex items-center justify-end gap-1.5 pt-3",
            !(cached.kind === "place" && cached.sponsorEligible) &&
              "border-t border-hairline/60",
          )}
        >
          <PillButton
            variant="secondary"
            onClick={props.onCancel}
            disabled={props.signing}
          >
            Dismiss
          </PillButton>
          <PillButton
            onClick={props.onConfirm}
            disabled={props.signing || !props.walletConnected || blocking}
          >
            {props.signing && (
              <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
            )}
            {props.signing
              ? "Signing…"
              : !props.walletConnected
                ? "Connect wallet first"
                : blocking
                  ? "Resolve to continue"
                  : cached.kind === "place"
                    ? "Start DCA →"
                    : "Cancel order →"}
          </PillButton>
        </div>
      )}

      {/* Receipt */}
      <Receipt {...props} />

      <PtbDialog open={ptbOpen} onOpenChange={setPtbOpen} tx={cached.tx} />
    </motion.div>
  );
}

function PlaceBody({
  cached,
  iconLookup,
  onOpenPtb,
}: Props & { cached: Extract<CachedDcaAction, { kind: "place" }>; onOpenPtb: () => void }) {
  const runsThrough = new Date(cached.runsThroughMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const band = priceBandLabel(cached);
  return (
    <>
      {/* Pair row */}
      <div className="flex items-center gap-2.5">
        <AssetIcon
          src={cached.payIcon ?? iconLookup(cached.payCoinType)}
          label={cached.paySymbol}
          size={28}
        />
        <div className="flex items-baseline gap-1.5">
          <span className="font-medium tabular-nums text-midnight-ink text-[17px] tracking-[-0.005em]">
            {fmtAmount(cached.amountPerOrderHuman)}
          </span>
          <span className="text-body-sm text-muted-ash">{cached.paySymbol}</span>
        </div>
        <ArrowRight className="size-3.5 shrink-0 text-muted-ash" strokeWidth={2.4} />
        <AssetIcon
          src={cached.targetIcon ?? iconLookup(cached.targetCoinType)}
          label={cached.targetSymbol}
          size={28}
        />
        <span className="text-body-sm font-medium text-midnight-ink">
          {cached.targetSymbol}
        </span>
        <span className="ml-auto text-caption text-muted-ash">
          {fmtInterval(cached.intervalMs)} · {cached.numOrders}×
        </span>
      </div>

      {/* Schedule stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Every" value={fmtInterval(cached.intervalMs)} />
        <Stat label="Orders" value={`${cached.numOrders}`} />
        <Stat
          label="Per order"
          value={`${fmtAmount(cached.amountPerOrderHuman)} ${cached.paySymbol}`}
        />
        <Stat
          label="Total locked"
          value={`${fmtAmount(cached.totalLockedHuman)} ${cached.paySymbol}`}
        />
      </div>

      {/* Price band + schedule end */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-muted-ash">
        <span>
          Runs through ~
          <span className="font-medium text-midnight-ink">{runsThrough}</span> ·
          slippage {cached.slippagePct}%
        </span>
        {band && (
          <span>
            Buys only when 1 {cached.targetSymbol} is{" "}
            <span className="font-medium text-midnight-ink">{band}</span>
          </span>
        )}
      </div>

      <PtbSummaryStrip tx={cached.tx} onOpen={onOpenPtb} />
    </>
  );
}

function CancelBody({
  cached,
  iconLookup,
  onOpenPtb,
}: Props & { cached: Extract<CachedDcaAction, { kind: "cancel" }>; onOpenPtb: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2.5">
        <AssetIcon
          src={cached.payIcon ?? iconLookup(cached.payCoinType)}
          label={cached.paySymbol}
          size={28}
        />
        <div className="min-w-0 flex-1">
          <div className="text-body-sm font-medium text-midnight-ink">
            Cancel {cached.paySymbol} → {cached.targetSymbol} DCA
          </div>
          <div className="text-caption text-muted-ash">
            Reclaims{" "}
            <span className="font-medium text-midnight-ink tabular-nums">
              {fmtAmount(cached.remainingHuman)} {cached.paySymbol}
            </span>{" "}
            of unspent funds to your wallet
          </div>
        </div>
      </div>
      <PtbSummaryStrip tx={cached.tx} onOpen={onOpenPtb} />
    </>
  );
}

function Receipt({
  cached,
  confirming,
  executed,
  txStatus,
  txError,
  txDigest,
  sponsored,
}: Props) {
  if (!confirming && !executed) return null;
  const success = txStatus === "success";
  const failure = txStatus === "failure";
  const doneLabel =
    cached.kind === "place"
      ? sponsored
        ? "DCA started · gas on Sprout"
        : "DCA started"
      : "Order cancelled · funds returned";
  return (
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
            {doneLabel}
          </>
        ) : (
          <span className="text-midnight-ink">
            {cached.kind === "place" ? "Couldn't start DCA" : "Cancel failed"}
            {txError ? ` — ${txError}` : ""}
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
  );
}

function priceBandLabel(
  c: Extract<CachedDcaAction, { kind: "place" }>,
): string | null {
  const { minPrice, maxPrice, paySymbol } = c;
  if (minPrice != null && maxPrice != null)
    return `${fmtAmount(minPrice)}–${fmtAmount(maxPrice)} ${paySymbol}`;
  if (maxPrice != null) return `≤ ${fmtAmount(maxPrice)} ${paySymbol}`;
  if (minPrice != null) return `≥ ${fmtAmount(minPrice)} ${paySymbol}`;
  return null;
}
