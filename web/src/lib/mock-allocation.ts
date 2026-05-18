// Types used by the portfolio page's mock data. The buildMockAllocation
// builder + intent classifier were removed when the AI agent took over the
// conversation flow — only the shape definitions are still needed here.

export type ActionKind = "swap" | "lend" | "lp" | "vault";

export type AllocationLeg = {
  id: string;
  kind: ActionKind;
  venue: string;
  description: string;
  asset: string;
  pair?: string;
  pairAssets?: [string, string];
  allocationPct: number;
  amountUsd: number;
  apy: number;
  tvlUsd: number;
  auditGrade: "A" | "A-" | "B+" | "B" | "C";
  iconHint: string;

  // Swap-specific
  fromAsset?: string;
  toAsset?: string;
  fromAmount?: number;
  toAmount?: number;
  route?: string[];
  slippageBps?: number;

  // LP-specific
  feeTier?: number;
  ilRisk?: "low" | "moderate" | "high";

  // Vault-specific
  vaultName?: string;
  curator?: string;
  lockDays?: number;
  strategy?: string;
};
