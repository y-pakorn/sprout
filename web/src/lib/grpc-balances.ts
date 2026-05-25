import type { ClientWithCoreApi } from "@mysten/sui/client";

export type CoreClientLike = ClientWithCoreApi;

/**
 * Paginated wallet balance read on the @mysten/sui 2.0 core API. Replaces the
 * old JSON-RPC `getAllBalances`. Returns the legacy `{ coinType, totalBalance }`
 * shape so existing consumers don't change.
 */
export async function fetchAllBalances(
  client: CoreClientLike,
  owner: string,
): Promise<{ coinType: string; totalBalance: string }[]> {
  const out: { coinType: string; totalBalance: string }[] = [];
  let cursor: string | null = null;
  do {
    const page = await client.core.listBalances({ owner, cursor });
    for (const b of page.balances) {
      out.push({ coinType: b.coinType, totalBalance: b.balance });
    }
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return out;
}

/** Single-coin balance (raw string) on the core API; replaces `getBalance`. */
export async function fetchBalance(
  client: CoreClientLike,
  owner: string,
  coinType: string,
): Promise<string> {
  const res = await client.core.getBalance({ owner, coinType });
  return res.balance.balance;
}
