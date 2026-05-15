import type { Allocation } from "./mock-allocation";
import type { IntentInput } from "./intent";

export type RiskVerdict = "pass" | "flag" | "block";

export type GuardianRisk = {
  id: string;
  label: string;
  verdict: RiskVerdict;
  summary: string;
  detail: string;
};

const GRADE_SCORE: Record<string, number> = { A: 4, "A-": 3.5, "B+": 3, B: 2, C: 1 };

export function evaluateGuardian(
  intent: IntentInput,
  allocation: Allocation,
): GuardianRisk[] {
  const slippageBps = allocation.legs.some((l) => l.kind === "swap" || l.kind === "lp") ? 28 : 4;
  const slippageVerdict: RiskVerdict = slippageBps > 100 ? "flag" : "pass";

  const maxAllocation = Math.max(...allocation.legs.map((l) => l.allocationPct));
  const concentrationVerdict: RiskVerdict =
    maxAllocation > 70 ? "block" : maxAllocation > 50 ? "flag" : "pass";

  const minGrade = Math.min(...allocation.legs.map((l) => GRADE_SCORE[l.auditGrade] ?? 0));
  const auditVerdict: RiskVerdict = minGrade < 2 ? "flag" : "pass";

  const minTvl = Math.min(...allocation.legs.map((l) => l.tvlUsd));
  const tvlVerdict: RiskVerdict = minTvl < 1_000_000 ? "flag" : "pass";

  const gasShare = allocation.estimatedGasUsd / Math.max(1, allocation.estimatedAnnualUsd);
  const gasVerdict: RiskVerdict = gasShare > 0.02 ? "flag" : "pass";

  const _ = intent;

  return [
    {
      id: "slippage",
      label: "Slippage & price impact",
      verdict: slippageVerdict,
      summary:
        slippageBps > 0
          ? `Estimated ${(slippageBps / 100).toFixed(2)}% across swap & LP legs`
          : "No swap legs in this plan",
      detail:
        "Computed from 7K aggregator quotes against current depth. Lower is better.",
    },
    {
      id: "concentration",
      label: "Concentration",
      verdict: concentrationVerdict,
      summary: `Largest single venue: ${maxAllocation.toFixed(1)}%`,
      detail:
        "Diversification check. We block if any one venue exceeds 70%, flag above 50%.",
    },
    {
      id: "audit",
      label: "Audit & contract risk",
      verdict: auditVerdict,
      summary: `Lowest grade in plan: ${
        allocation.legs.find(
          (l) => (GRADE_SCORE[l.auditGrade] ?? 0) === minGrade,
        )?.auditGrade ?? "n/a"
      }`,
      detail:
        "Public audit grades from OtterSec and OpenZeppelin reports. We won't route below B unless you opt in.",
    },
    {
      id: "tvl",
      label: "Pool depth (TVL)",
      verdict: tvlVerdict,
      summary: `Thinnest pool in plan: $${(minTvl / 1_000_000).toFixed(1)}M`,
      detail: "Thin pools mean slippage spikes on entry and exit. We flag anything under $1M.",
    },
    {
      id: "gas",
      label: "Gas vs expected yield",
      verdict: gasVerdict,
      summary: `Gas $${allocation.estimatedGasUsd.toFixed(3)} vs $${allocation.estimatedAnnualUsd.toFixed(2)} expected/yr`,
      detail:
        "We flag when gas eats more than 2% of expected first-year yield. Atomic PTBs keep this minimal on Sui.",
    },
  ];
}
