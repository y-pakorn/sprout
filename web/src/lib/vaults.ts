// Fetchers + types for Bluefin's public vault list and per-vault history
// endpoints. Pure data; universal (works on client or server). The
// browser calls these directly — Bluefin's API is public + CORS-open so
// proxying through Next adds no value, just a round-trip.
//
// canonicalCoinType is inlined here (not imported from client-coins.ts)
// so this module stays free of "use client" deps.

function canonicalCoinType(coinType: string): string {
  const segments = coinType.split("::");
  const addr = segments[0];
  if (!addr || !addr.startsWith("0x")) return coinType;
  const hex = addr.slice(2).padStart(64, "0").toLowerCase();
  segments[0] = `0x${hex}`;
  return segments.join("::");
}

const VAULTS_BASE = "https://vaults.api.sui-prod.bluefin.io/api/v2";

export type SuiVault = {
  id: string; // UUID
  objectId: string; // on-chain vault object address on Sui
  name: string;
  longName?: string;
  category: string;
  description?: string;
  logoUrl?: string;
  depositCoinType: string; // canonicalized
  depositSymbol: string;
  depositDecimals: number;
  /** Canonical Move type of the vault's receipt (share) coin. Required
   *  for `deposit_asset_v2`'s R type parameter and for parsing
   *  balanceChanges in the confirmation flow. */
  receiptCoinType: string;
  receiptCoinSymbol?: string;
  /** USD price per receipt token, parsed from receiptCoin.priceE9 / 1e9.
   *  This is Bluefin's own oracle for share value (the 7K aggregator
   *  silently drops vault receipt coins from its /price endpoint, so
   *  this is the only reliable source). */
  receiptCoinPriceUsd?: number;
  apyPct: number; // reportedApyE9 / 1e9 * 100
  tvlUsd: number; // totalDepositsInUsdE9 / 1e9
  totalDepositsRaw: string; // totalDepositsE9 — useful for capacity
  maxDepositsRaw?: string; // maxDepositsAllowedE18
  performanceFeeBps: number; // weeklyPerformanceFeeBpsE9 / 1e5 → bps
  managementFeeBps: number; // managementFeePercentE18 / 1e14 → bps
  minWithdrawalSharesRaw?: string;
  withdrawalPeriodDays?: number;
  paused: boolean;
  isPrivate: boolean;
  isBridgeable?: boolean;
  status?: string;
  strategy?: string;
  /** The vault's risk-profile tag (the one upstream tag with isProfile=true):
   *  principal_protected (Delta-Neutral), balanced, or volatile (Asymmetric). */
  riskProfile?: { slug: string; name: string; description?: string };
  /** Slugs of all non-profile tags (e.g. kyc_required, rwa, deprecated, beta,
   *  private, stablecoin). Risk/availability flags surfaced to agent + UI. */
  flagSlugs: string[];
  /** Active depositor count on Sui — adoption signal. */
  activeDepositors?: number;
  /** On-chain accounts the vault deploys capital into (Fordefi MPC custody),
   *  per chain, with explorer links. `name` is the custodian label. */
  strategyAccounts?: Array<{
    name: string;
    address: string;
    chain?: string;
    explorerUrl?: string;
    isActive: boolean;
  }>;
  apyBreakdown: {
    depositApyPct: number;
    rewardApyPct: number;
    lendingApyPct: number;
    /** Total reportedApy minus lending + rewards — the "alpha" the strategy
     *  earns beyond lending interest and reward emissions (LP fees, basis,
     *  funding, etc.). Always ≥ 0. */
    strategyApyPct: number;
    targetApyPct: number;
  };
  growthPct?: {
    "7d"?: number;
    "30d"?: number;
    "60d"?: number;
    "90d"?: number;
  };
  rewards?: unknown[];
  managers?: unknown[];
};

const E9 = 1_000_000_000;
const E18 = BigInt("1000000000000000000");

function bigToNumDiv(raw: string | undefined, divisor: number): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n / divisor;
}

function pctFromE9(raw: string | undefined): number {
  return bigToNumDiv(raw, E9) * 100;
}

type RawVault = {
  id: string;
  name: string;
  longName?: string;
  category: string;
  description?: string;
  logoUrl?: string;
  status?: string;
  strategy?: string;
  isPrivate?: boolean;
  isBridgeable?: boolean;
  weeklyPerformanceFeeBpsE9?: string;
  managementFeePercentE18?: string;
  maxDepositsAllowedE18?: string;
  totalDepositsE9?: string;
  totalDepositsInUsdE9?: string;
  minWithdrawalSharesE18?: string;
  withdrawalPeriodDays?: number;
  withdrawalPeriod?: number; // sometimes seconds
  reportedApy?: {
    reportedApyE9?: string;
    lendingApyE9?: string;
    rewardApyE9?: string;
    targetApyE9?: string;
  };
  apyAverages?: Record<
    string,
    {
      lendingApyE9?: string;
      reportedApyE9?: string;
      rewardApyE9?: string;
      targetApyE9?: string;
    }
  >;
  tags?: Array<{
    name: string;
    slug: string;
    description?: string;
    isProfile?: boolean;
    logoUrl?: string;
  }>;
  strategyAccounts?: Array<{
    name?: string;
    address?: string;
    explorerUrl?: string;
    isActive?: boolean;
    chain?: { name?: string; type?: string };
  }>;
  rewards?: unknown[];
  managers?: unknown[];
  detailsByChain?: Record<
    string,
    {
      address?: string;
      activeDepositorsCount?: string;
      baseDepositCoin?: {
        address?: string;
        chain?: string;
        decimals?: number;
        symbol?: string;
      };
      receiptCoin?: {
        address?: string;
        symbol?: string;
        decimals?: number;
        priceE9?: string;
      };
    }
  >;
};

export async function getSuiVaults(): Promise<SuiVault[]> {
  const res = await fetch(`${VAULTS_BASE}/vaults?includeHidden=true`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Bluefin vaults API ${res.status}`);
  }
  const raw = (await res.json()) as RawVault[];
  return raw
    .filter((v) => !!v.detailsByChain?.sui?.address)
    .map((v): SuiVault | null => {
      const sui = v.detailsByChain!.sui!;
      const baseCoin = sui.baseDepositCoin;
      if (!sui.address || !baseCoin?.address || !baseCoin.symbol) return null;
      const reported = v.reportedApy ?? {};
      const apyPct = pctFromE9(reported.reportedApyE9);
      const depositApyPct = pctFromE9(reported.lendingApyE9);
      const rewardApyPct = pctFromE9(reported.rewardApyE9);
      const targetApyPct = pctFromE9(reported.targetApyE9);
      const totalDepositsInUsdE9 = v.totalDepositsInUsdE9 ?? "0";
      const tvlUsd = bigToNumDiv(totalDepositsInUsdE9, E9);
      // Withdrawal period: prefer days field if present; otherwise convert seconds.
      let withdrawalPeriodDays: number | undefined =
        typeof v.withdrawalPeriodDays === "number"
          ? v.withdrawalPeriodDays
          : undefined;
      if (
        withdrawalPeriodDays === undefined &&
        typeof v.withdrawalPeriod === "number"
      ) {
        withdrawalPeriodDays = Math.round(v.withdrawalPeriod / 86400);
      }
      // Fees: weeklyPerformanceFeeBpsE9 is bps × 1e9 (so bps = raw / 1e9).
      const performanceFeeBps = bigToNumDiv(
        v.weeklyPerformanceFeeBpsE9,
        E9,
      );
      const managementFeeBps =
        v.managementFeePercentE18 !== undefined
          ? Number(
              BigInt(v.managementFeePercentE18) / (E18 / BigInt(10000)),
            )
          : 0;
      const status = (v.status ?? "").toLowerCase();
      const paused =
        status === "paused" ||
        status === "deprecated" ||
        status === "disabled";
      const tags = v.tags ?? [];
      const profileTag = tags.find((t) => t.isProfile);
      const riskProfile = profileTag
        ? {
            slug: profileTag.slug,
            name: profileTag.name,
            description: profileTag.description,
          }
        : undefined;
      const flagSlugs = Array.from(
        new Set(tags.filter((t) => !t.isProfile).map((t) => t.slug)),
      );
      const depositorsNum = Number(sui.activeDepositorsCount);
      const activeDepositors = Number.isFinite(depositorsNum)
        ? depositorsNum
        : undefined;
      const strategyAccounts = (v.strategyAccounts ?? [])
        .filter((a) => !!a.address)
        .map((a) => ({
          name: a.name ?? "Strategy account",
          address: a.address!,
          chain: a.chain?.name,
          explorerUrl: a.explorerUrl,
          isActive: a.isActive ?? false,
        }));
      return {
        id: v.id,
        objectId: sui.address,
        name: v.name,
        longName: v.longName,
        category: v.category,
        description: v.description,
        logoUrl: v.logoUrl,
        depositCoinType: canonicalCoinType(baseCoin.address),
        depositSymbol: baseCoin.symbol,
        depositDecimals: baseCoin.decimals ?? 9,
        receiptCoinType: sui.receiptCoin?.address
          ? canonicalCoinType(sui.receiptCoin.address)
          : "",
        receiptCoinSymbol: sui.receiptCoin?.symbol,
        receiptCoinPriceUsd: sui.receiptCoin?.priceE9
          ? bigToNumDiv(sui.receiptCoin.priceE9, E9)
          : undefined,
        apyPct,
        tvlUsd,
        totalDepositsRaw: v.totalDepositsE9 ?? "0",
        maxDepositsRaw: v.maxDepositsAllowedE18,
        performanceFeeBps,
        managementFeeBps,
        minWithdrawalSharesRaw: v.minWithdrawalSharesE18,
        withdrawalPeriodDays,
        paused,
        isPrivate: !!v.isPrivate,
        isBridgeable: v.isBridgeable,
        status: v.status,
        strategy: v.strategy,
        riskProfile,
        flagSlugs,
        activeDepositors,
        strategyAccounts,
        apyBreakdown: {
          depositApyPct,
          rewardApyPct,
          lendingApyPct: depositApyPct,
          // Whatever the headline APY shows that isn't already in lending +
          // rewards is strategy alpha (LP fees, funding, basis, etc.).
          strategyApyPct: Math.max(
            0,
            apyPct - depositApyPct - rewardApyPct,
          ),
          targetApyPct,
        },
        rewards: v.rewards,
        managers: v.managers,
      };
    })
    .filter((v): v is SuiVault => v !== null)
    .sort((a, b) => b.apyPct - a.apyPct);
}

export type VaultHistoryMetric = "apy" | "tvl" | "pnl" | "share-price";

const METRIC_PATH: Record<VaultHistoryMetric, string> = {
  apy: "apy-history",
  tvl: "tvl-history",
  pnl: "pnl-history",
  "share-price": "share-price-history",
};

export type VaultHistoryPoint = {
  timestamp: number;
  /** Primary numeric value, already converted from E9 to a percent / share-price / USD as appropriate */
  value: number;
  /** Optional secondary series (only for APY: deposit vs reward) */
  rewardValue?: number;
  targetValue?: number;
};

export type VaultHistoryResponse = {
  metric: VaultHistoryMetric;
  points: VaultHistoryPoint[];
  /** Aggregate stats for APY only */
  averages?: {
    "7d"?: number;
    "30d"?: number;
    "60d"?: number;
    "90d"?: number;
  };
};

export async function fetchVaultHistory(
  vaultId: string,
  metric: VaultHistoryMetric,
  limit = 100,
  interval = "1d",
): Promise<VaultHistoryResponse> {
  const url = `${VAULTS_BASE}/vaults/${METRIC_PATH[metric]}/${vaultId}?limit=${limit}&interval=${interval}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Bluefin ${metric} history ${res.status}`);
  const raw = await res.json();
  if (metric === "apy") {
    const list = (raw.data ?? []) as Array<{
      apyE9?: string;
      rewardApyE9?: string;
      targetApyE9?: string;
      timestamp: number;
    }>;
    return {
      metric,
      points: list
        .map((p) => ({
          timestamp: p.timestamp,
          value: pctFromE9(p.apyE9),
          rewardValue: pctFromE9(p.rewardApyE9),
          targetValue: pctFromE9(p.targetApyE9),
        }))
        .sort((a, b) => a.timestamp - b.timestamp),
      averages: {
        "7d": pctFromE9(raw.avg7dTotalApyE9),
        "30d": pctFromE9(raw.avg30dTotalApyE9),
        "60d": pctFromE9(raw.avg60dTotalApyE9),
        "90d": pctFromE9(raw.avg90dTotalApyE9),
      },
    };
  }
  if (metric === "share-price") {
    const list = (raw as Array<{ sharePriceE9?: string; timestamp: number }>) ?? [];
    return {
      metric,
      points: list
        .map((p) => ({
          timestamp: p.timestamp,
          value: bigToNumDiv(p.sharePriceE9, E9),
        }))
        .sort((a, b) => a.timestamp - b.timestamp),
    };
  }
  if (metric === "tvl") {
    const list =
      (raw as Array<{
        tvlUsdE9?: string;
        tvlInCoinAmountE9?: string;
        tvlByChain?: Array<{ chain: string; tvlUsdE9?: string }>;
        timestamp: number;
      }>) ?? [];
    return {
      metric,
      points: list
        .map((p) => {
          // Prefer the Sui-specific entry when the response is multi-chain.
          const suiChain = p.tvlByChain?.find((c) => c.chain === "sui");
          const raw = suiChain?.tvlUsdE9 ?? p.tvlUsdE9;
          return {
            timestamp: p.timestamp,
            value: bigToNumDiv(raw, E9),
          };
        })
        .sort((a, b) => a.timestamp - b.timestamp),
    };
  }
  // pnl
  const list =
    (raw as Array<{ pnlE9?: string; timestamp: number }>) ?? [];
  return {
    metric,
    points: list
      .map((p) => ({ timestamp: p.timestamp, value: bigToNumDiv(p.pnlE9, E9) }))
      .sort((a, b) => a.timestamp - b.timestamp),
  };
}

/* ────────────────────────────────────────────────────────────────
 * Vault deployment info — package id, ProtocolConfig shared object,
 * and per-vault on-chain ids. Needed to build deposit_asset_v2 move
 * calls ourselves (no SDK).
 * ──────────────────────────────────────────────────────────────── */

export type VaultDeploymentEntry = {
  name: string;
  receiptCoinType: string;
  depositCoinType: string;
  depositCoinDecimals: number;
};

export type VaultDeployment = {
  /** Move package id (matches `0x4269cb…aed809f` on mainnet) */
  packageId: string;
  /** &ProtocolConfig shared object id */
  protocolConfigId: string;
  /** Indexed by vault ObjectId — fallback source for receipt + deposit types. */
  vaultsByObjectId: Record<string, VaultDeploymentEntry>;
};

type RawDeploymentVault = {
  Name: string;
  ObjectId: string;
  DepositCoinType: string;
  ReceiptCoinType: string;
  DepositCoinDecimals: number;
};

type RawDeploymentChain = {
  chain: string;
  config: {
    VaultProtocol: {
      Package: string;
      ProtocolConfig: string;
    };
    Vaults: Record<string, RawDeploymentVault>;
  };
};

export async function fetchVaultDeployment(): Promise<VaultDeployment> {
  const res = await fetch(`${VAULTS_BASE}/vaults/info`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bluefin vaults/info ${res.status}`);
  const raw = (await res.json()) as RawDeploymentChain[];
  const sui = raw.find((c) => c.chain === "sui");
  if (!sui) throw new Error("No Sui deployment in /vaults/info");
  const vp = sui.config.VaultProtocol;
  const vaultsByObjectId: VaultDeployment["vaultsByObjectId"] = {};
  for (const v of Object.values(sui.config.Vaults)) {
    vaultsByObjectId[v.ObjectId] = {
      name: v.Name,
      receiptCoinType: canonicalCoinType(v.ReceiptCoinType),
      depositCoinType: canonicalCoinType(v.DepositCoinType),
      depositCoinDecimals: v.DepositCoinDecimals,
    };
  }
  return {
    packageId: vp.Package,
    protocolConfigId: vp.ProtocolConfig,
    vaultsByObjectId,
  };
}
