"use client";

import { motion } from "motion/react";
import { ArrowRight, ArrowDown } from "lucide-react";
import type { AllocationStep, AllocationLeg } from "@/lib/mock-allocation";
import { AssetIcon } from "@/components/asset-icon";
import { protocolIconUrl } from "@/lib/protocol-icons";
import { fadeUp, stagger, SPRING_BOUNCY } from "@/lib/motion";

function SwapStepBody({ leg }: { leg: AllocationLeg }) {
  const rate =
    leg.fromAmount && leg.toAmount ? leg.toAmount / leg.fromAmount : 1;

  return (
    <div className="space-y-3">
      <motion.div
        variants={stagger(0.05, 0.1)}
        initial="initial"
        animate="animate"
        className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"
      >
        <motion.div
          variants={fadeUp}
          className="flex flex-1 items-center gap-3 bg-canvas-white p-4"
          style={{ borderRadius: 18 }}
        >
          <AssetIcon label={leg.fromAsset ?? "—"} size={36} />
          <div className="min-w-0">
            <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
              You send
            </div>
            <div className="truncate text-body-lg font-semibold tabular-nums leading-tight">
              {leg.fromAmount?.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              <span className="text-body text-subtle-gray">
                {leg.fromAsset}
              </span>
            </div>
          </div>
        </motion.div>

        <motion.div
          variants={{
            initial: { opacity: 0, scale: 0.6, rotate: -90 },
            animate: {
              opacity: 1,
              scale: 1,
              rotate: 0,
              transition: SPRING_BOUNCY,
            },
          }}
          className="inline-flex size-8 shrink-0 items-center justify-center self-center bg-cash-lime text-midnight-black"
          style={{ borderRadius: 9999 }}
        >
          <ArrowRight className="size-4 sm:block hidden" strokeWidth={2.5} />
          <ArrowDown className="size-4 sm:hidden" strokeWidth={2.5} />
        </motion.div>

        <motion.div
          variants={fadeUp}
          className="flex flex-1 items-center gap-3 bg-canvas-white p-4"
          style={{ borderRadius: 18 }}
        >
          <AssetIcon label={leg.toAsset ?? "—"} size={36} />
          <div className="min-w-0">
            <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
              You receive
            </div>
            <div className="truncate text-body-lg font-semibold tabular-nums leading-tight">
              ≈{" "}
              {leg.toAmount?.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              <span className="text-body text-subtle-gray">{leg.toAsset}</span>
            </div>
          </div>
        </motion.div>
      </motion.div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-body-sm text-subtle-gray">
        <span>
          Rate{" "}
          <span className="font-medium text-midnight-black tabular-nums">
            1 {leg.fromAsset} ≈ {rate.toFixed(4)} {leg.toAsset}
          </span>
        </span>
        <span>
          Route{" "}
          <span className="font-medium text-midnight-black">
            {leg.route?.join(" → ")} via 7K
          </span>
        </span>
        <span>
          Slippage{" "}
          <span className="font-medium text-midnight-black tabular-nums">
            {((leg.slippageBps ?? 0) / 100).toFixed(2)}%
          </span>
        </span>
      </div>
    </div>
  );
}

function DepositLeg({ leg }: { leg: AllocationLeg }) {
  const subtitle =
    leg.kind === "lp" && leg.pair
      ? `${leg.pair} · ${leg.feeTier}% fee · IL ${leg.ilRisk ?? "—"}`
      : leg.kind === "vault" && leg.curator
        ? `${leg.curator}${leg.lockDays && leg.lockDays > 0 ? ` · ${leg.lockDays}d lock` : " · No lock"}`
        : leg.description;

  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ x: 2 }}
      transition={{ type: "spring", visualDuration: 0.25, bounce: 0.3 }}
      className="flex items-center justify-between bg-canvas-white p-4"
      style={{ borderRadius: 18 }}
    >
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
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-body font-semibold leading-tight">
              {leg.kind === "vault" && leg.vaultName ? leg.vaultName : leg.venue}
            </span>
            <span className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
              {leg.kind}
            </span>
          </div>
          <div className="truncate text-body-sm text-subtle-gray">
            {subtitle}
          </div>
        </div>
      </div>
      <div className="flex items-baseline gap-4 sm:gap-6">
        <div className="space-y-0 text-right">
          <div className="text-caption uppercase tracking-wider text-subtle-gray">
            APY
          </div>
          <div className="text-body font-semibold tabular-nums">
            {leg.apy.toFixed(2)}%
          </div>
        </div>
        <div className="min-w-[68px] space-y-0 text-right">
          <div className="text-caption uppercase tracking-wider text-subtle-gray">
            Alloc
          </div>
          <div className="text-body font-semibold tabular-nums">
            {leg.allocationPct.toFixed(0)}%
          </div>
          <div className="text-body-sm text-subtle-gray tabular-nums">
            $
            {leg.amountUsd.toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function DepositStepBody({ legs }: { legs: AllocationLeg[] }) {
  return (
    <motion.div
      variants={stagger(0.05, 0.06)}
      initial="initial"
      animate="animate"
      className="space-y-2"
    >
      {legs.map((leg) => (
        <DepositLeg key={leg.id} leg={leg} />
      ))}
    </motion.div>
  );
}

export function StepBlock({ step }: { step: AllocationStep }) {
  return (
    <motion.div variants={fadeUp} className="space-y-3">
      <div className="flex items-baseline gap-3">
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={SPRING_BOUNCY}
          className="inline-flex size-7 shrink-0 items-center justify-center bg-cash-lime text-body-sm font-bold text-midnight-black tabular-nums"
          style={{ borderRadius: 9999 }}
        >
          {step.index}
        </motion.span>
        <div className="text-body font-semibold leading-tight">
          {step.label}
        </div>
      </div>

      <div className="pl-10">
        {step.kind === "swap" ? (
          <SwapStepBody leg={step.legs[0]} />
        ) : (
          <DepositStepBody legs={step.legs} />
        )}
      </div>
    </motion.div>
  );
}

export function StepConnector() {
  return (
    <motion.div
      variants={fadeUp}
      className="flex items-center gap-2 pl-10 text-caption font-medium uppercase tracking-wider text-subtle-gray"
    >
      <ArrowDown className="size-3" strokeWidth={2.5} />
      then
    </motion.div>
  );
}
