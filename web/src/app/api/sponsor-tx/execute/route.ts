import "server-only";
import { getEnokiClient } from "@/lib/enoki-server";

export const maxDuration = 30;

type Body = {
  digest?: string;
  signature?: string;
};

// Execute a sponsored transaction: Enoki adds the sponsor's signature to the
// digest it created in /api/sponsor-tx, combines it with the sender's signature
// (produced by the wallet over the sponsored bytes), and broadcasts.
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { digest, signature } = body;
  if (!digest || !signature) {
    return json({ error: "Missing digest or signature." }, 400);
  }

  try {
    const result = await getEnokiClient().executeSponsoredTransaction({
      digest,
      signature,
    });
    return json({ digest: result.digest });
  } catch (e) {
    console.error("[api/sponsor-tx/execute] executeSponsoredTransaction failed", e);
    return json({ error: (e as Error).message || "Execution failed." }, 502);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
