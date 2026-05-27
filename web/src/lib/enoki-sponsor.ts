import { Transaction } from "@mysten/sui/transactions";
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
// Only step 2 (before any wallet prompt) is "sponsorship unavailable" and safe
// to fall back from. A failure at step 3 (user rejected the signature) or 4
// must NOT silently retry — otherwise cancelling re-prompts the wallet.

/** Thrown only when Enoki couldn't build the sponsored tx (step 2) — i.e.
 *  before the wallet was asked to sign. The caller may fall back to wallet-paid
 *  gas. Any other failure (sign rejection, execution) is a hard stop. */
export class SponsorshipUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SponsorshipUnavailableError";
  }
}

type SignFn = (args: {
  transaction: string;
}) => Promise<{ signature: string }>;

export async function executeSponsored(args: {
  tx: Transaction;
  sender: string;
  network: SuiNetwork;
  suiClient: SuiGrpcClient;
  signTransaction: SignFn;
  /** Addresses this tx is allowed to transfer to (the plan's send recipients).
   *  Enoki rejects sponsored transfers to non-allow-listed addresses. */
  allowedAddresses?: string[];
}): Promise<string> {
  const { tx, sender, network, suiClient, signTransaction, allowedAddresses } =
    args;

  tx.setSender(sender);
  const kindBytes = await tx.build({
    client: suiClient,
    onlyTransactionKind: true,
  });

  // Enoki also gates which move calls a sponsored tx may make. Aggregator
  // routes (Cetus/Bluefin/7K) hit dynamic packages we can't pre-enumerate, so
  // allow EXACTLY the targets this built transaction actually calls — read off
  // the resolved kind (post-coinWithBalance), deduped.
  const allowedMoveCallTargets = Array.from(
    new Set(
      Transaction.fromKind(kindBytes)
        .getData()
        .commands.flatMap((c) =>
          c.$kind === "MoveCall"
            ? [`${c.MoveCall.package}::${c.MoveCall.module}::${c.MoveCall.function}`]
            : []
        )
    )
  );

  const sponsorRes = await apiFetch("/api/sponsor-tx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      network,
      transactionKindBytes: toBase64(kindBytes),
      sender,
      allowedAddresses,
      allowedMoveCallTargets,
    }),
  });
  if (!sponsorRes.ok) {
    // Step 2 failed — no wallet prompt happened yet, so falling back is safe.
    const err = await safeError(sponsorRes);
    throw new SponsorshipUnavailableError(`Sponsorship failed: ${err}`);
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
