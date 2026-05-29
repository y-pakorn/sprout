"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Copy, Check, ExternalLink, Share2, Clock } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { AssetIcon } from "@/components/asset-icon";
import { PillButton } from "@/components/ui/pill-button";
import { Identicon } from "@/components/ui/identicon";
import { scaleIn } from "@/lib/motion";
import { fmtAmount, fmtAddress, fmtCountdown } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CachedPaymentLink } from "@/lib/ai/action-plan-cache";

type Props = {
  cached: CachedPaymentLink;
  iconLookup: (coinType: string) => string | undefined;
};

export function PaymentLinkCard({ cached, iconLookup }: Props) {
  const { data, url, blob, coinType, gaslessEligible } = cached;
  const recipientLabel =
    cached.recipientName ?? fmtAddress(cached.resolvedRecipient);
  const hasAmount = data.amount != null;
  // Short, readable form of the link — the full base64 blob is ugly. Copy still
  // grabs the real URL; this is just a calm preview.
  const host = url.replace(/^https?:\/\//, "").split("/")[0];
  const shortLink = `${host}/pay/${blob.slice(0, 8)}…`;

  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [canShare] = useState(
    () =>
      typeof navigator !== "undefined" && typeof navigator.share === "function",
  );
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!data.expiryMs) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [data.expiryMs]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked — Share / Open still work
    }
  }

  async function share() {
    const amountLabel = hasAmount
      ? `${fmtAmount(data.amount!)} ${data.symbol}`
      : `any amount of ${data.symbol}`;
    try {
      await navigator.share({
        title: data.title ?? "Sprout payment link",
        text: `Pay ${amountLabel}${data.title ? ` — ${data.title}` : ""}`,
        url,
      });
    } catch {
      // user dismissed the share sheet
    }
  }

  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      className="space-y-4 surface-card p-4 rounded-card"
    >
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
          Payment link
        </span>
        <span className="inline-flex items-center gap-1.5 text-caption font-medium uppercase tracking-wider text-muted-ash">
          <span className="inline-block size-1.5 bg-deliver-green rounded-full" />
          {gaslessEligible ? "Gasless to pay" : "Pay with any token"}
        </span>
      </div>

      {/* Request (hero) + QR */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <AssetIcon src={iconLookup(coinType)} label={data.symbol} size={32} />
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "text-title font-medium tracking-[-0.02em] text-midnight-ink",
                  hasAmount && "tabular-nums",
                )}
              >
                {hasAmount ? fmtAmount(data.amount!) : "Any amount"}
              </span>
              <span className="text-body text-muted-ash">{data.symbol}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-body-sm">
            <span className="text-muted-ash">to</span>
            <span className="inline-flex min-w-0 items-center gap-1.5 surface-panel px-2 py-0.5 ring-1 ring-hairline rounded-full">
              <Identicon address={cached.resolvedRecipient} size={14} />
              <span className="truncate font-medium text-midnight-ink">
                {recipientLabel}
              </span>
            </span>
          </div>
          {data.title ? (
            <p className="truncate text-body-sm text-midnight-ink">
              {data.title}
            </p>
          ) : null}
          {data.expiryMs ? (
            <p className="inline-flex items-center gap-1 text-caption text-muted-ash">
              <Clock className="size-3" strokeWidth={2.2} />
              Expires in {fmtCountdown(data.expiryMs, now)}
            </p>
          ) : null}
        </div>

        {/* Scan-to-pay QR */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <div className="rounded-card bg-canvas-white p-2 ring-1 ring-hairline">
            <QRCodeSVG
              value={url}
              size={84}
              bgColor="#ffffff"
              fgColor="#111111"
              level="M"
              marginSize={0}
            />
          </div>
          <span className="text-caption text-muted-ash">Scan to pay</span>
        </div>
      </div>

      {/* Short link (tap to copy) */}
      <button
        type="button"
        onClick={copy}
        className="flex w-full items-center gap-2 surface-panel px-3 py-2 text-left rounded-card transition-colors hover:bg-light-taupe"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted-ash">
          {shortLink}
        </span>
        {copied ? (
          <Check className="size-3.5 shrink-0 text-deliver-green" strokeWidth={2.6} />
        ) : (
          <Copy className="size-3.5 shrink-0 text-muted-ash" strokeWidth={2.2} />
        )}
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <PillButton onClick={copy} className="flex-1">
          {copied ? (
            <Check className="size-4" strokeWidth={2.6} />
          ) : (
            <Copy className="size-4" strokeWidth={2.2} />
          )}
          {copied ? "Copied" : "Copy link"}
        </PillButton>
        {canShare ? (
          <PillButton variant="secondary" onClick={share}>
            <Share2 className="size-4" strokeWidth={2.2} />
            Share
          </PillButton>
        ) : null}
        <PillButton
          variant="secondary"
          aria-label="Open payment page"
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="size-4" strokeWidth={2.2} />
        </PillButton>
      </div>
    </motion.div>
  );
}
