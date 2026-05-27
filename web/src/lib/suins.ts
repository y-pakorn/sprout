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

export type SuinsLookup = {
  /** The original query, trimmed. */
  input: string;
  /** Normalized 0x address (always set on success). */
  address: string;
  /** SuiNS name, when one exists (a reverse lookup may find none). */
  name?: string;
  direction: "name-to-address" | "address-to-name";
};

/**
 * Bidirectional SuiNS conversion for the agent's name-service tool. Detects
 * direction from the input: a 0x address → reverse lookup (address → primary
 * name); anything else → forward lookup (name → target address). Throws a
 * clear, agent-readable error for malformed or unregistered inputs.
 */
export async function lookupSuins(
  query: string,
  client: SuiGrpcClient,
): Promise<SuinsLookup> {
  const raw = query.trim();
  if (!raw) throw new Error("Pass a SuiNS name (yoisha.sui) or a 0x address.");

  // Address → name (reverse). A missing reverse record is NOT an error —
  // many addresses simply haven't set a primary name.
  if (isValidSuiAddress(raw)) {
    const address = normalizeSuiAddress(raw);
    let name: string | undefined;
    try {
      const res = await client.nameService.reverseLookupName({ address });
      name = res.response.record?.name;
    } catch {
      // treat lookup failure as "no name set"
    }
    return { input: raw, address, name, direction: "address-to-name" };
  }

  // Name → address (forward).
  let target: string | undefined;
  let name: string | undefined;
  try {
    const res = await client.nameService.lookupName({ name: raw });
    target = res.response.record?.targetAddress;
    name = res.response.record?.name;
  } catch {
    throw new Error(
      `'${query}' is not a valid Sui address or SuiNS name (e.g. yoisha.sui).`,
    );
  }
  if (!target) {
    throw new Error(
      `SuiNS name '${raw}' isn't registered (or has no target address set).`,
    );
  }
  return {
    input: raw,
    address: normalizeSuiAddress(target),
    name: name ?? raw,
    direction: "name-to-address",
  };
}
