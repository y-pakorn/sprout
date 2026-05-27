import { NextRequest, NextResponse } from "next/server";
import {
  isCoinType,
  normalizeCoinHolder,
  type CoinHolder,
  type RawCoinHolder,
  type SpringPage,
} from "@/lib/blockberry-coins";

/**
 * Server proxy for Blockberry's getHoldersByCoinType (top holders of a coin).
 *
 *   GET /api/coin-holders?coinType=0x2::sui::SUI&size=10
 *
 * Requires the Blockberry x-api-key (server-only). Briefly edge-cached.
 * Docs: https://docs.blockberry.one/reference/getholdersbycointype
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.blockberry.one/sui/v1/coins";

export async function GET(req: NextRequest) {
  const key = process.env.BLOCKBERRY_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "BLOCKBERRY_API_KEY is not set on the server." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const coinType = (sp.get("coinType") ?? "").trim();
  if (!isCoinType(coinType)) {
    return NextResponse.json(
      { error: "Invalid or missing 'coinType' (expected 0x…::module::TYPE)." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const sizeRaw = Number(sp.get("size") ?? "10");
  const size = Math.min(100, Math.max(1, Number.isFinite(sizeRaw) ? sizeRaw : 10));
  const pageRaw = Number(sp.get("page") ?? "0");
  const page = Math.max(0, Number.isFinite(pageRaw) ? Math.floor(pageRaw) : 0);

  const url =
    `${BASE}/${encodeURIComponent(coinType)}/holders` +
    `?page=${page}&size=${size}&orderBy=DESC&sortBy=AMOUNT`;

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
    const body = (await upstream.json()) as SpringPage<RawCoinHolder>;
    const items: CoinHolder[] = (body.content ?? []).map(normalizeCoinHolder);
    return NextResponse.json(
      { items, page, hasNextPage: !body.last },
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
