import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  APP_SK_COOKIE,
  SIG_HEADER,
  TS_HEADER,
  NONCE_HEADER,
  SIG_FRESHNESS_MS,
  SESSION_TTL_MS,
  SESSION_ROTATE_MS,
  hmacHex,
  timingSafeEqual,
  buildSigPayload,
  canonicalPath,
  randomHex,
} from "@/lib/app-token";
import { getSigningSecret, allowedHosts } from "@/lib/env";

// Gate for /api/*: a request must carry a valid server-signed session cookie
// AND a fresh per-request signature made with the session's signing key. Page
// (document) requests get those credentials minted/rotated here. See
// app-token.ts for the scheme and its honest limits.

type Session = { sid: string; iat: number };

function forbidden(reason: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: "forbidden", reason }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

async function verifySession(
  raw: string | undefined,
  secret: string,
): Promise<Session | null> {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [sid, iatStr, mac] = parts;
  const iat = Number(iatStr);
  if (!sid || !Number.isFinite(iat)) return null;
  if (Date.now() - iat > SESSION_TTL_MS) return null;
  const expected = await hmacHex(secret, `sess|${sid}|${iat}`);
  if (!timingSafeEqual(expected, mac)) return null;
  return { sid, iat };
}

// The per-session signing key handed to the client (readable app_sk cookie).
// Derived from the secret + session identity, so the server can re-derive it
// on every request without storing anything.
function deriveSessionKey(
  sid: string,
  iat: number,
  secret: string,
): Promise<string> {
  return hmacHex(secret, `sk|${sid}|${iat}`);
}

function hostMismatch(headerVal: string | null, selfHost: string): boolean {
  if (!headerVal) return false; // absent → can't judge; other layers catch it
  try {
    const h = new URL(headerVal).host;
    return h !== selfHost && !allowedHosts().includes(h);
  } catch {
    return true;
  }
}

async function verifyApiRequest(
  req: NextRequest,
  secret: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Cheap cross-site filter (browsers set Sec-Fetch-Site; scripts that forge it
  // are still stopped by the cookie+signature below — this just rejects obvious
  // cross-site browser calls early).
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs && sfs !== "same-origin" && sfs !== "same-site" && sfs !== "none") {
    return { ok: false, reason: "cross-site" };
  }
  const selfHost = req.nextUrl.host;
  if (
    hostMismatch(req.headers.get("origin"), selfHost) ||
    hostMismatch(req.headers.get("referer"), selfHost)
  ) {
    return { ok: false, reason: "bad-origin" };
  }

  const session = await verifySession(
    req.cookies.get(SESSION_COOKIE)?.value,
    secret,
  );
  if (!session) return { ok: false, reason: "no-session" };

  const ts = req.headers.get(TS_HEADER);
  const nonce = req.headers.get(NONCE_HEADER);
  const sig = req.headers.get(SIG_HEADER);
  if (!ts || !nonce || !sig) return { ok: false, reason: "no-sig" };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > SIG_FRESHNESS_MS) {
    return { ok: false, reason: "stale" };
  }

  const key = await deriveSessionKey(session.sid, session.iat, secret);
  const expected = await hmacHex(
    key,
    buildSigPayload(
      req.method,
      canonicalPath(req.nextUrl.pathname, req.nextUrl.searchParams),
      ts,
      nonce,
    ),
  );
  if (!timingSafeEqual(expected, sig)) return { ok: false, reason: "bad-sig" };

  return { ok: true };
}

async function mintIfNeeded(
  req: NextRequest,
  secret: string,
): Promise<NextResponse> {
  const existing = await verifySession(
    req.cookies.get(SESSION_COOKIE)?.value,
    secret,
  );
  const res = NextResponse.next();
  const needsFresh = !existing || Date.now() - existing.iat > SESSION_ROTATE_MS;
  if (!needsFresh) return res;

  const sid = randomHex(16);
  const iat = Date.now();
  const mac = await hmacHex(secret, `sess|${sid}|${iat}`);
  const sessionVal = `${sid}.${iat}.${mac}`;
  const appSk = await deriveSessionKey(sid, iat, secret);
  const secure = process.env.NODE_ENV === "production";
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);

  res.cookies.set(SESSION_COOKIE, sessionVal, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge,
  });
  // Readable by client JS on purpose — it signs requests with this key.
  res.cookies.set(APP_SK_COOKIE, appSk, {
    httpOnly: false,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge,
  });
  return res;
}

export async function proxy(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  const secret = getSigningSecret();

  if (!secret) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[proxy] API_SIGNING_SECRET unset — /api protection is DISABLED. " +
          "Add a 32+ char value to web/.env.local (e.g. `openssl rand -hex 32`).",
      );
      return NextResponse.next();
    }
    // In production we refuse rather than serve the API unprotected.
    return isApi ? forbidden("server-misconfigured") : NextResponse.next();
  }

  if (isApi) {
    const verdict = await verifyApiRequest(req, secret);
    return verdict.ok ? NextResponse.next() : forbidden(verdict.reason);
  }

  return mintIfNeeded(req, secret);
}

export const config = {
  // Run on everything except Next internals and static asset files. This covers
  // document/RSC navigations (to mint cookies) and /api/* (to verify).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|map)$).*)",
  ],
};
