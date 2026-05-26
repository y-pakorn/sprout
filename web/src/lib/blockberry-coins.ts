// Coin directory / metadata / holders types + normalizers for Blockberry's
// getCoins, getCoinMetadata, getHoldersByCoinType endpoints. Pure (no React, no
// secrets, NOT server-only) — shared by the proxy routes and the result cards.
// Amounts arrive pre-decimalized (USD + token), so no coin-map humanization.

/** Loose coin-type check: 0x<hex>::<module>::<TYPE>. */
export function isCoinType(s: string): boolean {
  return /^0x[0-9a-fA-F]+::[a-zA-Z0-9_]+::[a-zA-Z0-9_]+$/.test(s);
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Spring-page envelope (the fields we use). */
export type SpringPage<T> = {
  content: T[] | null;
  last?: boolean;
  totalElements?: number;
};

// ---- getCoins --------------------------------------------------------------

export type CoinListItem = {
  coinType: string;
  name: string;
  symbol: string;
  decimals: number;
  imgUrl?: string;
  price?: number;
  marketCap?: number;
  volume?: number;
  holdersCount?: number;
  dominance?: number;
  isVerified: boolean;
  isBridged: boolean;
};

type RawCoinListItem = {
  coinType: string;
  coinName: string | null;
  coinDenom: string | null;
  coinSymbol: string | null;
  decimals: number | null;
  imgUrl: string | null;
  price: number | null;
  marketCap: number | null;
  totalVolume: number | null;
  holdersCount: number | null;
  dominance: number | null;
  isVerified: boolean | null;
  isBridged: boolean | null;
};

export function normalizeCoinListItem(r: RawCoinListItem): CoinListItem {
  return {
    coinType: r.coinType,
    name: r.coinName ?? r.coinSymbol ?? r.coinDenom ?? "?",
    symbol: r.coinSymbol ?? r.coinDenom ?? "?",
    decimals: r.decimals ?? 9,
    imgUrl: r.imgUrl ?? undefined,
    price: num(r.price),
    marketCap: num(r.marketCap),
    volume: num(r.totalVolume),
    holdersCount: r.holdersCount ?? undefined,
    dominance: num(r.dominance),
    isVerified: !!r.isVerified,
    isBridged: !!r.isBridged,
  };
}

// ---- getCoinMetadata -------------------------------------------------------

export type CoinMetadata = {
  coinType: string;
  name: string;
  symbol: string;
  decimals: number;
  imgUrl?: string;
  description?: string;
  totalSupply?: number;
  circulatingSupply?: number;
  marketCap?: number;
  volume?: number;
  socials: {
    website?: string;
    twitter?: string;
    discord?: string;
    github?: string;
    telegram?: string;
  };
};

type RawCoinMetadata = {
  coinType: string | null;
  coinName: string | null;
  coinSymbol: string | null;
  decimals: number | null;
  imgUrl: string | null;
  description: string | null;
  totalSupply: number | null;
  circulatingSupply: number | null;
  marketCap: number | null;
  volume: number | null;
  socialWebsite: string | null;
  socialTwitter: string | null;
  socialDiscord: string | null;
  socialGitHub: string | null;
  socialTelegram: string | null;
};

export function normalizeCoinMetadata(
  r: RawCoinMetadata,
  coinTypeFallback: string,
): CoinMetadata {
  const socials: CoinMetadata["socials"] = {};
  if (r.socialWebsite) socials.website = r.socialWebsite;
  if (r.socialTwitter) socials.twitter = r.socialTwitter;
  if (r.socialDiscord) socials.discord = r.socialDiscord;
  if (r.socialGitHub) socials.github = r.socialGitHub;
  if (r.socialTelegram) socials.telegram = r.socialTelegram;
  return {
    coinType: r.coinType ?? coinTypeFallback,
    name: r.coinName ?? r.coinSymbol ?? "?",
    symbol: r.coinSymbol ?? "?",
    decimals: r.decimals ?? 9,
    imgUrl: r.imgUrl ?? undefined,
    description: r.description?.trim() || undefined,
    totalSupply: num(r.totalSupply),
    circulatingSupply: num(r.circulatingSupply),
    marketCap: num(r.marketCap),
    volume: num(r.volume),
    socials,
  };
}

// ---- getHoldersByCoinType --------------------------------------------------

export type CoinHolder = {
  address: string;
  name?: string;
  imgUrl?: string;
  amount: number;
  usdAmount?: number;
  percentage?: number;
  symbol: string;
};

type RawCoinHolder = {
  holderAddress: string;
  holderName: string | null;
  holderImg: string | null;
  coinDenom: string | null;
  amount: number | null;
  usdAmount: number | null;
  percentage: number | null;
};

export function normalizeCoinHolder(r: RawCoinHolder): CoinHolder {
  return {
    address: r.holderAddress,
    name: r.holderName ?? undefined,
    imgUrl: r.holderImg ?? undefined,
    amount: num(r.amount) ?? 0,
    usdAmount: num(r.usdAmount),
    percentage: num(r.percentage),
    symbol: r.coinDenom ?? "?",
  };
}

export type { RawCoinListItem, RawCoinMetadata, RawCoinHolder };
