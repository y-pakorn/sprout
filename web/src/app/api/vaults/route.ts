import { getSuiVaults } from "@/lib/vaults";

// Bluefin's vault API only exposes Access-Control-Allow-Origin for
// https://trade.bluefin.io — the browser can't fake Origin (it's set by
// the browser based on the page origin), so we MUST proxy server-side
// to get the data into Sprout. CORS is bypassed on server fetches.
//
// Cacheable: APY/TVL drift on the minute scale, vault list itself rarely
// changes. CDN holds 60s, serves stale-while-revalidate up to 5 min.
export async function GET() {
  try {
    const vaults = await getSuiVaults();
    return Response.json(vaults, {
      headers: {
        "Cache-Control":
          "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (e) {
    console.error("[api/vaults] failed", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      {
        status: 502,
        headers: {
          "content-type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
