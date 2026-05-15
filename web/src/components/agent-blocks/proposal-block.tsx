"use client";

import { Fragment } from "react";
import { motion } from "motion/react";
import type { Allocation } from "@/lib/mock-allocation";
import {
  RISK_LABELS,
  SLIPPAGE_OPTIONS,
  LP_RANGE_OPTIONS,
  type IntentInput,
  type LPRange,
  type TuneState,
} from "@/lib/intent";
import { CountUp } from "@/components/count-up";
import { StepBlock, StepConnector } from "@/components/agent-blocks/step-block";
import { scaleIn, stagger } from "@/lib/motion";

type Props = {
  intent: IntentInput;
  allocation: Allocation;
  tune: TuneState;
  onIntentChange: (next: IntentInput) => void;
  onTuneChange: (next: TuneState) => void;
};

function PillRow<T extends string | number>({
  options,
  active,
  format,
  onPick,
}: {
  options: readonly T[];
  active: T;
  format?: (v: T) => string;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isActive = opt === active;
        return (
          <motion.button
            key={String(opt)}
            type="button"
            onClick={() => onPick(opt)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", visualDuration: 0.2, bounce: 0.3 }}
            className={`px-4 py-2 text-body-sm font-medium ${
              isActive
                ? "bg-cash-lime text-midnight-black"
                : "bg-canvas-white text-midnight-black"
            }`}
            style={{ borderRadius: 9999 }}
          >
            {format ? format(opt) : String(opt)}
          </motion.button>
        );
      })}
    </div>
  );
}

export function ProposalBlock({
  intent,
  allocation,
  tune,
  onIntentChange,
  onTuneChange,
}: Props) {
  const hasSwap = allocation.legs.some((l) => l.kind === "swap");
  const hasLP = allocation.legs.some((l) => l.kind === "lp");
  const hasDeposits = allocation.legs.some((l) => l.kind !== "swap");
  const isPureSwap = allocation.primaryIntent === "swap";
  const stepCount = allocation.steps.length;

  const headlineLabel = isPureSwap
    ? "Here's the swap I'd run"
    : stepCount > 1
      ? `Here's my plan · ${stepCount} steps`
      : "Here's what I'd do";

  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      className="space-y-6 bg-cloud-gray p-6"
      style={{ borderRadius: 24 }}
    >
      <div className="space-y-1.5">
        <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
          {headlineLabel}
        </div>
        {hasDeposits ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className="display-tight font-semibold tabular-nums leading-none"
              style={{ fontSize: "var(--text-title)" }}
            >
              <CountUp value={allocation.blendedApy} decimals={2} suffix="%" />
            </span>
            <span className="text-body-sm font-medium text-subtle-gray">
              blended APY
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className="display-tight font-semibold tabular-nums leading-none"
              style={{ fontSize: "var(--text-title)" }}
            >
              ${allocation.totalUsd.toLocaleString()}
            </span>
            <span className="text-body-sm font-medium text-subtle-gray">
              swap total
            </span>
          </div>
        )}
        <div className="text-body-sm text-subtle-gray">
          {stepCount} {stepCount === 1 ? "step" : "steps"} · 1 atomic PTB ·{" "}
          {hasDeposits && (
            <>
              ~$
              <CountUp
                value={allocation.estimatedAnnualUsd}
                decimals={2}
              />{" "}
              / yr ·{" "}
            </>
          )}
          ${allocation.estimatedGasUsd.toFixed(3)} gas
        </div>
      </div>

      {/* Inline tune — controls live ABOVE the steps */}
      <div className="space-y-3 border-t border-ghost-border pt-4">
        {hasDeposits && (
          <div className="space-y-2">
            <div className="text-body-sm font-medium text-midnight-black">
              Risk profile
            </div>
            <PillRow
              options={RISK_LABELS}
              active={RISK_LABELS[intent.risk]}
              onPick={(label) =>
                onIntentChange({
                  ...intent,
                  risk: RISK_LABELS.indexOf(label) as IntentInput["risk"],
                })
              }
            />
          </div>
        )}
        {hasSwap && (
          <div className="space-y-2">
            <div className="text-body-sm font-medium text-midnight-black">
              Max slippage
            </div>
            <PillRow
              options={SLIPPAGE_OPTIONS}
              active={tune.slippagePct}
              format={(v) => `${v}%`}
              onPick={(v) => onTuneChange({ ...tune, slippagePct: v })}
            />
          </div>
        )}
        {hasLP && (
          <div className="space-y-2">
            <div className="text-body-sm font-medium text-midnight-black">
              LP range
            </div>
            <PillRow
              options={LP_RANGE_OPTIONS}
              active={tune.lpRange}
              onPick={(v: LPRange) => onTuneChange({ ...tune, lpRange: v })}
            />
          </div>
        )}
      </div>

      {/* Steps with connectors */}
      <motion.div
        variants={stagger(0.15, 0.12)}
        initial="initial"
        animate="animate"
        className="space-y-5 border-t border-ghost-border pt-5"
      >
        {allocation.steps.map((step, i) => (
          <Fragment key={step.id}>
            <StepBlock step={step} />
            {i < allocation.steps.length - 1 && <StepConnector />}
          </Fragment>
        ))}
      </motion.div>
    </motion.div>
  );
}
