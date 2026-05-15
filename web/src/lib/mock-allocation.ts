import type { IntentInput } from "./intent";

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

export type AllocationStepKind = "swap" | "deposit";

export type AllocationStep = {
  id: string;
  index: number;
  kind: AllocationStepKind;
  label: string;
  legs: AllocationLeg[];
};

export type Allocation = {
  legs: AllocationLeg[];
  steps: AllocationStep[];
  blendedApy: number;
  totalUsd: number;
  estimatedAnnualUsd: number;
  estimatedGasUsd: number;
  primaryIntent: "swap" | "yield" | "mixed";
};

const POOL: Omit<AllocationLeg, "allocationPct" | "amountUsd" | "id">[] = [
  {
    kind: "lend",
    venue: "Suilend",
    description: "main money market",
    asset: "USDC",
    apy: 5.8,
    tvlUsd: 42_300_000,
    auditGrade: "A",
    iconHint: "lend",
  },
  {
    kind: "lend",
    venue: "NAVI Protocol",
    description: "isolated supply pool",
    asset: "USDC",
    apy: 6.2,
    tvlUsd: 38_500_000,
    auditGrade: "A",
    iconHint: "lend",
  },
  {
    kind: "lend",
    venue: "Scallop",
    description: "boosted SCA rewards",
    asset: "USDC",
    apy: 7.1,
    tvlUsd: 24_100_000,
    auditGrade: "B+",
    iconHint: "lend",
  },
  {
    kind: "lend",
    venue: "Bucket Protocol",
    description: "CDP-backed reserve",
    asset: "USDC",
    apy: 5.5,
    tvlUsd: 18_700_000,
    auditGrade: "A",
    iconHint: "lend",
  },
  {
    kind: "lp",
    venue: "Cetus",
    description: "CLMM, tight range",
    asset: "USDC/SUI",
    pair: "USDC/SUI",
    pairAssets: ["USDC", "SUI"],
    feeTier: 0.25,
    ilRisk: "moderate",
    apy: 12.3,
    tvlUsd: 8_200_000,
    auditGrade: "A",
    iconHint: "lp",
  },
  {
    kind: "lp",
    venue: "FlowX",
    description: "concentrated liquidity",
    asset: "USDC/WAL",
    pair: "USDC/WAL",
    pairAssets: ["USDC", "WAL"],
    feeTier: 0.3,
    ilRisk: "high",
    apy: 14.8,
    tvlUsd: 3_900_000,
    auditGrade: "B+",
    iconHint: "lp",
  },
  {
    kind: "vault",
    venue: "Ember Finance",
    description: "delta-neutral USDC",
    asset: "USDC",
    vaultName: "USDC Delta-Neutral",
    curator: "Block Asset Mgmt",
    strategy: "Perp basis + spot lending, weekly rebalance",
    lockDays: 0,
    apy: 9.4,
    tvlUsd: 15_200_000,
    auditGrade: "B+",
    iconHint: "vault",
  },
  {
    kind: "vault",
    venue: "Ember Finance",
    description: "structured basis vault",
    asset: "USDC",
    vaultName: "Bluefin Basis Vault",
    curator: "Bluefin",
    strategy: "Long perp basis on BTC + ETH, monthly settle",
    lockDays: 30,
    apy: 11.2,
    tvlUsd: 6_800_000,
    auditGrade: "B+",
    iconHint: "vault",
  },
];

function detectIntentKind(intent: IntentInput): "swap" | "yield" | "mixed" {
  const c = (intent.rawText || intent.constraints).toLowerCase();
  const hasSwap = intent.toAsset || /swap|exchange|convert|trade|→/.test(c);
  const hasYield =
    /\b(apr|apy|yield|earn|deposit|stake|vault|highest|safest|diversif|lp|pool)\b/.test(
      c,
    ) || /\b\d+\s*%/.test(c);
  if (hasSwap && hasYield) return "mixed";
  if (hasSwap) return "swap";
  return "yield";
}

// USD-pegged mock prices per token
const USD_PRICES: Record<string, number> = {
  USDC: 1,
  USDT: 1,
  SUI: 1.05,
  WAL: 0.25,
  DEEP: 0.049,
  BUCK: 1,
};

function swapRate(from: string, to: string): number {
  const f = USD_PRICES[from] ?? 1;
  const t = USD_PRICES[to] ?? 1;
  return (f / t) * 0.997;
}

function buildSwapLeg(
  intent: IntentInput,
  fromAsset: string,
  toAsset: string,
  amount: number,
  id: string,
): AllocationLeg {
  const rate = swapRate(fromAsset, toAsset);
  const _ = intent;
  return {
    id,
    kind: "swap",
    venue: "7K Aggregator",
    description: "Routed across Cetus, Aftermath, FlowX",
    asset: "—",
    apy: 0,
    tvlUsd: 0,
    auditGrade: "A",
    iconHint: "swap",
    route: ["Cetus", "Aftermath"],
    slippageBps: 30,
    allocationPct: 100,
    amountUsd: amount,
    fromAsset,
    toAsset,
    fromAmount: amount,
    toAmount: amount * rate,
  };
}

function pickYieldLegs(intent: IntentInput, totalAmount: number) {
  const { risk, targetApy } = intent;
  const sorted = [...POOL].sort((a, b) => a.apy - b.apy);
  let chosen: typeof sorted = [];

  if (risk === 0) {
    chosen = sorted.filter((p) => p.auditGrade === "A" && p.kind === "lend").slice(0, 3);
  } else if (risk === 1) {
    chosen = [
      ...sorted.filter((p) => p.kind === "lend" && p.apy >= 5).slice(0, 2),
      ...sorted.filter((p) => p.kind === "vault" && p.auditGrade !== "C").slice(0, 1),
    ];
  } else if (risk === 2) {
    chosen = [
      ...sorted.filter((p) => p.kind === "lend").slice(-1),
      ...sorted.filter((p) => p.kind === "vault").slice(0, 1),
      ...sorted.filter((p) => p.kind === "lp").slice(0, 1),
    ];
  } else {
    chosen = [
      ...sorted.filter((p) => p.kind === "lp"),
      ...sorted.filter((p) => p.kind === "vault").slice(-1),
    ].slice(0, 3);
  }

  if (chosen.length === 0) chosen = sorted.slice(0, 3);

  const weights = chosen.map((leg, i) => {
    const apyBoost = leg.apy >= targetApy ? 1.25 : 1;
    const positionBoost = chosen.length === 3 ? [0.45, 0.32, 0.23][i] : 1 / chosen.length;
    return apyBoost * positionBoost;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);

  return chosen.map((leg, i) => {
    const pct = weights[i] / weightSum;
    return {
      ...leg,
      id: `yield-${leg.venue}-${i}`,
      allocationPct: Math.round(pct * 1000) / 10,
      amountUsd: Math.round(totalAmount * pct * 100) / 100,
    } as AllocationLeg;
  });
}

function blendedApyOf(legs: AllocationLeg[]): number {
  const yielding = legs.filter((l) => l.kind !== "swap");
  const total = yielding.reduce((s, l) => s + l.amountUsd, 0);
  if (total === 0) return 0;
  const blended = yielding.reduce(
    (s, l) => s + (l.apy * l.amountUsd) / total,
    0,
  );
  return Math.round(blended * 100) / 100;
}

export function buildMockAllocation(intent: IntentInput): Allocation {
  const { amount } = intent;
  const kind = detectIntentKind(intent);

  // PURE SWAP — one swap leg, one step
  if (kind === "swap") {
    const fromAsset = intent.asset;
    const toAsset =
      intent.toAsset ??
      (fromAsset === "USDC" ? "SUI" : fromAsset === "SUI" ? "USDC" : "USDC");
    const leg = buildSwapLeg(intent, fromAsset, toAsset, amount, "swap-0");
    return {
      legs: [leg],
      steps: [
        {
          id: "step-1",
          index: 1,
          kind: "swap",
          label: `Swap ${fromAsset} → ${toAsset}`,
          legs: [leg],
        },
      ],
      blendedApy: 0,
      totalUsd: amount,
      estimatedAnnualUsd: 0,
      estimatedGasUsd: 0.018,
      primaryIntent: "swap",
    };
  }

  // MIXED — swap first, then deploy across yield venues
  if (kind === "mixed") {
    const fromAsset = intent.asset;
    const toAsset =
      intent.toAsset ??
      (fromAsset === "USDC" ? "SUI" : fromAsset === "SUI" ? "USDC" : "USDC");
    const swapLeg = buildSwapLeg(intent, fromAsset, toAsset, amount, "swap-0");
    const yieldLegs = pickYieldLegs(intent, amount).map((l) => ({
      ...l,
      asset: toAsset,
      description: `${toAsset} ${l.description}`,
    }));
    const legs = [swapLeg, ...yieldLegs];
    return {
      legs,
      steps: [
        {
          id: "step-1",
          index: 1,
          kind: "swap",
          label: `Swap ${fromAsset} → ${toAsset}`,
          legs: [swapLeg],
        },
        {
          id: "step-2",
          index: 2,
          kind: "deposit",
          label:
            yieldLegs.length === 1
              ? `Deposit ${toAsset}`
              : `Diversify across ${yieldLegs.length} ${toAsset} venues`,
          legs: yieldLegs,
        },
      ],
      blendedApy: blendedApyOf(legs),
      totalUsd: amount,
      estimatedAnnualUsd: Math.round(((amount * blendedApyOf(legs)) / 100) * 100) / 100,
      estimatedGasUsd: 0.028 + yieldLegs.length * 0.008,
      primaryIntent: "mixed",
    };
  }

  // PURE YIELD — N parallel deposits, one step
  const yieldLegs = pickYieldLegs(intent, amount);
  return {
    legs: yieldLegs,
    steps: [
      {
        id: "step-1",
        index: 1,
        kind: "deposit",
        label:
          yieldLegs.length === 1
            ? `Deposit ${intent.asset}`
            : `Diversify across ${yieldLegs.length} venues`,
        legs: yieldLegs,
      },
    ],
    blendedApy: blendedApyOf(yieldLegs),
    totalUsd: amount,
    estimatedAnnualUsd:
      Math.round(((amount * blendedApyOf(yieldLegs)) / 100) * 100) / 100,
    estimatedGasUsd: 0.02 + yieldLegs.length * 0.008,
    primaryIntent: "yield",
  };
}
