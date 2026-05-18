// Server-side fetchers for the user's Ember vault balance: active vault
// positions + pending withdrawal requests + recent vault history.
// Bluefin's vault API is CORS-locked to https://trade.bluefin.io, so all
// three endpoints have to be proxied through our Next API. The shapes
// returned here are the normalized (decimal-friendly) versions of the
// upstream payloads.

const VAULTS_BASE = "https://vaults.api.sui-prod.bluefin.io/api/v2";

// ─────────────────────────────────────────────────────────
// Normalized output types
// ─────────────────────────────────────────────────────────

/** A vault position is now built on the client by filtering the user's
 *  wallet token balances against the vault list — every receipt-coin
 *  balance is a vault position. Vault metadata is inlined so the UI
 *  doesn't need to re-join against /api/vaults. */
export type VaultBalancePosition = {
  vaultId: string;
  vaultName: string;
  vaultLogoUrl?: string;
  depositSymbol: string;
  depositCoinType: string;
  apyPct: number;
  category?: string;
  withdrawalPeriodDays?: number;
  /** Receipt-token info. */
  receiptCoinType: string;
  receiptCoinSymbol?: string;
  receiptPriceUsd: number;
  /** Human-scaled share count from the wallet. */
  shares: number;
  /** shares × receiptPriceUsd, in USD. */
  positionValueUsd: number;
};

export type CoinDescriptor = {
  address: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  /** USD price as a float (priceE9 / 1e9). */
  priceUsd: number;
};

export type VaultDescriptor = {
  id: string;
  address: string;
  name: string;
  logoUrl?: string;
  publicType?: string;
};

export type VaultBalanceWithdrawal = {
  vault: VaultDescriptor;
  depositCoin: CoinDescriptor;
  receiptCoin: CoinDescriptor;
  status: string; // "Pending" | ...
  /** Shares the user committed to redeem. Human units. */
  requestedShares: number;
  /** Deposit-coin amount already paid out (0 until processed). Human. */
  withdrawnAmount: number;
  requestedAt: number; // ms
  updatedAt: number;
  txDigest: string;
  sequenceNumber: string;
};

export type VaultBalanceHistoryDeposit = {
  type: "Deposit";
  vault: VaultDescriptor;
  depositCoin: CoinDescriptor;
  receiptCoin: CoinDescriptor;
  depositAmount: number; // human, deposit decimals
  receivedShares: number; // human, share decimals
  timestamp: number;
  txDigest: string;
  sequenceNumber: string;
};

export type VaultBalanceHistoryRedeemRequest = {
  type: "RedeemRequest";
  vault: VaultDescriptor;
  receiptCoin: CoinDescriptor;
  /** Shares submitted for redemption. Human units (share decimals). */
  shares: number;
  timestamp: number;
  txDigest: string;
  sequenceNumber: string;
};

export type VaultBalanceHistoryRedeemProcessed = {
  type: "RedeemRequestProcessed";
  vault: VaultDescriptor;
  receiptCoin: CoinDescriptor;
  receivedCoin: CoinDescriptor;
  /** Deposit-coin amount the user received. Human. */
  receivedAmount: number;
  /** Shares burned. Human. */
  redeemedShares: number;
  timestamp: number;
  txDigest: string;
  sequenceNumber: string;
};

export type VaultBalanceHistoryItem =
  | VaultBalanceHistoryDeposit
  | VaultBalanceHistoryRedeemRequest
  | VaultBalanceHistoryRedeemProcessed
  | { type: "Unknown"; raw: unknown };

/** Server-fetched portion: withdrawals + history. Positions are derived
 *  from the wallet's on-chain receipt-token balances on the client. */
export type VaultBalanceServerData = {
  address: string;
  withdrawals: VaultBalanceWithdrawal[];
  history: VaultBalanceHistoryItem[];
  fetchedAt: number;
};

/** Complete payload shipped to the UI. Positions are added client-side. */
export type VaultBalance = VaultBalanceServerData & {
  positions: VaultBalancePosition[];
};

// ─────────────────────────────────────────────────────────
// Raw upstream shapes (only what we read)
// ─────────────────────────────────────────────────────────

type RawCoin = {
  address: string;
  chain: string;
  decimals: number;
  logoUrl?: string;
  name?: string;
  priceE9?: string;
  symbol: string;
  type?: string;
};

type RawVaultRef = {
  address: string;
  id: string;
  logoUrl?: string;
  longName?: string;
  name: string;
  publicType?: string;
};

type RawWithdrawal = {
  chain: string;
  depositCoin: RawCoin;
  receiptCoin: RawCoin;
  receiverAddress: string;
  requestedAgainstShares: string;
  requestedAt: number;
  sequenceNumber: string;
  status: string;
  txDigest: string;
  updatedAt: number;
  vault: RawVaultRef;
  withdrawnAmount: string;
};

type RawHistoryItem = {
  chain: string;
  transactionType: string;
  transactionData: Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

const E9 = 1_000_000_000;

function toNum(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function fromRaw(raw: string | undefined, decimals: number): number {
  if (!raw) return 0;
  return toNum(raw) / 10 ** decimals;
}

function fromE9(raw: string | undefined): number {
  return toNum(raw) / E9;
}

function mapCoin(c: RawCoin): CoinDescriptor {
  return {
    address: c.address,
    symbol: c.symbol,
    decimals: c.decimals,
    logoUrl: c.logoUrl,
    priceUsd: fromE9(c.priceE9),
  };
}

function mapVault(v: RawVaultRef): VaultDescriptor {
  return {
    id: v.id,
    address: v.address,
    name: v.name,
    logoUrl: v.logoUrl,
    publicType: v.publicType,
  };
}

// ─────────────────────────────────────────────────────────
// Fetchers
// ─────────────────────────────────────────────────────────

export async function fetchVaultWithdrawals(
  address: string,
  opts: { startMs?: number; endMs?: number; limit?: number; page?: number } = {},
): Promise<VaultBalanceWithdrawal[]> {
  const startMs = opts.startMs ?? Date.now() - 365 * 24 * 60 * 60 * 1000;
  const endMs = opts.endMs ?? Date.now();
  const limit = opts.limit ?? 100;
  const page = opts.page ?? 1;
  const url =
    `${VAULTS_BASE}/vaults/withdrawal-requests/${address}` +
    `?startTimeInMs=${startMs}&endTimeInMs=${endMs}&limit=${limit}&page=${page}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`withdrawals ${res.status}`);
  const raw = (await res.json()) as RawWithdrawal[];
  return raw.map((w) => ({
    vault: mapVault(w.vault),
    depositCoin: mapCoin(w.depositCoin),
    receiptCoin: mapCoin(w.receiptCoin),
    status: w.status,
    requestedShares: fromRaw(w.requestedAgainstShares, w.receiptCoin.decimals),
    withdrawnAmount: fromRaw(w.withdrawnAmount, w.depositCoin.decimals),
    requestedAt: w.requestedAt,
    updatedAt: w.updatedAt,
    txDigest: w.txDigest,
    sequenceNumber: w.sequenceNumber,
  }));
}

export async function fetchVaultHistory(
  address: string,
  opts: { startMs?: number; endMs?: number; limit?: number; page?: number } = {},
): Promise<VaultBalanceHistoryItem[]> {
  const startMs = opts.startMs ?? Date.now() - 365 * 24 * 60 * 60 * 1000;
  const endMs = opts.endMs ?? Date.now();
  const limit = opts.limit ?? 100;
  const page = opts.page ?? 1;
  const url =
    `${VAULTS_BASE}/vaults/history/${address}` +
    `?startTimeInMs=${startMs}&endTimeInMs=${endMs}&limit=${limit}&page=${page}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`history ${res.status}`);
  const raw = (await res.json()) as RawHistoryItem[];
  return raw.map((item): VaultBalanceHistoryItem => {
    const d = item.transactionData;
    switch (item.transactionType) {
      case "Deposit": {
        const depositCoin = mapCoin(d.depositCoin as RawCoin);
        const receiptCoin = mapCoin(d.receivedCoin as RawCoin);
        return {
          type: "Deposit",
          vault: mapVault(d.vault as RawVaultRef),
          depositCoin,
          receiptCoin,
          depositAmount: fromRaw(d.depositAmount as string, depositCoin.decimals),
          receivedShares: fromRaw(
            d.receivedSharesAmount as string,
            receiptCoin.decimals,
          ),
          timestamp: toNum(d.timestamp as number),
          txDigest: d.txDigest as string,
          sequenceNumber: d.sequenceNumber as string,
        };
      }
      case "RedeemRequest": {
        const receiptCoin = mapCoin(d.coin as RawCoin);
        return {
          type: "RedeemRequest",
          vault: mapVault(d.vault as RawVaultRef),
          receiptCoin,
          shares: fromRaw(d.amount as string, receiptCoin.decimals),
          timestamp: toNum(d.timestamp as number),
          txDigest: d.txDigest as string,
          sequenceNumber: d.sequenceNumber as string,
        };
      }
      case "RedeemRequestProcessed": {
        const receiptCoin = mapCoin(d.redeemCoin as RawCoin);
        const receivedCoin = mapCoin(d.receivedCoin as RawCoin);
        return {
          type: "RedeemRequestProcessed",
          vault: mapVault(d.vault as RawVaultRef),
          receiptCoin,
          receivedCoin,
          receivedAmount: fromRaw(
            d.receivedAmount as string,
            receivedCoin.decimals,
          ),
          redeemedShares: fromRaw(
            d.redeemSharesAmount as string,
            receiptCoin.decimals,
          ),
          timestamp: toNum(d.timestamp as number),
          txDigest: d.txDigest as string,
          sequenceNumber: d.sequenceNumber as string,
        };
      }
      default:
        return { type: "Unknown", raw: item };
    }
  });
}

/** Server-only fetch: withdrawals + history. Positions are derived on
 *  the client from the wallet's on-chain receipt-token balances. */
export async function fetchVaultBalanceServerData(
  address: string,
): Promise<VaultBalanceServerData> {
  const [withdrawals, history] = await Promise.all([
    fetchVaultWithdrawals(address).catch(() => []),
    fetchVaultHistory(address).catch(() => []),
  ]);
  return {
    address,
    withdrawals,
    history,
    fetchedAt: Date.now(),
  };
}
