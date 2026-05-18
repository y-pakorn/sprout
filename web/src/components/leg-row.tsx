"use client";

import { ArrowRight } from "lucide-react";
import type { AllocationLeg } from "@/lib/mock-allocation";
import { AssetIcon } from "@/components/asset-icon";
import { protocolIconUrl } from "@/lib/protocol-icons";
import { cn } from "@/lib/utils";

type Tone = "default" | "glass";

const KIND_LABEL: Record<AllocationLeg["kind"], string> = {
  swap: "Swap",
  lend: "Lend",
  lp: "Liquidity",
  vault: "Vault",
};

function SwapRow({ leg, tone }: { leg: AllocationLeg; tone: Tone }) {
  const muted = tone === "glass" ? "text-canvas-white/55" : "text-subtle-gray";
  const primary = tone === "glass" ? "text-canvas-white" : "text-midnight-black";
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-1 last:pb-1">
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={cn(
            "text-caption font-medium uppercase tracking-wider",
            muted,
          )}
        >
          {KIND_LABEL.swap}
        </span>
        <span className={cn("text-body-sm", muted)}>via {leg.venue}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2">
          <AssetIcon label={leg.fromAsset ?? "—"} size={28} />
          <div className={cn("text-body font-semibold tabular-nums", primary)}>
            {leg.fromAmount?.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}{" "}
            <span className={cn("text-body-sm font-normal", muted)}>
              {leg.fromAsset}
            </span>
          </div>
        </div>
        <ArrowRight className={cn("size-3.5", muted)} />
        <div className="flex items-center gap-2">
          <AssetIcon label={leg.toAsset ?? "—"} size={28} />
          <div className={cn("text-body font-semibold tabular-nums", primary)}>
            ≈{" "}
            {leg.toAmount?.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}{" "}
            <span className={cn("text-body-sm font-normal", muted)}>
              {leg.toAsset}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function YieldRow({ leg, tone }: { leg: AllocationLeg; tone: Tone }) {
  const muted = tone === "glass" ? "text-canvas-white/55" : "text-subtle-gray";
  const primary = tone === "glass" ? "text-canvas-white" : "text-midnight-black";
  const subtitle =
    leg.kind === "lp" && leg.pair
      ? `${leg.pair} · ${leg.feeTier}% fee · IL ${leg.ilRisk ?? "—"}`
      : leg.kind === "vault" && leg.curator
        ? `${leg.curator}${leg.lockDays && leg.lockDays > 0 ? ` · ${leg.lockDays}d lock` : ""}`
        : leg.description;

  return (
    <div className="flex items-center justify-between py-3 first:pt-1 last:pb-1">
      <div className="flex flex-1 items-center gap-3">
        {leg.kind === "lp" && leg.pairAssets ? (
          <div className="flex shrink-0 -space-x-2">
            <AssetIcon label={leg.pairAssets[0]} size={36} />
            <AssetIcon label={leg.pairAssets[1]} size={36} />
          </div>
        ) : (
          <AssetIcon
            src={protocolIconUrl(leg.venue)}
            label={leg.venue}
            size={36}
          />
        )}
        <div className="min-w-0">
          <div className={cn("text-body font-semibold leading-tight", primary)}>
            {leg.kind === "vault" && leg.vaultName ? leg.vaultName : leg.venue}
          </div>
          <div className={cn("truncate text-body-sm", muted)}>{subtitle}</div>
        </div>
      </div>
      <div className="text-right">
        <div className={cn("text-body font-semibold tabular-nums", primary)}>
          $
          {leg.amountUsd.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        </div>
        <div
          className={cn(
            "text-body-sm tabular-nums",
            tone === "glass" ? "text-cash-lime" : "text-subtle-gray",
          )}
        >
          {leg.apy.toFixed(2)}% APY
        </div>
      </div>
    </div>
  );
}

export function LegRow({
  leg,
  tone = "default",
}: {
  leg: AllocationLeg;
  tone?: Tone;
}) {
  if (leg.kind === "swap") return <SwapRow leg={leg} tone={tone} />;
  return <YieldRow leg={leg} tone={tone} />;
}
