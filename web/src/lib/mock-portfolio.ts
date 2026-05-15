import type { AllocationLeg } from "./mock-allocation";

export type PortfolioPosition = AllocationLeg & {
  startedAt: string;
  pnlUsd: number;
  pnlPct: number;
};

export type TokenBalance = {
  symbol: string;
  amount: number;
  usdValue: number;
  pricePerUnit: number;
};

export const MOCK_BALANCES: TokenBalance[] = [
  { symbol: "USDC", amount: 3200, usdValue: 3200, pricePerUnit: 1 },
  { symbol: "SUI", amount: 1240, usdValue: 1180, pricePerUnit: 0.95 },
  { symbol: "WAL", amount: 800, usdValue: 200, pricePerUnit: 0.25 },
  { symbol: "DEEP", amount: 4500, usdValue: 220, pricePerUnit: 0.049 },
];

export const MOCK_PORTFOLIO: PortfolioPosition[] = [
  {
    id: "p-1",
    kind: "lend",
    venue: "Suilend",
    description: "USDC lending — main money market",
    asset: "USDC",
    allocationPct: 38,
    amountUsd: 1900,
    apy: 5.8,
    tvlUsd: 42_300_000,
    auditGrade: "A",
    iconHint: "lend",
    startedAt: "2026-04-22",
    pnlUsd: 14.2,
    pnlPct: 0.75,
  },
  {
    id: "p-2",
    kind: "lend",
    venue: "NAVI Protocol",
    description: "USDC supply, isolated pool",
    asset: "USDC",
    allocationPct: 27,
    amountUsd: 1350,
    apy: 6.2,
    tvlUsd: 38_500_000,
    auditGrade: "A",
    iconHint: "lend",
    startedAt: "2026-04-22",
    pnlUsd: 10.8,
    pnlPct: 0.8,
  },
  {
    id: "p-3",
    kind: "vault",
    venue: "Ember Finance",
    vaultName: "USDC Delta-Neutral",
    curator: "Block Asset Mgmt",
    strategy: "Perp basis + spot lending, weekly rebalance",
    lockDays: 0,
    description: "Auto-compounding USDC delta-neutral vault",
    asset: "USDC",
    allocationPct: 20,
    amountUsd: 1000,
    apy: 9.4,
    tvlUsd: 15_200_000,
    auditGrade: "B+",
    iconHint: "vault",
    startedAt: "2026-05-02",
    pnlUsd: 6.3,
    pnlPct: 0.63,
  },
  {
    id: "p-4",
    kind: "lp",
    venue: "Cetus (via 7K)",
    pair: "USDC/SUI",
    pairAssets: ["USDC", "SUI"],
    feeTier: 0.25,
    ilRisk: "moderate",
    description: "USDC/SUI CLMM, balanced range",
    asset: "USDC/SUI",
    allocationPct: 15,
    amountUsd: 750,
    apy: 12.3,
    tvlUsd: 8_200_000,
    auditGrade: "A",
    iconHint: "lp",
    startedAt: "2026-05-08",
    pnlUsd: 11.4,
    pnlPct: 1.52,
  },
];

export function getPortfolioSummary(positions: PortfolioPosition[]) {
  const totalUsd = positions.reduce((s, p) => s + p.amountUsd, 0);
  const totalPnl = positions.reduce((s, p) => s + p.pnlUsd, 0);
  const blendedApy =
    positions.reduce((s, p) => s + (p.apy * p.amountUsd) / totalUsd, 0) || 0;
  return {
    totalUsd,
    totalPnl,
    blendedApy: Math.round(blendedApy * 100) / 100,
    count: positions.length,
  };
}

export function getHoldingsTotal(balances: TokenBalance[]): number {
  return balances.reduce((s, b) => s + b.usdValue, 0);
}

export function splitPortfolio(positions: PortfolioPosition[]) {
  return {
    vaults: positions.filter((p) => p.kind === "vault" || p.kind === "lend"),
    pools: positions.filter((p) => p.kind === "lp"),
  };
}
