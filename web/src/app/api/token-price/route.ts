import { NextRequest, NextResponse } from "next/server";

/**
 * Server proxy for Bluefin's token-price oracle.
 *
 *   GET /api/token-price?tokens=<canonical coin type>[,<...>]
 *
 * The upstream (swap.api.sui-prod.bluefin.io) sends NO CORS headers, so a
 * browser fetch from our origin is blocked — this route exists purely to
 * relay the call server-side. Do NOT delete it in favour of a direct
 * client fetch; Origin can't be faked from the browser.
 *
 * Upstream response shape (relayed verbatim):
 *   [{ address: string, price: string, priceChangePercent24Hrs: string }]
 * `address` is the canonical (64-hex) coin type; `price` is USD.
 * Note the upstream requires CANONICAL coin types — short forms like
 * `0x2::sui::SUI` return empty. Callers must canonicalize before hitting
 * this route (see getTokenPrices in lib/bluefin7k.ts).
 */
const BLUEFIN_PRICE_API =
  "https://swap.api.sui-prod.bluefin.io/api/v1/tokens/price";

export async function GET(req: NextRequest) {
  const tokens = req.nextUrl.searchParams.get("tokens");
  if (!tokens) {
    return NextResponse.json(
      { error: "missing 'tokens' query param" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const upstream = await fetch(
      `${BLUEFIN_PRICE_API}?tokens=${encodeURIComponent(tokens)}`,
      { headers: { accept: "application/json" } },
    );
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const data = await upstream.json();
    return NextResponse.json(data, {
      // Prices move, but a 15s edge cache massively cuts upstream load
      // during a chat session where the same coins get re-priced often.
      headers: {
        "Cache-Control":
          "public, max-age=15, s-maxage=15, stale-while-revalidate=30",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
