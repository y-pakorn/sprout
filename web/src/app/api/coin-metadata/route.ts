import { NextRequest, NextResponse } from "next/server";
import {
  isCoinType,
  normalizeCoinMetadata,
  type RawCoinMetadata,
} from "@/lib/blockberry-coins";

/**
 * Server proxy for Blockberry's getCoinMetadata (one coin by coin type).
 *
 *   GET /api/coin-metadata?coinType=0x2::sui::SUI
 *
 * Requires the Blockberry x-api-key (server-only). Cached longer — metadata is
 * fairly stable. Docs: https://docs.blockberry.one/reference/getcoinmetadata
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.blockberry.one/sui/v1/coins/metadata";

export async function GET(req: NextRequest) {
  const key = process.env.BLOCKBERRY_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "BLOCKBERRY_API_KEY is not set on the server." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const coinType = (req.nextUrl.searchParams.get("coinType") ?? "").trim();
  if (!isCoinType(coinType)) {
    return NextResponse.json(
      { error: "Invalid or missing 'coinType' (expected 0x…::module::TYPE)." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = `${BASE}/${encodeURIComponent(coinType)}`;

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
    const raw = (await upstream.json()) as RawCoinMetadata;
    return NextResponse.json(normalizeCoinMetadata(raw, coinType), {
      headers: {
        "Cache-Control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
