import { fetchVaultHistory, type VaultHistoryMetric } from "@/lib/vaults";

const VALID_METRICS: VaultHistoryMetric[] = [
  "apy",
  "tvl",
  "pnl",
  "share-price",
];

// Same CORS reason as /api/vaults — Bluefin only allows origins like
// https://trade.bluefin.io, so we proxy.
//
// Cacheable: daily-bucketed history series. CDN holds 5 min, serves
// stale-while-revalidate up to 15 min. Different (id, metric, limit,
// interval) tuples are independent cache keys because they're query-
// dependent — the CDN keys by full URL.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const metric = url.searchParams.get("metric") as VaultHistoryMetric | null;
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const interval = url.searchParams.get("interval") ?? "1d";
  if (!metric || !VALID_METRICS.includes(metric)) {
    return Response.json(
      { error: `metric must be one of ${VALID_METRICS.join(", ")}` },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const data = await fetchVaultHistory(id, metric, limit, interval);
    return Response.json(data, {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
      },
    });
  } catch (e) {
    return Response.json(
      { error: (e as Error).message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
