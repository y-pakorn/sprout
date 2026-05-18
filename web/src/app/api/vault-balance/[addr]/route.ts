import { fetchVaultBalanceServerData } from "@/lib/vault-balance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Bluefin's vault APIs are CORS-locked to https://trade.bluefin.io.
// We proxy withdrawals + history from the server. Active positions are
// derived on the client from the wallet's on-chain receipt-token balances
// (no upstream positions API call — chain data is the source of truth).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ addr: string }> },
) {
  const { addr } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(addr)) {
    return new Response(
      JSON.stringify({ error: "Invalid Sui address" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  try {
    const data = await fetchVaultBalanceServerData(addr);
    return Response.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[api/vault-balance]", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}
