import { fetchVaultDeployment } from "@/lib/vaults";

// Bluefin's vault info endpoint is CORS-locked to https://trade.bluefin.io
// so we must proxy server-side. Returns just the normalized
// VaultDeployment shape — not the full upstream blob.
//
// Cacheable: Move package + ProtocolConfig + per-vault objectIds change
// only on contract redeploy. CDN holds 1h, serves stale-while-revalidate
// up to 24h.
export async function GET() {
  try {
    const deployment = await fetchVaultDeployment();
    return Response.json(deployment, {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    console.error("[api/vaults/info] failed", e);
    return Response.json(
      { error: (e as Error).message },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
