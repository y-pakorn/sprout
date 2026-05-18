import { NextResponse } from "next/server";
import { getCoinIndex } from "@/lib/coins";

// Disable Next.js route caching — we want fresh resolution while iterating
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Returns a compact map of {SYMBOL: {coin_type, decimals, icon_url, name, verified}}
 * for verified Sui tokens. Sourced from Bluefin's tokens API via getCoinIndex().
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

    // Diagnostic — strip once stable
    console.log(
      "[api/coins] USDC →",
      out["USDC"]?.coin_type ?? "(not found)",
      "  SUI →",
      out["SUI"]?.coin_type ?? "(not found)",
    );

    return NextResponse.json(out, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
