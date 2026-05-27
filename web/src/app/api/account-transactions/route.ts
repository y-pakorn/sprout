import { NextRequest, NextResponse } from "next/server";
import {
  normalizeTransaction,
  type AccountTx,
  type RawTransactionsResponse,
} from "@/lib/account-transactions";

/**
 * Server proxy for Blockberry's getAccountTransactions (Sui account tx list).
 *
 *   GET /api/account-transactions?address=0x…&participation=SENDER|RECEIVER&size=10
 *
 * Requires the Blockberry `x-api-key` (server-only). Briefly edge-cached to
 * conserve API credits. Returns the normalized shape consumed by the
 * getAccountTransactions tool + card (raw balance changes; humanized client-side
 * via the coin map).
 *
 * Docs: https://docs.blockberry.one/reference/getaccounttransactions
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.blockberry.one/sui/v1/accounts";
const PARTICIPATION = new Set(["SENDER", "RECEIVER"]);

export async function GET(req: NextRequest) {
  const key = process.env.BLOCKBERRY_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "BLOCKBERRY_API_KEY is not set on the server." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const address = (sp.get("address") ?? "").trim();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) {
    return NextResponse.json(
      { error: "Invalid or missing 'address'." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const partRaw = (sp.get("participation") ?? "SENDER").toUpperCase();
  const participation = PARTICIPATION.has(partRaw) ? partRaw : "SENDER";
  const sizeRaw = Number(sp.get("size") ?? "10");
  const size = Math.min(50, Math.max(1, Number.isFinite(sizeRaw) ? sizeRaw : 10));
  // Cursor pagination: pass the prior response's nextCursor to fetch older txs.
  const cursor = (sp.get("nextCursor") ?? "").trim();

  const url =
    `${BASE}/${address}/transactions` +
    `?transactionsParticipationType=${participation}&orderBy=DESC&size=${size}` +
    (cursor ? `&nextCursor=${encodeURIComponent(cursor)}` : "");

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
    const body = (await upstream.json()) as RawTransactionsResponse;
    const items: AccountTx[] = (body.content ?? []).map(normalizeTransaction);

    return NextResponse.json(
      {
        count: items.length,
        hasNextPage: !!body.hasNextPage,
        nextCursor: body.nextCursor ?? undefined,
        items,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=15, s-maxage=15, stale-while-revalidate=30",
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
