import crypto from "node:crypto";

// Reproduces Suiscan's request signer (the `fj` function from their public JS
// bundle) for their gated `/api/sui-backend/...` endpoints. Server-only — the
// two HMAC keys are static constants baked into their bundle (not per-session
// secrets), but we keep them off the client. The signature binds the LAST path
// segment + a unix-second timestamp, recomputed per request.
//
// Missing/invalid signature → the upstream returns HTTP 407.

const CHECKER_KEY = "wpTujoYEJUqhalFjhioogmrdG";
const APPGEN_KEY = "NWcEQUlBRY";

function hmacHex(message: string, key: string): string {
  return crypto.createHmac("sha256", key).update(message).digest("hex");
}

function md5Hex(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

/**
 * Builds the X-API-Random / X-API-Checker / X-APP-Gen headers for a Suiscan
 * backend call. `lastPathSegment` is the final path segment the request signs
 * over (e.g. "activity", "details").
 */
export function signSuiscanHeaders(
  lastPathSegment: string,
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const checker = md5Hex(hmacHex(`${lastPathSegment}:${ts}`, CHECKER_KEY));
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

/** Common browser-ish headers the Suiscan backend expects alongside the sig. */
export const SUISCAN_BASE_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  origin: "https://suiscan.xyz",
  referer: "https://suiscan.xyz/",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
};
