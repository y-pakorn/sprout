import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Server proxy for Suiscan's DEX-activity firehose (every swap across all Sui
 * DEXs). The upstream gates requests behind a per-request HMAC signature
 * (X-API-Random / X-API-Checker / X-APP-Gen) AND sends no usable CORS for the
 * browser — so the call must happen server-side. Origin can't be faked from
 * the browser, and we don't want the signing keys shipped to the client.
 *
 *   GET /api/dex-activity?page=0&size=20
 *
 * The two HMAC keys below are static constants baked into Suiscan's public JS
 * bundle (not per-session secrets) — verified to reproduce live signatures.
 * The signature binds the last path segment ("activity") + a unix-second
 * timestamp, so we recompute it fresh on every request.
 *
 * Upstream response (relayed as { content, totalPages, totalCount }):
 *   content[]: { sender, senderName, senderImg, activity, txHash, timestamp(ms),
 *                projectName, projectImg, coins:[{ amount, coinType, iconUrl,
 *                symbol, coinSeq }], ... }   // coinSeq 0 = sold, 1 = bought
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = "https://suiscan.xyz/api/sui-backend/mainnet/api/dex/activity";
const SEG = "activity"; // last path segment the signature is computed over
const CHECKER_KEY = "wpTujoYEJUqhalFjhioogmrdG";
const APPGEN_KEY = "NWcEQUlBRY";

function hmacHex(message: string, key: string): string {
  return crypto.createHmac("sha256", key).update(message).digest("hex");
}

function md5Hex(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

/** Reproduces Suiscan's `fj` request signer for our fixed endpoint. */
function signHeaders(): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const checker = md5Hex(hmacHex(`${SEG}:${ts}`, CHECKER_KEY));
  const genHex = hmacHex(`2024-${ts}`, APPGEN_KEY);
  let odd = "";
  for (let i = 0; i < genHex.length; i++) if (i % 2 === 1) odd += genHex[i];
  const appGen = md5Hex(odd);
  return {
    "X-API-Random": String(ts),
    "X-API-Checker": checker,
    "X-APP-Gen": appGen,
  };
}

export async function GET(req: NextRequest) {
  const page = req.nextUrl.searchParams.get("page") ?? "0";
  const size = req.nextUrl.searchParams.get("size") ?? "20";

  const url = `${UPSTREAM}?page=${encodeURIComponent(
    page,
  )}&sortBy=TIMESTAMP&orderBy=DESC&searchStr=&size=${encodeURIComponent(size)}`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        origin: "https://suiscan.xyz",
        referer: "https://suiscan.xyz/",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        ...signHeaders(),
      },
      body: JSON.stringify({ actions: ["SWAP"] }),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const data = (await upstream.json()) as {
      content?: unknown[];
      totalPages?: number;
      totalCount?: number;
    };

    return NextResponse.json(
      {
        content: data.content ?? [],
        totalPages: data.totalPages ?? 0,
        totalCount: data.totalCount ?? 0,
      },
      {
        // Client refetches every 15s; a matching 15s edge cache collapses
        // concurrent viewers onto one upstream signed call per window, with a
        // brief SWR tail so a poll never blocks on a cold revalidate.
        headers: {
          "Cache-Control":
            "public, max-age=15, s-maxage=15, stale-while-revalidate=15",
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
