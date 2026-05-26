"use client";

import {
  APP_SK_COOKIE,
  SIG_HEADER,
  TS_HEADER,
  NONCE_HEADER,
  hmacHex,
  buildSigPayload,
  canonicalPath,
  randomHex,
} from "@/lib/app-token";

// Drop-in `fetch` replacement for calls to our own /api/* routes. Reads the
// per-session signing key from the readable `app_sk` cookie and attaches a
// fresh signature (ts + nonce + HMAC over method/path) on every call, which
// middleware verifies. If the cookie is absent it sends the request unsigned —
// middleware will then 403, surfacing as a normal fetch error.

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + escaped + "=([^;]*)"),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export async function signedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const asRequest = input instanceof Request ? input : null;
  const method = (init?.method ?? asRequest?.method ?? "GET").toUpperCase();
  const urlStr =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : asRequest!.url;
  const url = new URL(urlStr, window.location.origin);
  const pathWithSearch = canonicalPath(url.pathname, url.searchParams);

  const headers = new Headers(init?.headers ?? asRequest?.headers);

  const sk = readCookie(APP_SK_COOKIE);
  if (sk) {
    const ts = Date.now().toString();
    const nonce = randomHex(12);
    const sig = await hmacHex(sk, buildSigPayload(method, pathWithSearch, ts, nonce));
    headers.set(TS_HEADER, ts);
    headers.set(NONCE_HEADER, nonce);
    headers.set(SIG_HEADER, sig);
  }

  return fetch(input, { ...init, headers });
}

export const apiFetch = signedFetch;
