import type { Transaction } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { toBase64 } from "@mysten/sui/utils";
import { apiFetch } from "@/lib/api-client";
import type { SuiNetwork } from "@/lib/sui";

// Client-side orchestration of an Enoki-sponsored transaction. The private
// Enoki key never leaves the server, so this hops through our two /api routes:
//
//   1. build transaction-KIND bytes (no gas) for the connected sender
//   2. POST /api/sponsor-tx  → Enoki builds the full sponsored tx → { bytes, digest }
//   3. wallet signs the sponsored bytes (sign-only, NOT execute)
//   4. POST /api/sponsor-tx/execute → Enoki adds sponsor sig + broadcasts → digest
//
// Throws on any failure so the caller can fall back to wallet-paid execution.

type SignFn = (args: {
  transaction: string;
}) => Promise<{ signature: string }>;

export async function executeSponsored(args: {
  tx: Transaction;
  sender: string;
  network: SuiNetwork;
  suiClient: SuiGrpcClient;
  signTransaction: SignFn;
}): Promise<string> {
  const { tx, sender, network, suiClient, signTransaction } = args;

  tx.setSender(sender);
  const kindBytes = await tx.build({
    client: suiClient,
    onlyTransactionKind: true,
  });

  const sponsorRes = await apiFetch("/api/sponsor-tx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      network,
      transactionKindBytes: toBase64(kindBytes),
      sender,
    }),
  });
  if (!sponsorRes.ok) {
    const err = await safeError(sponsorRes);
    throw new Error(`Sponsorship failed: ${err}`);
  }
  const { bytes, digest } = (await sponsorRes.json()) as {
    bytes: string;
    digest: string;
  };

  const { signature } = await signTransaction({ transaction: bytes });

  const execRes = await apiFetch("/api/sponsor-tx/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ digest, signature }),
  });
  if (!execRes.ok) {
    const err = await safeError(execRes);
    throw new Error(`Sponsored execution failed: ${err}`);
  }
  const executed = (await execRes.json()) as { digest: string };
  return executed.digest;
}

async function safeError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
