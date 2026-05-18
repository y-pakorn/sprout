import { NextResponse } from "next/server";
import { getCoinIndex } from "@/lib/coins";

/**
 * Returns a compact map of {SYMBOL: {coin_type, decimals, icon_url, name, verified}}
 * for verified Sui tokens. Sourced from Bluefin's tokens API via getCoinIndex().
 *
 * Cacheable: the verified-token list drifts slowly (new tokens land days
 * to weeks apart). CDN holds 10 min, serves stale-while-revalidate up to 1h.
 */
export async function GET() {
  try {
    const idx = await getCoinIndex();
    const out: Record<
      string,
      {
        coin_type: string;
        decimals: number;
        icon_url?: string;
        name: string;
        verified: boolean;
      }
    > = {};

    for (const [symbol, coin] of idx.bySymbol.entries()) {
      if (symbol.length > 12) continue;
      if (!coin.verified && !["USDC", "USDT"].includes(symbol)) continue;
      out[symbol] = {
        coin_type: coin.coin_type,
        decimals: coin.decimals,
        icon_url: coin.icon_url,
        name: coin.name,
        verified: coin.verified,
      };
    }

    return NextResponse.json(out, {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=600, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
