"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Loader2,
  Check,
  Copy,
  ExternalLink,
  Clock,
  ChevronDown,
  ShieldCheck,
  CircleAlert,
} from "lucide-react";
import {
  useCurrentAccount,
  useCurrentClient,
  useCurrentNetwork,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import type { Transaction } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { decodePaymentLink, isExpired } from "@/lib/payment-link";
import { buildGaslessSend, isGaslessStablecoin } from "@/lib/gasless";
import { buildPlanTransaction } from "@/lib/ai/build-plan-transaction";
import {
  executeSponsored,
  SponsorshipUnavailableError,
} from "@/lib/enoki-sponsor";
import { resolveRecipient } from "@/lib/suins";
import { useCoinMap, resolveSymbol, canonicalCoinType } from "@/lib/client-coins";
import { fetchWalletHoldings, type TokenHolding } from "@/lib/client-wallet";
import { getTokenPrices } from "@/lib/bluefin7k";
import { AssetIcon } from "@/components/asset-icon";
import { PillButton } from "@/components/ui/pill-button";
import { WalletButton } from "@/components/wallet-button";
import { Identicon } from "@/components/ui/identicon";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { shortAddr } from "@/lib/avatar";
import { fmtAmount, fmtAddress, fmtCountdown } from "@/lib/format";
import { scaleIn } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { SuiNetwork } from "@/lib/sui";

type Phase = "idle" | "signing" | "confirming" | "success" | "failure";
type RecipientState =
  | { status: "resolving" }
  | { status: "ok"; address: string; name?: string }
  | { status: "error"; message: string };

const SWAP_BUFFER = 1.05; // headroom over slippage + price drift; excess refunds
const suiscanAccount = (a: string) => `https://suiscan.xyz/mainnet/account/${a}`;
const suiscanTx = (d: string) => `https://suiscan.xyz/mainnet/tx/${d}`;

/** Map any raw build/sign/chain error to one calm, human line. NEVER surface
 *  coin types, addresses, or MIST integers to a payer. */
function humanizePayError(raw: string | undefined): string {
  const s = (raw || "").toLowerCase();
  if (/reject|denied|cancell|declined|user (declined|rejected)/.test(s))
    return "Payment cancelled.";
  if (/insufficient|not enough|exceeds|balance/.test(s))
    return "You don't have enough to cover this payment.";
  if (/slippage|price impact|no route|no quote|liquid/.test(s))
    return "Couldn't get a good swap rate just now — try another token or amount.";
  if (/sponsor|enoki|gas/.test(s)) return "Couldn't cover the gas just now — try again.";
  if (/network|fetch|timeout|429|503|econn/.test(s))
    return "Network hiccup — please try again.";
  return "Couldn't complete the payment. Please try again.";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-[480px]">{children}</div>
    </main>
  );
}

export function PayClient({ blob }: { blob: string }) {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const network = useCurrentNetwork() as SuiNetwork;
  const dAppKit = useDAppKit();
  const coinMap = useCoinMap();

  const signAndExecute = (args: { transaction: Transaction }) =>
    dAppKit.signAndExecuteTransaction(args);
  const signTransaction = (args: { transaction: string }) =>
    dAppKit.signTransaction(args);

  const data = useMemo(() => {
    try {
      return decodePaymentLink(blob);
    } catch {
      return null;
    }
  }, [blob]);

  const [recipient, setRecipient] = useState<RecipientState>({
    status: "resolving",
  });
  const [amountInput, setAmountInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [digest, setDigest] = useState<string | undefined>();
  const [payError, setPayError] = useState<string | null>(null);
  const [sponsored, setSponsored] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [holdings, setHoldings] = useState<TokenHolding[] | null>(null);
  const [payWith, setPayWith] = useState<string | null>(null);
  const [reqPriceUsd, setReqPriceUsd] = useState<number | undefined>();
  const [paidWithSymbol, setPaidWithSymbol] = useState<string | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data) return;
    let alive = true;
    resolveRecipient(data.recipient, client as unknown as SuiGrpcClient)
      .then((r) => {
        if (alive)
          setRecipient({ status: "ok", address: r.address, name: r.name });
      })
      .catch((e: unknown) => {
        if (alive)
          setRecipient({
            status: "error",
            message: (e as Error).message || "Couldn't resolve recipient.",
          });
      });
    return () => {
      alive = false;
    };
  }, [data, client]);

  useEffect(() => {
    if (!data?.expiryMs) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [data?.expiryMs]);

  useEffect(() => {
    if (!account || !coinMap) return;
    let alive = true;
    fetchWalletHoldings(
      account.address,
      client as unknown as Parameters<typeof fetchWalletHoldings>[1],
      coinMap,
    )
      .then((h) => {
        if (alive)
          setHoldings(h.filter((t) => !t.isVaultReceipt && t.balance > 0));
      })
      .catch(() => {
        if (alive) setHoldings([]);
      });
    return () => {
      alive = false;
    };
  }, [account, client, coinMap]);

  useEffect(() => {
    if (!data || !coinMap) return;
    const c = resolveSymbol(coinMap, data.symbol);
    if (!c) return;
    let alive = true;
    getTokenPrices([c.coin_type])
      .then((m) => {
        if (alive)
          setReqPriceUsd(m[c.coin_type] ?? m[canonicalCoinType(c.coin_type)]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [data, coinMap]);

  // Close the pay-with dropdown on outside click (mirrors the wallet menu).
  useEffect(() => {
    if (!pickerOpen) return;
    function onClick(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  if (!data) {
    return (
      <Shell>
        <InfoCard
          title="This payment link is invalid"
          body="The link looks malformed or corrupted. Ask the sender for a fresh one."
        />
      </Shell>
    );
  }

  const expired = isExpired(data, now);
  const coin = resolveSymbol(coinMap, data.symbol);
  const gaslessEligible = coin ? isGaslessStablecoin(coin.coin_type) : false;
  const fixedAmount = data.amount;
  const parsed = Number(amountInput);
  const effectiveAmount =
    fixedAmount != null
      ? fixedAmount
      : Number.isFinite(parsed) && parsed > 0
        ? parsed
        : 0;

  const requestedType = coin ? canonicalCoinType(coin.coin_type) : "";
  const requestedHolding =
    holdings?.find((h) => canonicalCoinType(h.coinType) === requestedType) ??
    null;
  const payWithHolding =
    payWith && holdings ? holdings.find((h) => h.coinType === payWith) ?? null : null;
  const isSwap =
    !!payWithHolding &&
    canonicalCoinType(payWithHolding.coinType) !== requestedType;

  const reqValueUsd =
    reqPriceUsd != null ? effectiveAmount * reqPriceUsd : undefined;
  const inputEstimate =
    payWithHolding &&
    isSwap &&
    reqPriceUsd &&
    payWithHolding.priceUsd &&
    payWithHolding.priceUsd > 0
      ? ((effectiveAmount * reqPriceUsd) / payWithHolding.priceUsd) * SWAP_BUFFER
      : null;

  const swapUnpriced = isSwap && effectiveAmount > 0 && inputEstimate == null;
  const swapShort =
    isSwap &&
    inputEstimate != null &&
    !!payWithHolding &&
    payWithHolding.balance < inputEstimate;
  const sameTokenShort =
    !isSwap &&
    holdings != null &&
    effectiveAmount > 0 &&
    (requestedHolding?.balance ?? 0) < effectiveAmount;

  const selectedSymbol =
    isSwap && payWithHolding ? payWithHolding.symbol : data.symbol;
  const selectedIcon =
    isSwap && payWithHolding ? payWithHolding.iconUrl : coin?.icon_url;
  const noFee = !isSwap && gaslessEligible;

  /** Can this holding cover the requested amount (same-token by units, else by USD)? */
  function holdingCovers(h: TokenHolding): boolean | null {
    if (effectiveAmount <= 0) return null;
    if (canonicalCoinType(h.coinType) === requestedType)
      return h.balance >= effectiveAmount;
    const hv = h.valueUsd ?? (h.priceUsd ? h.balance * h.priceUsd : undefined);
    if (hv == null || reqValueUsd == null) return null;
    return hv >= reqValueUsd * SWAP_BUFFER;
  }

  const recipientReady = recipient.status === "ok";
  const recipientAddr = recipient.status === "ok" ? recipient.address : "";
  const recipientName = recipient.status === "ok" ? recipient.name : undefined;
  const isSelfPay =
    recipientReady && !!account && account.address === recipientAddr;

  const busy = phase === "signing" || phase === "confirming";

  const canPay =
    recipientReady &&
    !!coin &&
    !!account &&
    effectiveAmount > 0 &&
    !swapUnpriced &&
    !swapShort &&
    !sameTokenShort &&
    !busy;

  // The CTA carries its own status — no separate grayed-out mystery.
  let ctaLabel: string;
  if (phase === "signing") ctaLabel = "Confirm in your wallet…";
  else if (phase === "confirming") ctaLabel = "Settling…";
  else if (!recipientReady) ctaLabel = "Resolving recipient…";
  else if (!coin) ctaLabel = `${data.symbol} not supported`;
  else if (effectiveAmount <= 0) ctaLabel = "Enter an amount";
  else if (swapUnpriced) ctaLabel = "Can't price this swap";
  else if (swapShort) ctaLabel = `Not enough ${selectedSymbol}`;
  else if (sameTokenShort) ctaLabel = `Not enough ${data.symbol}`;
  else ctaLabel = `Pay ${fmtAmount(effectiveAmount)} ${data.symbol}`;

  const hint =
    payError ??
    (sameTokenShort && holdings && holdings.length > 0
      ? "Pick another token above to pay with."
      : null);

  async function pay() {
    if (!data || !account || !coin || recipient.status !== "ok") return;
    if (!(effectiveAmount > 0)) return;
    setPayError(null);
    setSponsored(false);
    setPaidWithSymbol(isSwap && payWithHolding ? payWithHolding.symbol : undefined);
    setPhase("signing");
    try {
      let resultDigest: string;
      let sponsoredFlag = false;

      if (!isSwap && gaslessEligible) {
        const built = await buildGaslessSend({
          symbol: data.symbol,
          amountHuman: effectiveAmount,
          recipient: data.recipient,
          sender: account.address,
          coinMap,
          client: client as unknown as SuiGrpcClient,
        });
        const signed = await signAndExecute({ transaction: built.tx });
        resultDigest =
          signed.$kind === "Transaction"
            ? signed.Transaction.digest
            : signed.FailedTransaction.digest;
      } else {
        const { tx } = await buildPlanTransaction({
          steps:
            isSwap && payWithHolding != null && inputEstimate != null
              ? [
                  {
                    kind: "swap",
                    id: "swap1",
                    fromSymbol: payWithHolding.symbol,
                    fromAmount: inputEstimate,
                    toSymbol: data.symbol,
                    slippagePct: 1,
                  },
                  {
                    kind: "send",
                    id: "send1",
                    fromHandle: "swap1",
                    recipient: data.recipient,
                    sendExactRaw: BigInt(
                      Math.floor(effectiveAmount * 10 ** coin.decimals),
                    ).toString(),
                  },
                ]
              : [
                  {
                    kind: "send",
                    id: "send1",
                    fromSymbol: data.symbol,
                    fromAmount: effectiveAmount,
                    recipient: data.recipient,
                  },
                ],
          sender: account.address,
          coinMap,
          vaultList: null,
          slippagePct: 1,
          client,
          estimateGas: false,
          sponsorGas: true,
        });
        const planTx = tx as unknown as Transaction;
        const walletPay = async () => {
          const signed = await signAndExecute({ transaction: planTx });
          return signed.$kind === "Transaction"
            ? signed.Transaction.digest
            : signed.FailedTransaction.digest;
        };
        try {
          resultDigest = await executeSponsored({
            tx: planTx,
            sender: account.address,
            network,
            suiClient: client as unknown as SuiGrpcClient,
            signTransaction,
            allowedAddresses: [recipient.address],
          });
          sponsoredFlag = true;
        } catch (sErr) {
          if (!(sErr instanceof SponsorshipUnavailableError)) throw sErr;
          resultDigest = await walletPay();
        }
      }

      setSponsored(sponsoredFlag);
      setDigest(resultDigest);
      setPhase("confirming");

      try {
        const finalized = await client.core.waitForTransaction({
          digest: resultDigest,
          include: { effects: true },
        });
        const finTx =
          finalized.$kind === "Transaction"
            ? finalized.Transaction
            : finalized.FailedTransaction;
        if (finTx.status.success) {
          setPhase("success");
        } else {
          const err = finTx.status.success ? null : finTx.status.error;
          setPayError(
            humanizePayError(typeof err === "string" ? err : "failed"),
          );
          setPhase("failure");
        }
      } catch {
        setPayError(
          "Sent, but we couldn't confirm it on-chain. Check the explorer in a moment.",
        );
        setPhase("failure");
      }
    } catch (e) {
      setPayError(humanizePayError((e as Error).message));
      setPhase("idle");
    }
  }

  if (expired) {
    return (
      <Shell>
        <InfoCard
          title="This payment link has expired"
          body={`The sender set an expiry${data.title ? ` for "${data.title}"` : ""}. Ask them for a new one.`}
        />
      </Shell>
    );
  }

  // ── Receipt ───────────────────────────────────────────────────────────────
  if (phase === "success" || phase === "failure") {
    const ok = phase === "success";
    return (
      <Shell>
        <motion.div
          variants={scaleIn}
          initial="initial"
          animate="animate"
          className="space-y-5 surface-card p-6 rounded-card shadow-header"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <span
              className={cn(
                "inline-flex size-12 items-center justify-center rounded-full",
                ok
                  ? "bg-deliver-green text-midnight-ink"
                  : "bg-destructive/15 text-destructive",
              )}
            >
              {ok ? (
                <Check className="size-6" strokeWidth={2.6} />
              ) : (
                <CircleAlert className="size-6" strokeWidth={2.2} />
              )}
            </span>
            <div className="space-y-1">
              <div className="text-title font-medium text-midnight-ink">
                {ok
                  ? `Paid ${fmtAmount(effectiveAmount)} ${data.symbol}`
                  : "Payment didn't go through"}
              </div>
              <p className="text-body-sm text-muted-ash">
                {ok
                  ? sponsored || noFee
                    ? "Settled on Sui — no gas fee."
                    : "Settled on Sui."
                  : payError ?? "Nothing left your wallet."}
              </p>
            </div>
          </div>

          {ok ? (
            <div className="space-y-2 surface-panel px-4 py-3 rounded-card">
              <Row label="To">
                <span className="flex items-center gap-1">
                  <RecipientPill address={recipientAddr} name={recipientName} />
                  <AddressActions address={recipientAddr} />
                </span>
              </Row>
              {paidWithSymbol ? (
                <Row label="Paid with">
                  <span className="text-body-sm text-midnight-ink">
                    {paidWithSymbol} → {data.symbol}
                  </span>
                </Row>
              ) : null}
              <Row label="Network fee">
                <span className="text-body-sm text-midnight-ink">
                  {sponsored || noFee ? "Free" : "Paid by Sprout"}
                </span>
              </Row>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            {digest ? (
              <a
                href={suiscanTx(digest)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 text-body-sm font-medium text-midnight-ink"
              >
                View on SuiScan
                <ExternalLink className="size-3.5" strokeWidth={2.2} />
              </a>
            ) : null}
            {!ok ? (
              <PillButton onClick={() => setPhase("idle")} className="w-full py-2.5">
                Try again
              </PillButton>
            ) : null}
          </div>

          <PoweredBy />
        </motion.div>
      </Shell>
    );
  }

  // ── Request / pay ─────────────────────────────────────────────────────────
  return (
    <Shell>
      <motion.div
        variants={scaleIn}
        initial="initial"
        animate="animate"
        className="space-y-5 surface-card p-6 rounded-card shadow-header"
      >
        {/* Brand + gasless chip */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Seedling className="size-4 text-midnight-ink" />
            <span className="text-body-sm font-medium tracking-[-0.01em] text-midnight-ink">
              Sprout Pay
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-caption font-medium uppercase tracking-wider text-muted-ash">
            <span className="inline-block size-1.5 bg-deliver-green rounded-full" />
            {noFee ? "No gas" : "Gas on Sprout"}
          </span>
        </div>

        {/* Hero */}
        <div className="space-y-3">
          <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
            {fixedAmount != null ? "Requesting" : "Pay any amount"}
          </div>
          <div className="flex items-center gap-3">
            <AssetIcon src={coin?.icon_url} label={data.symbol} size={40} />
            {fixedAmount != null ? (
              <div className="flex items-baseline gap-2">
                <span className="text-display font-medium tabular-nums tracking-[-0.03em] text-midnight-ink">
                  {fmtAmount(fixedAmount)}
                </span>
                <span className="text-body-lg text-muted-ash">{data.symbol}</span>
              </div>
            ) : (
              <div className="flex flex-1 items-baseline gap-2">
                <input
                  autoFocus
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value.replace(/[^0-9.]/g, ""));
                    setPayError(null);
                  }}
                  placeholder="0"
                  className="w-full min-w-0 bg-transparent text-display font-medium tabular-nums tracking-[-0.03em] text-midnight-ink outline-none placeholder:text-light-taupe"
                />
                <span className="text-body-lg text-muted-ash">{data.symbol}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-body-sm text-muted-ash">to</span>
            {recipientReady ? (
              <>
                <RecipientPill address={recipientAddr} name={recipientName} />
                <AddressActions address={recipientAddr} />
              </>
            ) : recipient.status === "error" ? (
              <span className="text-body-sm text-destructive">
                couldn&apos;t resolve {data.recipient}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-body-sm text-muted-ash">
                <Loader2 className="size-3 animate-spin" strokeWidth={2.2} />
                resolving {data.recipient}…
              </span>
            )}
          </div>
          {data.title ? (
            <p className="text-body text-midnight-ink">{data.title}</p>
          ) : null}
          {data.expiryMs ? (
            <p className="inline-flex items-center gap-1 text-caption text-muted-ash">
              <Clock className="size-3" strokeWidth={2.2} />
              Expires in {fmtCountdown(data.expiryMs, now)}
            </p>
          ) : null}
        </div>

        {/* Pay-with dropdown (connected) */}
        {account ? (
          <div className="space-y-1.5">
            <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
              Pay with
            </div>
            <div ref={pickerRef} className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                disabled={busy || !holdings || holdings.length === 0}
                className="flex w-full items-center justify-between gap-2 surface-panel px-3.5 py-2.5 transition-colors rounded-card hover:bg-light-taupe disabled:opacity-60"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <AssetIcon src={selectedIcon} label={selectedSymbol} size={22} />
                  <span className="text-body-sm font-medium text-midnight-ink">
                    {selectedSymbol}
                  </span>
                  {isSwap ? (
                    <span className="text-caption text-muted-ash">
                      → {data.symbol}
                    </span>
                  ) : null}
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-ash transition-transform",
                    pickerOpen && "rotate-180",
                  )}
                  strokeWidth={2.2}
                />
              </button>
              <AnimatePresence>
                {pickerOpen ? (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ type: "spring", visualDuration: 0.25, bounce: 0.2 }}
                    className="absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-64 origin-top space-y-0.5 overflow-auto bg-canvas-white p-1.5 ring-1 ring-hairline shadow-header rounded-card"
                  >
                    {holdings == null ? (
                      <p className="px-2.5 py-2 text-caption text-muted-ash">
                        Loading your tokens…
                      </p>
                    ) : holdings.length === 0 ? (
                      <p className="px-2.5 py-2 text-caption text-muted-ash">
                        No spendable tokens in this wallet.
                      </p>
                    ) : (
                      holdings.map((h) => {
                        const isReq =
                          canonicalCoinType(h.coinType) === requestedType;
                        const covers = holdingCovers(h);
                        return (
                          <button
                            key={h.coinType}
                            type="button"
                            onClick={() => {
                              setPayWith(isReq ? null : h.coinType);
                              setPickerOpen(false);
                              setPayError(null);
                            }}
                            className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left transition-colors rounded-button hover:bg-whisper-gray"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <AssetIcon src={h.iconUrl} label={h.symbol} size={20} />
                              <span className="truncate text-body-sm text-midnight-ink">
                                {h.symbol}
                              </span>
                              {isReq ? (
                                <span className="text-caption text-muted-ash">
                                  requested
                                </span>
                              ) : null}
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              {covers === false ? (
                                <span className="text-caption text-muted-ash">
                                  low
                                </span>
                              ) : null}
                              <span
                                className={cn(
                                  "text-caption tabular-nums",
                                  covers === false
                                    ? "text-muted-ash/60"
                                    : "text-muted-ash",
                                )}
                              >
                                {fmtAmount(h.balance)}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        ) : null}

        {/* Breakdown */}
        <div className="space-y-2 surface-panel px-4 py-3 rounded-card">
          {account ? (
            <Row label="You pay">
              <span className="text-body-sm tabular-nums text-midnight-ink">
                {isSwap
                  ? inputEstimate != null
                    ? `~${fmtAmount(inputEstimate)} ${selectedSymbol}`
                    : `— ${selectedSymbol}`
                  : effectiveAmount > 0
                    ? `${fmtAmount(effectiveAmount)} ${data.symbol}`
                    : `— ${data.symbol}`}
              </span>
            </Row>
          ) : null}
          <Row label="Recipient gets">
            <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
              {effectiveAmount > 0
                ? `exactly ${fmtAmount(effectiveAmount)} ${data.symbol}`
                : `— ${data.symbol}`}
            </span>
          </Row>
          <Row label="Network fee">
            <span className="text-body-sm text-midnight-ink">
              {noFee ? "Free" : "Paid by Sprout"}
            </span>
          </Row>
        </div>

        {/* Trust line */}
        {recipientReady ? (
          <p className="flex items-start gap-1.5 text-caption leading-relaxed text-muted-ash">
            <ShieldCheck
              className="mt-px size-3.5 shrink-0 text-muted-ash"
              strokeWidth={2}
            />
            <span>
              {isSwap
                ? `Sprout swaps ${selectedSymbol} → ${data.symbol} and sends the exact amount; any excess returns to you. `
                : ""}
              Irreversible — paying {recipientName ? `${recipientName} ` : ""}
              <span className="font-mono">{fmtAddress(recipientAddr, 8, 6)}</span>
              {isSelfPay ? " (your own wallet)" : ""}.
            </span>
          </p>
        ) : null}

        {/* Action */}
        {!account ? (
          <div className="space-y-2">
            <WalletButton />
            <p className="text-center text-caption text-muted-ash">
              Connect a wallet to pay — gasless, with any token you hold.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <PillButton onClick={pay} disabled={!canPay} className="w-full py-3">
              {busy ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2.4} />
              ) : null}
              {ctaLabel}
            </PillButton>
            {hint ? (
              <p
                className={cn(
                  "text-center text-caption",
                  payError ? "text-destructive" : "text-muted-ash",
                )}
              >
                {hint}
              </p>
            ) : null}
          </div>
        )}

        <PoweredBy />
      </motion.div>
    </Shell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body-sm text-muted-ash">{label}</span>
      {children}
    </div>
  );
}

function RecipientPill({ address, name }: { address: string; name?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 surface-panel px-2 py-1 ring-1 ring-hairline rounded-full">
      <Identicon address={address} size={16} />
      <span className="text-body-sm font-medium text-midnight-ink">
        {name ?? shortAddr(address)}
      </span>
    </span>
  );
}

/** Copy-address + open-in-SuiScan actions for an address. */
function AddressActions({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked
    }
  }
  const btn =
    "inline-flex size-6 items-center justify-center text-muted-ash transition-colors rounded-button hover:bg-whisper-gray hover:text-midnight-ink";
  return (
    <span className="inline-flex items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={copy}
              aria-label="Copy address"
              className={btn}
            />
          }
        >
          {copied ? (
            <Check className="size-3.5 text-deliver-green" strokeWidth={2.6} />
          ) : (
            <Copy className="size-3.5" strokeWidth={2.2} />
          )}
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : "Copy address"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <a
              href={suiscanAccount(address)}
              target="_blank"
              rel="noreferrer"
              aria-label="View address on SuiScan"
              className={btn}
            />
          }
        >
          <ExternalLink className="size-3.5" strokeWidth={2.2} />
        </TooltipTrigger>
        <TooltipContent>View on SuiScan</TooltipContent>
      </Tooltip>
    </span>
  );
}

function PoweredBy() {
  return (
    <p className="text-center text-caption text-muted-ash/70">
      Powered by Sprout · Sui
    </p>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      className="space-y-2 surface-card p-6 rounded-card shadow-header"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center bg-whisper-gray text-muted-ash rounded-full">
          <CircleAlert className="size-4" strokeWidth={2.2} />
        </span>
        <span className="text-body font-medium text-midnight-ink">{title}</span>
      </div>
      <p className="text-body-sm text-muted-ash">{body}</p>
      <PoweredBy />
    </motion.div>
  );
}

/** Filled-seedling brand mark (matches the navbar SproutLogo paths). */
function Seedling({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 22C11.3 18 11.4 14 12.4 10.5"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.4 12.8C11.8 7.8 8.6 3.9 3.1 4 2.2 9 5.4 12.9 11.4 12.8Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <path
        d="M12.6 11C12 6.2 14.9 2.4 20.4 2.6 21.6 7.3 18.7 11.2 12.6 11Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}
