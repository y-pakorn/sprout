import "server-only";
import { EnokiClient } from "@mysten/enoki";

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
