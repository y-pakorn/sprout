import type { RawDcaOrder, RawDcaExecution } from "@/lib/dca-orders";

// Server proxy for 7K's DCA read API (lod-dca.7k.ag). Kept server-side like
// every other 7K-family read so the browser never hits a potentially
// CORS-locked origin, and so the (large) raw payload stays off the model's
// prompt — the client enriches + caches it for the card.
//
//   GET /api/dca-orders?owner=0x..&scope=open|all
//     open → active/expired orders
//     all  → also includes the order's execution history
const LO_DCA = "https://lod-dca.7k.ag/api";

function qs(params: Record<string, string | string[]>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const vals = Array.isArray(v) ? v : [v];
    for (const item of vals) parts.push(`${k}=${encodeURIComponent(item)}`);
  }
  return parts.join("&");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const owner = url.searchParams.get("owner")?.trim();
  const scope = url.searchParams.get("scope") === "all" ? "all" : "open";
  if (!owner) {
    return new Response(JSON.stringify({ error: "owner required" }), {
      status: 400,
      headers: { "content-type": "application/json", "Cache-Control": "no-store" },
    });
  }

  try {
    const openUrl = `${LO_DCA}/dca-orders?${qs({
      owner,
      statuses: ["ACTIVE", "EXPIRED"],
      offset: "0",
      limit: "50",
    })}`;
    const openRes = await fetch(openUrl, { cache: "no-store" });
    if (!openRes.ok) {
      throw new Error(`dca-orders fetch failed: ${openRes.status}`);
    }
    const open = (await openRes.json()) as RawDcaOrder[];

    let history: RawDcaExecution[] = [];
    if (scope === "all") {
      const histUrl = `${LO_DCA}/order-executions?${qs({
        owner,
        orderType: "DCA",
        statuses: "SUCCESS",
        offset: "0",
        limit: "50",
      })}`;
      const histRes = await fetch(histUrl, { cache: "no-store" });
      history = histRes.ok ? ((await histRes.json()) as RawDcaExecution[]) : [];
    }

    return Response.json(
      { open, history },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[api/dca-orders] failed", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 502,
      headers: { "content-type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
