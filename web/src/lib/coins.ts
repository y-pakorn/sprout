import "server-only";

/**
 * Sui coin metadata, sourced from Bluefin's tokens API.
 * Endpoint: https://swap.api.sui-prod.bluefin.io/api/v1/tokens/info?sort=volume24h
 */
export type SuiCoin = {
  coin_type: string;
  decimals: number;
  name: string;
  symbol: string;
  icon_url?: string;
  verified: boolean;
};

type BluefinTokenInfo = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  isVerified: boolean;
  circulatingSupply?: string;
  totalSupply?: string;
  hasBluefinPools?: boolean;
  tags?: string[];
};

const BLUEFIN_TOKENS_URL =
  "https://swap.api.sui-prod.bluefin.io/api/v1/tokens/info?sort=volume24h";

/**
 * Canonical coin_type for popular symbols. When the upstream coin list
 * has multiple coins claiming the same symbol (native USDC vs Wormhole
 * wrapped USDC, etc.), this picks the canonical one regardless of order.
 */
const CANONICAL_BY_SYMBOL: Record<string, string> = {
  SUI: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
  USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  DEEP: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
  WAL: "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL",
};

/**
 * Symbol aliases — when the user types one of these, treat it as the value.
 * E.g. Bluefin returns "suiUSDT" but users will type "USDT".
 */
const SYMBOL_ALIASES: Record<string, string> = {
  USDT: "suiUSDT",
};

/** Synthetic fallback metadata for canonical coins that may be absent upstream. */
const CANONICAL_META: Record<string, SuiCoin> = {
  SUI: {
    coin_type: CANONICAL_BY_SYMBOL.SUI,
    decimals: 9,
    name: "Sui",
    symbol: "SUI",
    icon_url:
      "https://imagedelivery.net/cBNDGgkrsEA-b_ixIp9SkQ/sui-coin.svg/public",
    verified: true,
  },
  USDC: {
    coin_type: CANONICAL_BY_SYMBOL.USDC,
    decimals: 6,
    name: "USD Coin",
    symbol: "USDC",
    icon_url: "https://circle.com/usdc-icon",
    verified: true,
  },
  DEEP: {
    coin_type: CANONICAL_BY_SYMBOL.DEEP,
    decimals: 6,
    name: "DeepBook",
    symbol: "DEEP",
    verified: true,
  },
  WAL: {
    coin_type: CANONICAL_BY_SYMBOL.WAL,
    decimals: 9,
    name: "Walrus",
    symbol: "WAL",
    verified: true,
  },
};

function normalizeType(t: string): string {
  return t.replace(
    /^0x0*([0-9a-fA-F]+)/,
    (_, addr) => `0x${addr.padStart(64, "0")}`,
  );
}

function mapBluefin(t: BluefinTokenInfo): SuiCoin {
  return {
    coin_type: t.address,
    decimals: t.decimals,
    name: t.name,
    symbol: t.symbol,
    icon_url: t.logoURI,
    verified: !!t.isVerified,
  };
}

export async function fetchBluefinTokens(): Promise<SuiCoin[]> {
  const res = await fetch(BLUEFIN_TOKENS_URL, {
    // Always fetch fresh while we're iterating — re-enable revalidate once stable
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Bluefin tokens: ${res.status} ${res.statusText}`,
    );
  }
  const raw = (await res.json()) as BluefinTokenInfo[];
  return raw.map(mapBluefin);
}

type CoinIndex = {
  bySymbol: Map<string, SuiCoin>;
  byType: Map<string, SuiCoin>;
  list: SuiCoin[];
};

// In-process cache; disabled during iteration so changes show up immediately.
// Set to non-null to re-enable per-process memoization.
let indexPromise: Promise<CoinIndex> | null = null;
const ENABLE_PROCESS_CACHE = false;

function pickBetter(
  symbol: string,
  existing: SuiCoin | undefined,
  candidate: SuiCoin,
): SuiCoin {
  if (!existing) return candidate;

  const canonical = CANONICAL_BY_SYMBOL[symbol];
  if (canonical) {
    const candNorm = normalizeType(candidate.coin_type);
    const existNorm = normalizeType(existing.coin_type);
    const canonNorm = normalizeType(canonical);
    if (candNorm === canonNorm) return candidate;
    if (existNorm === canonNorm) return existing;
  }

  if (candidate.verified && !existing.verified) return candidate;
  if (existing.verified && !candidate.verified) return existing;

  const symUpper = symbol.toUpperCase();
  const candNameUpper = candidate.name.toUpperCase();
  const existNameUpper = existing.name.toUpperCase();
  const candMatch =
    candNameUpper === symUpper || candNameUpper.includes(symUpper);
  const existMatch =
    existNameUpper === symUpper || existNameUpper.includes(symUpper);
  if (candMatch && !existMatch) return candidate;
  if (existMatch && !candMatch) return existing;

  return existing;
}

export function getCoinIndex(): Promise<CoinIndex> {
  if (!ENABLE_PROCESS_CACHE || !indexPromise) {
    indexPromise = fetchBluefinTokens().then((list) => {
      const bySymbol = new Map<string, SuiCoin>();
      const byType = new Map<string, SuiCoin>();

      for (const coin of list) {
        byType.set(coin.coin_type, coin);
        const sym = coin.symbol.toUpperCase();
        bySymbol.set(sym, pickBetter(sym, bySymbol.get(sym), coin));
      }

      // Symbol aliases (e.g. USDT → suiUSDT). If the alias target exists,
      // also expose it under the alias.
      for (const [alias, target] of Object.entries(SYMBOL_ALIASES)) {
        const entry = bySymbol.get(target.toUpperCase());
        if (entry && !bySymbol.has(alias.toUpperCase())) {
          bySymbol.set(alias.toUpperCase(), entry);
        }
      }

      // Hard-override canonical entries
      for (const [sym, canonical] of Object.entries(CANONICAL_BY_SYMBOL)) {
        const normCanon = normalizeType(canonical);
        const upstreamMatch = list.find(
          (c) => normalizeType(c.coin_type) === normCanon,
        );
        if (upstreamMatch) {
          bySymbol.set(sym, upstreamMatch);
          byType.set(upstreamMatch.coin_type, upstreamMatch);
        } else if (CANONICAL_META[sym]) {
          const synthetic = CANONICAL_META[sym];
          bySymbol.set(sym, synthetic);
          byType.set(synthetic.coin_type, synthetic);
        }
      }

      return { bySymbol, byType, list };
    });
  }
  return indexPromise;
}

export async function resolveCoin(query: string): Promise<SuiCoin | undefined> {
  const idx = await getCoinIndex();
  if (query.startsWith("0x")) return idx.byType.get(query);
  return idx.bySymbol.get(query.toUpperCase());
}
