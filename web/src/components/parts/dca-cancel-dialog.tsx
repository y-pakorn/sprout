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
  Repeat,
} from "lucide-react";
import {
  useDAppKit,
  useCurrentClient,
  useCurrentAccount,
  useCurrentNetwork,
} from "@mysten/dapp-kit-react";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { AssetIcon } from "@/components/asset-icon";
import { buildCancelDcaTx } from "@/lib/seven-k-dca";
import { executeSponsored, SponsorshipUnavailableError } from "@/lib/enoki-sponsor";
import { fmtAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SuiNetwork } from "@/lib/sui";
import type { DcaOrderView } from "@/lib/dca-orders";

type Props = {
  order: DcaOrderView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  iconLookup?: (coinType: string) => string | undefined;
  /** Called after a successful cancel so the parent can refresh. */
  onSuccess?: () => void;
};

type State =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "confirming"; digest: string }
  | { kind: "done"; digest: string }
  | { kind: "error"; message: string };

/**
 * Self-contained one-click DCA cancel (no agent involvement). Builds
 * `cancel_dca_order` via the 7K SDK and signs it — Enoki-sponsored when
 * available, wallet-paid otherwise. Used by the chat orders card and the
 * Portfolio page. Mirrors RedeemDialog.
 */
export function DcaCancelDialog({
  order,
  open,
  onOpenChange,
  iconLookup,
  onSuccess,
}: Props) {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const network = useCurrentNetwork() as SuiNetwork;
  const dAppKit = useDAppKit();
  const [state, setState] = useState<State>({ kind: "idle" });

  function onChange(o: boolean) {
    if (!o) setState({ kind: "idle" });
    onOpenChange(o);
  }

  if (!order) return null;

  const isBusy = state.kind === "signing" || state.kind === "confirming";
  const isDone = state.kind === "done";

  async function submit() {
    if (!order) return;
    if (!account) {
      setState({ kind: "error", message: "Wallet not connected." });
      return;
    }
    setState({ kind: "signing" });
    try {
      const tx = await buildCancelDcaTx({
        orderId: order.orderId,
        payCoinType: order.payCoinType,
        targetCoinType: order.targetCoinType,
      });
      tx.setSender(account.address);

      let digest: string;
      try {
        digest = await executeSponsored({
          tx,
          sender: account.address,
          network,
          suiClient: client as unknown as SuiGrpcClient,
          signTransaction: (args) => dAppKit.signTransaction(args),
        });
      } catch (sponsorErr) {
        if (!(sponsorErr instanceof SponsorshipUnavailableError)) throw sponsorErr;
        const signed = await dAppKit.signAndExecuteTransaction({ transaction: tx });
        digest =
          signed.$kind === "Transaction"
            ? signed.Transaction.digest
            : signed.FailedTransaction.digest;
      }

      setState({ kind: "confirming", digest });
      await client.core.waitForTransaction({ digest, include: { effects: true } });
      setState({ kind: "done", digest });
      onSuccess?.();
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }

  const v = order;

  return (
    <Dialog.Root open={open} onOpenChange={onChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-midnight-ink/30 backdrop-blur-sm data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 transition-opacity duration-200" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-canvas-white shadow-header data-[ending-style]:opacity-0 data-[ending-style]:scale-95 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 transition-[opacity,transform] duration-200 rounded-card">
          {/* Header */}
          <div className="flex items-start gap-3 px-5 pb-3 pt-5">
            <div className="flex items-center">
              <AssetIcon
                src={v.payIcon ?? iconLookup?.(v.payCoinType)}
                label={v.paySymbol}
                size={36}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-body-lg font-medium leading-tight text-midnight-ink">
                Cancel {v.paySymbol} → {v.targetSymbol} DCA
              </Dialog.Title>
              <p className="mt-0.5 inline-flex items-center gap-1 text-caption text-muted-ash">
                <Repeat className="size-3" strokeWidth={2.4} />
                {v.filled}/{v.numOrders} filled · stops future buys
              </p>
            </div>
            <Dialog.Close
              className="-mr-1 -mt-1 inline-flex size-7 items-center justify-center text-muted-ash hover:bg-whisper-gray hover:text-midnight-ink rounded-full"
              disabled={isBusy}
            >
              <XIcon className="size-4" strokeWidth={2.4} />
            </Dialog.Close>
          </div>

          <div className="space-y-3 px-5 pb-5">
            {/* Reclaim callout */}
            <div className="flex items-start gap-2.5 bg-warning/12 px-3.5 py-2.5 rounded-card">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-warning"
                strokeWidth={2.4}
              />
              <p className="text-caption leading-snug text-midnight-ink">
                Cancelling returns the{" "}
                <strong className="font-medium tabular-nums">
                  {fmtAmount(v.remainingHuman)} {v.paySymbol}
                </strong>{" "}
                of unspent funds to your wallet. Already-bought {v.targetSymbol}{" "}
                stays yours. This can&apos;t be undone — you&apos;d place a new
                order to resume.
              </p>
            </div>

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
                label="Order cancelled · funds returned"
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

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => onChange(false)}
                disabled={isBusy}
                className="bg-whisper-gray px-4 py-2 text-body-sm font-medium text-midnight-ink hover:bg-whisper-gray/80 disabled:opacity-50 rounded-button"
              >
                {isDone ? "Close" : "Keep order"}
              </button>
              {!isDone && (
                <motion.button
                  type="button"
                  onClick={submit}
                  whileHover={{ scale: isBusy ? 1 : 1.03 }}
                  whileTap={{ scale: isBusy ? 1 : 0.97 }}
                  disabled={isBusy}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-5 py-2 text-body-sm font-medium rounded-button",
                    isBusy
                      ? "bg-light-taupe text-midnight-ink"
                      : "bg-midnight-ink text-canvas-white",
                  )}
                >
                  {state.kind === "signing" && (
                    <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
                  )}
                  {state.kind === "signing" ? "Signing…" : "Cancel order →"}
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
        "flex items-center gap-2 px-3.5 py-2 text-caption font-medium rounded-card",
        tone === "info" && "bg-whisper-gray text-midnight-ink",
        tone === "ok" && "bg-deliver-green/20 text-midnight-ink",
        tone === "err" && "bg-destructive/15 text-destructive",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {digest && (
        <a
          href={`https://suiscan.xyz/mainnet/tx/${digest}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-muted-ash hover:text-midnight-ink"
        >
          {digest.slice(0, 6)}…
          <ExternalLink className="size-3" strokeWidth={2.2} />
        </a>
      )}
    </div>
  );
}
