import { NextRequest, NextResponse } from "next/server";
import {
  normalizeCoinListItem,
  type CoinListItem,
  type RawCoinListItem,
  type SpringPage,
} from "@/lib/blockberry-coins";

/**
 * Server proxy for Blockberry's getCoins (Sui coin directory).
 *
 *   GET /api/coin-list?sortBy=MARKET_CAP&size=10
 *
 * Requires the Blockberry x-api-key (server-only). Briefly edge-cached.
 * Docs: https://docs.blockberry.one/reference/getcoins
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.blockberry.one/sui/v1/coins";
const SORTS = new Set(["MARKET_CAP", "HOLDERS", "AGE", "NAME"]);

export async function GET(req: NextRequest) {
  const key = process.env.BLOCKBERRY_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "BLOCKBERRY_API_KEY is not set on the server." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const sortRaw = (sp.get("sortBy") ?? "MARKET_CAP").toUpperCase();
  const sortBy = SORTS.has(sortRaw) ? sortRaw : "MARKET_CAP";
  const orderBy = sortBy === "NAME" ? "ASC" : "DESC";
  const sizeRaw = Number(sp.get("size") ?? "10");
  const size = Math.min(100, Math.max(1, Number.isFinite(sizeRaw) ? sizeRaw : 10));

  const url = `${BASE}?page=0&size=${size}&orderBy=${orderBy}&sortBy=${sortBy}`;

  try {
    const upstream = await fetch(url, {
      headers: { accept: "application/json", "x-api-key": key },
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const body = (await upstream.json()) as SpringPage<RawCoinListItem>;
    const items: CoinListItem[] = (body.content ?? []).map(normalizeCoinListItem);
    return NextResponse.json(
      { items, hasNextPage: !body.last },
      {
        headers: {
          "Cache-Control":
            "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
