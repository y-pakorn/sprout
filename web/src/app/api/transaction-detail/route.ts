import { NextRequest, NextResponse } from "next/server";
import { signSuiscanHeaders, SUISCAN_BASE_HEADERS } from "@/lib/suiscan-sign";
import {
  cleanTransactionDetail,
  type RawTxDetailResponse,
} from "@/lib/transaction-detail";

/**
 * Server proxy for Suiscan's raw-transaction details (signed, like the DEX
 * feed). The upstream payload is ~55KB; we drop the raw tx blob + object
 * metadata map and return only basic tx detail + cleaned activities.
 *
 *   GET /api/transaction-detail?digest=<base58 digest>
 *
 * Finalized txs are immutable, so the response is cached aggressively.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = "https://suiscan.xyz/api/sui-backend/mainnet/api/raw-transaction";

export async function GET(req: NextRequest) {
  const digest = (req.nextUrl.searchParams.get("digest") ?? "").trim();
  if (!/^[A-Za-z0-9]{32,48}$/.test(digest)) {
    return NextResponse.json(
      { error: "Invalid or missing 'digest'." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = `${UPSTREAM}/${digest}/details`;

  try {
    const upstream = await fetch(url, {
      headers: { ...SUISCAN_BASE_HEADERS, ...signSuiscanHeaders("details") },
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const raw = (await upstream.json()) as RawTxDetailResponse;
    const detail = cleanTransactionDetail(raw, digest);

    return NextResponse.json(detail, {
      // A finalized transaction never changes.
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
