import "server-only";
import { EnokiClient, EnokiClientError } from "@mysten/enoki";

// Server-only Enoki client. The private API key (`enoki_private_…`) sponsors
// gas; it must never reach the browser. Lazily instantiated so a missing key
// surfaces as a clear 500 on the sponsor routes rather than a boot crash.
let client: EnokiClient | null = null;

export function getEnokiClient(): EnokiClient {
  const apiKey = process.env.ENOKI_API_KEY;
  if (!apiKey) {
    throw new Error("ENOKI_API_KEY is not set.");
  }
  if (!client) {
    client = new EnokiClient({ apiKey });
  }
  return client;
}

/**
 * Pull the human-readable reason out of an Enoki failure. EnokiClientError's
 * top-level message is just "Request to Enoki API failed (status: N)" — the
 * actual cause (e.g. "Address X is not allow-listed for receiving transfers")
 * lives in `.errors[].message`. Returns the detail + http status for surfacing.
 */
export function formatEnokiError(e: unknown): { message: string; status: number } {
  if (e instanceof EnokiClientError) {
    const detail = e.errors
      ?.map((x) => x.message)
      .filter(Boolean)
      .join("; ");
    return { message: detail || e.message, status: e.status || 502 };
  }
  return { message: (e as Error).message || "Enoki request failed.", status: 502 };
}
