"use client";

import { useEffect, useState } from "react";

export type ClientCoin = {
  coin_type: string;
  decimals: number;
  icon_url?: string;
  name: string;
  verified: boolean;
};

export type CoinMap = Record<string, ClientCoin>;

let cachedMap: CoinMap | null = null;
let inflight: Promise<CoinMap> | null = null;

/**
 * Fetches the compact symbol→coin map from /api/coins. Memoized for the
 * lifetime of the page so repeat hooks don't refetch.
 */
export async function fetchCoinMap(): Promise<CoinMap> {
  if (cachedMap) return cachedMap;
  if (inflight) return inflight;
  inflight = fetch("/api/coins", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`coins fetch failed: ${r.status}`);
      return r.json() as Promise<CoinMap>;
    })
    .then((map) => {
      cachedMap = map;
      inflight = null;
      console.log(
        "[client-coins] loaded",
        Object.keys(map).length,
        "symbols. USDC →",
        map.USDC?.coin_type,
      );
      return map;
    });
  return inflight;
}

export function useCoinMap(): CoinMap | null {
  const [map, setMap] = useState<CoinMap | null>(cachedMap);
  useEffect(() => {
    if (cachedMap) {
      setMap(cachedMap);
      return;
    }
    let alive = true;
    fetchCoinMap().then((m) => {
      if (alive) setMap(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return map;
}

export function resolveSymbol(
  map: CoinMap | null,
  symbol: string,
): ClientCoin | undefined {
  if (!map) return undefined;
  return map[symbol.toUpperCase()];
}

/**
 * Truncates a Sui coin_type for display.
 *
 * "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
 *   → "0xdba3…::usdc::USDC"
 *
 * Keeps the meaningful trailing `module::TYPE` suffix so users can recognize
 * the token at a glance, instead of the address head + a random tail char.
 */
export function truncateCoinType(coinType: string, addrHead = 6): string {
  const segments = coinType.split("::");
  if (segments.length < 3) {
    // Not a standard coin_type — fall back to head/tail
    if (coinType.length <= addrHead + 4 + 3) return coinType;
    return `${coinType.slice(0, addrHead)}…${coinType.slice(-4)}`;
  }
  const [addr, ...rest] = segments;
  if (addr.length <= addrHead + 2) {
    return coinType; // already short (e.g. 0x2)
  }
  return `${addr.slice(0, addrHead)}…::${rest.join("::")}`;
}
