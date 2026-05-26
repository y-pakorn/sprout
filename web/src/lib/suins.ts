import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";
import type { SuiGrpcClient } from "@mysten/sui/grpc";

/**
 * Resolve a transfer recipient to a normalized 0x address. Accepts a raw Sui
 * address or a SuiNS name (e.g. "yoisha.sui" / "@yoisha"), resolving the latter
 * on-chain via the client's name service. Throws a clear, agent-readable error
 * for invalid or unregistered inputs.
 *
 * `client` is typed as the concrete gRPC client (dapp-kit surfaces the instance
 * loosely as ClientWithCoreApi, so callers pass `client as unknown as
 * SuiGrpcClient`).
 */
export async function resolveRecipient(
  input: string,
  client: SuiGrpcClient,
): Promise<{ address: string; name?: string }> {
  const raw = input.trim();
  if (!raw) throw new Error("missing recipient (a 0x address or SuiNS name).");
  if (isValidSuiAddress(raw)) return { address: normalizeSuiAddress(raw) };
  // Treat anything else as a SuiNS name. lookupName accepts "name.sui" and "@name".
  let target: string | undefined;
  try {
    const res = await client.nameService.lookupName({ name: raw });
    target = res.response.record?.targetAddress;
  } catch {
    throw new Error(
      `'${input}' is not a valid Sui address or SuiNS name (e.g. yoisha.sui).`,
    );
  }
  if (!target) {
    throw new Error(
      `SuiNS name '${raw}' isn't registered (or has no target address set).`,
    );
  }
  return { address: normalizeSuiAddress(target), name: raw };
}
