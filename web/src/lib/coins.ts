import "server-only";

export type SevenKCoin = {
  coin_type: string;
  decimals: number;
  name: string;
  symbol: string;
  description?: string;
  icon_url?: string;
  id?: string;
  verified: boolean;
  no_price: boolean;
  alias?: string;
};

const SEVENK_POOL_COINS_URL = "https://lp-pro-api.7k.ag/pool/coins";

/**
 * Fetches the full list of Sui coins recognized by 7K Protocol.
 * Cached on the Next.js server for 1 hour so we only hit the upstream
 * once per cache window across the whole app.
 */
export async function fetchSevenKCoins(): Promise<SevenKCoin[]> {
  const res = await fetch(SEVENK_POOL_COINS_URL, {
    next: { revalidate: 3600, tags: ["sevenk-coins"] },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch 7K coin list: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as SevenKCoin[];
}

type CoinIndex = {
  bySymbol: Map<string, SevenKCoin>;
  byType: Map<string, SevenKCoin>;
  list: SevenKCoin[];
};

let indexPromise: Promise<CoinIndex> | null = null;

/**
 * Memoized coin index for server-side lookup. Resolves once per
 * server process; the underlying fetch is also cached by Next.js
 * for the configured revalidation window.
 */
export function getCoinIndex(): Promise<CoinIndex> {
  if (!indexPromise) {
    indexPromise = fetchSevenKCoins().then((list) => {
      const bySymbol = new Map<string, SevenKCoin>();
      const byType = new Map<string, SevenKCoin>();
      for (const coin of list) {
        byType.set(coin.coin_type, coin);
        const sym = coin.symbol.toUpperCase();
        const existing = bySymbol.get(sym);
        if (!existing || (coin.verified && !existing.verified)) {
          bySymbol.set(sym, coin);
        }
      }
      return { bySymbol, byType, list };
    });
  }
  return indexPromise;
}

export async function resolveCoin(query: string): Promise<SevenKCoin | undefined> {
  const idx = await getCoinIndex();
  if (query.startsWith("0x")) return idx.byType.get(query);
  return idx.bySymbol.get(query.toUpperCase());
}
