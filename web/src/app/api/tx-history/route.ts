import { NextRequest, NextResponse } from "next/server";
import {
  normalizeActivity,
  type RawActivityResponse,
  type TxActivity,
} from "@/lib/tx-history";

/**
 * Server proxy for Blockberry's getAccountActivity (Sui account tx history).
 *
 *   GET /api/tx-history?address=0x…&actionType=ALL|SEND|RECEIVE&size=10
 *
 * Blockberry requires an `x-api-key` (a paid/credited key) — so the call must
 * happen server-side; the key never reaches the browser. Responses are briefly
 * edge-cached to conserve Blockberry credits across rapid re-asks.
 *
 * Returns the normalized shape consumed by the getTxHistory tool + card:
 *   { count, hasNextPage, items: TxActivity[] }
 *
 * Docs: https://docs.blockberry.one/reference/getaccountactivity
 * Example address: 0x61953ea72709eed72f4441dd944eec49a11b4acabfc8e04015e89c63be81b6ab
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.blockberry.one/sui/v1/accounts";
const ACTION_TYPES = new Set(["ALL", "SEND", "RECEIVE"]);

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

  const actionTypeRaw = (sp.get("actionType") ?? "ALL").toUpperCase();
  const actionType = ACTION_TYPES.has(actionTypeRaw) ? actionTypeRaw : "ALL";
  const sizeRaw = Number(sp.get("size") ?? "10");
  const size = Math.min(50, Math.max(1, Number.isFinite(sizeRaw) ? sizeRaw : 10));
  // Cursor pagination: pass the prior response's nextCursor to fetch older items.
  const cursor = (sp.get("nextCursor") ?? "").trim();

  const url =
    `${BASE}/${address}/activity` +
    `?actionType=${actionType}&orderBy=DESC&size=${size}` +
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
    const body = (await upstream.json()) as RawActivityResponse;
    const items: TxActivity[] = (body.content ?? []).map(normalizeActivity);

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
