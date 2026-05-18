"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  Loader2,
  Check,
  ExternalLink,
  X as XIcon,
} from "lucide-react";
import {
  useSignAndExecuteTransaction,
  useSuiClient,
  useCurrentAccount,
} from "@mysten/dapp-kit";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { AssetIcon } from "@/components/asset-icon";
import type { VaultBalancePosition } from "@/lib/vault-balance";
import { fetchDeployment } from "@/lib/client-vaults";
import { appendRedeemCall } from "@/lib/ember-actions";
import { fmtAmount, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  position: VaultBalancePosition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful redeem to refresh the parent's data. */
  onSuccess?: () => void;
};

type State =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "confirming"; digest: string }
  | { kind: "done"; digest: string }
  | { kind: "error"; message: string };

/**
 * Workspace-mode modal for requesting a withdrawal from an Ember vault.
 * Calls `gateway::redeem_shares<T, R>` directly (no agent involvement).
 * Funds are queued by the protocol and processed after the vault's
 * withdrawal lockup window — the user gets a pending request, not coin.
 */
export function RedeemDialog({ position, open, onOpenChange, onSuccess }: Props) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [sharesInput, setSharesInput] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  // Reset state on open
  function onChange(o: boolean) {
    if (!o) {
      setSharesInput("");
      setState({ kind: "idle" });
    }
    onOpenChange(o);
  }

  if (!position) {
    return null;
  }

  const v = position;
  const sharesParsed = Number(sharesInput);
  const sharesValid =
    Number.isFinite(sharesParsed) &&
    sharesParsed > 0 &&
    sharesParsed <= v.shares + 1e-9;
  const usdProceeds = sharesValid ? sharesParsed * v.receiptPriceUsd : 0;
  const lockupDays = v.withdrawalPeriodDays ?? 0;
  const isBusy = state.kind === "signing" || state.kind === "confirming";
  const isDone = state.kind === "done";

  async function submit() {
    if (!account) {
      setState({ kind: "error", message: "Wallet not connected." });
      return;
    }
    if (!sharesValid) {
      setState({ kind: "error", message: "Enter a valid share amount." });
      return;
    }
    setState({ kind: "signing" });
    try {
      const deployment = await fetchDeployment();
      const tx = new Transaction();
      tx.setSender(account.address);
      // Receipt-coin decimals. Every Ember receipt coin shares decimals
      // with its deposit coin (e.g. 6 for USDC vaults), but the share
      // count we have was already scaled — so fetch the canonical
      // decimals from chain metadata at sign-time. Fall back to 6 if the
      // RPC drops the metadata.
      const md = await client.getCoinMetadata({
        coinType: v.receiptCoinType,
      });
      const decimals = md?.decimals ?? 6;
      const raw = BigInt(Math.floor(sharesParsed * 10 ** decimals));
      const shareCoin = tx.add(
        coinWithBalance({
          balance: raw,
          type: v.receiptCoinType,
        }),
      );

      // Locate the on-chain Vault object id. Deployment maps objectId →
      // metadata; iterate to find the vault whose receipt coin matches.
      const vaultObjectId = (() => {
        for (const [oid, entry] of Object.entries(
          deployment.vaultsByObjectId,
        )) {
          if (entry.receiptCoinType === v.receiptCoinType) return oid;
        }
        return null;
      })();
      if (!vaultObjectId) {
        throw new Error(
          `No on-chain vault object found for ${v.vaultName}. Try refreshing.`,
        );
      }

      appendRedeemCall({
        tx,
        gateway: {
          packageId: deployment.packageId,
          protocolConfigId: deployment.protocolConfigId,
        },
        vault: {
          objectId: vaultObjectId,
          depositCoinType: v.depositCoinType,
          receiptCoinType: v.receiptCoinType,
        },
        sharesCoinArg: shareCoin,
      });

      const signed = await signAndExecute({ transaction: tx });
      setState({ kind: "confirming", digest: signed.digest });
      await client.waitForTransaction({
        digest: signed.digest,
        options: { showEffects: true },
      });
      setState({ kind: "done", digest: signed.digest });
      onSuccess?.();
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-midnight-black/55 backdrop-blur-sm data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 transition-opacity duration-200" />
        <Dialog.Popup
          className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-canvas-white shadow-[0_24px_80px_-20px_rgba(0,0,0,0.5)] data-[ending-style]:opacity-0 data-[ending-style]:scale-95 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 transition-[opacity,transform] duration-200"
          style={{ borderRadius: 24 }}
        >
          {/* Header */}
          <div className="flex items-start gap-3 px-5 pb-3 pt-5">
            <AssetIcon
              src={v.vaultLogoUrl}
              label={v.vaultName}
              size={40}
            />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-body-lg font-semibold leading-tight text-midnight-black">
                Withdraw from {v.vaultName}
              </Dialog.Title>
              <p className="mt-0.5 text-caption text-subtle-gray">
                {lockupDays > 0
                  ? `Processed in up to ${lockupDays} days · cancel anytime before`
                  : "Processed shortly"}
              </p>
            </div>
            <Dialog.Close
              className="-mr-1 -mt-1 inline-flex size-7 items-center justify-center text-subtle-gray hover:bg-cloud-gray hover:text-midnight-black"
              style={{ borderRadius: 9999 }}
              disabled={isBusy}
            >
              <XIcon className="size-4" strokeWidth={2.4} />
            </Dialog.Close>
          </div>

          <div className="space-y-3 px-5 pb-5">
            {/* Shares input */}
            <div
              className="space-y-1 bg-cloud-gray px-4 py-3"
              style={{ borderRadius: 18 }}
            >
              <div className="flex items-center justify-between">
                <label className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
                  Shares to redeem
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSharesInput(String(Number(v.shares.toFixed(6))))
                  }
                  className="bg-canvas-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-midnight-black hover:bg-canvas-white/70"
                  style={{ borderRadius: 9999 }}
                  disabled={isBusy}
                >
                  Max
                </button>
              </div>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={sharesInput}
                onChange={(e) => setSharesInput(e.target.value)}
                placeholder="0.0"
                disabled={isBusy}
                className="w-full bg-transparent text-title font-semibold tabular-nums text-midnight-black outline-none placeholder:text-hinting-gray"
              />
              <div className="flex items-center justify-between text-caption text-subtle-gray">
                <span>
                  Balance: {fmtAmount(v.shares)}{" "}
                  {v.receiptCoinSymbol ?? "shares"}
                </span>
                <span className="tabular-nums">
                  ≈ {fmtUsd(usdProceeds)} in {v.depositSymbol}
                </span>
              </div>
            </div>

            {/* Lockup callout */}
            <div
              className="flex items-start gap-2.5 bg-warning/12 px-3.5 py-2.5"
              style={{ borderRadius: 14 }}
            >
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-warning"
                strokeWidth={2.4}
              />
              <p className="text-caption leading-snug text-midnight-black">
                {lockupDays > 0 ? (
                  <>
                    Funds arrive after up to{" "}
                    <strong className="font-semibold">
                      {lockupDays} days
                    </strong>
                    . You can cancel from the Pending tab anytime before
                    processing.
                  </>
                ) : (
                  <>
                    Processed shortly. Funds arrive in your wallet once the
                    operator processes the queue.
                  </>
                )}
              </p>
            </div>

            {/* State feedback */}
            {state.kind === "confirming" && (
              <StateBanner
                tone="info"
                icon={<Loader2 className="size-4 animate-spin" />}
                label="Waiting for finality on Sui…"
                digest={state.digest}
              />
            )}
            {state.kind === "done" && (
              <StateBanner
                tone="ok"
                icon={<Check className="size-4" strokeWidth={2.6} />}
                label="Withdrawal queued"
                digest={state.digest}
              />
            )}
            {state.kind === "error" && (
              <StateBanner
                tone="err"
                icon={<AlertTriangle className="size-4" strokeWidth={2.4} />}
                label={state.message}
              />
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => onChange(false)}
                disabled={isBusy}
                className="bg-cloud-gray px-4 py-2 text-body-sm font-medium text-midnight-black hover:bg-cloud-gray/80 disabled:opacity-50"
                style={{ borderRadius: 9999 }}
              >
                {isDone ? "Close" : "Cancel"}
              </button>
              {!isDone && (
                <motion.button
                  type="button"
                  onClick={submit}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  disabled={isBusy || !sharesValid}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-5 py-2 text-body-sm font-semibold",
                    sharesValid && !isBusy
                      ? "bg-cash-lime text-midnight-black"
                      : "bg-hinting-gray text-canvas-white",
                  )}
                  style={{ borderRadius: 9999 }}
                >
                  {state.kind === "signing" && (
                    <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
                  )}
                  {state.kind === "signing" ? "Signing…" : "Confirm withdraw →"}
                </motion.button>
              )}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function StateBanner({
  tone,
  icon,
  label,
  digest,
}: {
  tone: "info" | "ok" | "err";
  icon: React.ReactNode;
  label: string;
  digest?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3.5 py-2 text-caption font-medium",
        tone === "info" && "bg-cloud-gray text-midnight-black",
        tone === "ok" && "bg-cash-lime/20 text-midnight-black",
        tone === "err" && "bg-destructive/15 text-destructive",
      )}
      style={{ borderRadius: 12 }}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {digest && (
        <a
          href={`https://suiscan.xyz/mainnet/tx/${digest}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-subtle-gray hover:text-midnight-black"
        >
          {digest.slice(0, 6)}…
          <ExternalLink className="size-3" strokeWidth={2.2} />
        </a>
      )}
    </div>
  );
}
