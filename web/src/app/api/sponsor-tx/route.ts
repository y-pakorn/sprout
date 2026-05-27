import "server-only";
import { getEnokiClient } from "@/lib/enoki-server";
import type { EnokiNetwork } from "@mysten/enoki";

export const maxDuration = 30;

type Body = {
  network?: EnokiNetwork;
  transactionKindBytes?: string;
  sender?: string;
};

// Sponsor a transaction's gas. The client sends transaction-KIND bytes (no gas
// data) + the sender; Enoki builds the full sponsored transaction (sponsor as
// gas owner) and returns its bytes + digest for the sender to sign. We pass no
// allowedMoveCallTargets / allowedAddresses — aggregator routes and send
// recipients are dynamic; the Enoki project-level allowlist governs instead.
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { network, transactionKindBytes, sender } = body;
  if (!transactionKindBytes || !sender) {
    return json({ error: "Missing transactionKindBytes or sender." }, 400);
  }

  try {
    const result = await getEnokiClient().createSponsoredTransaction({
      network,
      transactionKindBytes,
      sender,
    });
    return json({ bytes: result.bytes, digest: result.digest });
  } catch (e) {
    console.error("[api/sponsor-tx] createSponsoredTransaction failed", e);
    return json({ error: (e as Error).message || "Sponsorship failed." }, 502);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
