import { fetchVaultDeployment } from "@/lib/vaults";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Bluefin's vault info endpoint is CORS-locked to https://trade.bluefin.io
// so we must proxy server-side. Returns just the normalized
// VaultDeployment shape — not the full upstream blob.
export async function GET() {
  try {
    const deployment = await fetchVaultDeployment();
    return Response.json(deployment, {
      headers: { "Cache-Control": "no-store" },
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
