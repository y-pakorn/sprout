import { getSuiVaults } from "@/lib/vaults";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Bluefin's vault API only exposes Access-Control-Allow-Origin for
// https://trade.bluefin.io — the browser can't fake Origin (it's set by
// the browser based on the page origin), so we MUST proxy server-side
// to get the data into Sprout. CORS is bypassed on server fetches.
export async function GET() {
  try {
    const vaults = await getSuiVaults();
    return Response.json(vaults, {
      headers: { "Cache-Control": "no-store" },
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
