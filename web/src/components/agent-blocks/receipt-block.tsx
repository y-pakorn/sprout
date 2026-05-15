"use client";

import { motion } from "motion/react";
import Link from "next/link";
import type { Allocation } from "@/lib/mock-allocation";
import { ExternalLink, Sparkles } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { protocolIconUrl } from "@/lib/protocol-icons";
import { fadeUp, popIn, scaleIn, stagger, SPRING_BOUNCY } from "@/lib/motion";

type Props = {
  digest: string;
  allocation: Allocation;
  asset: string;
  amount: number;
};

export function ReceiptBlock({ digest, allocation, asset, amount }: Props) {
  return (
    <motion.div
      variants={stagger(0.1, 0.08)}
      initial="initial"
      animate="animate"
      className="space-y-6"
    >
      <motion.div variants={fadeUp} className="space-y-3">
        <motion.span
          variants={popIn}
          className="inline-flex items-center gap-1.5 bg-cash-lime px-3 py-1 text-caption font-semibold uppercase tracking-wider text-midnight-black"
          style={{ borderRadius: 9999 }}
        >
          <Sparkles className="size-3" strokeWidth={2.5} />
          Confirmed
        </motion.span>
        <motion.h2
          variants={{
            initial: { opacity: 0, scale: 0.94, y: 8 },
            animate: {
              opacity: 1,
              scale: 1,
              y: 0,
              transition: SPRING_BOUNCY,
            },
          }}
          className="display-tight font-semibold leading-none"
          style={{ fontSize: "var(--text-hero)" }}
        >
          You&apos;re sprouting.
        </motion.h2>
        <motion.p variants={fadeUp} className="text-body-lg text-subtle-gray">
          Your atomic PTB landed on Sui. ${amount.toLocaleString()} {asset} is
          earning across {allocation.legs.length} venue
          {allocation.legs.length === 1 ? "" : "s"}.
        </motion.p>
        <motion.div variants={fadeUp}>
          <Link
            href={`https://suiscan.xyz/mainnet/tx/${digest}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 bg-cloud-gray px-4 py-1.5 font-mono text-body-sm text-midnight-black transition-opacity hover:opacity-80"
            style={{ borderRadius: 9999 }}
          >
            {digest.slice(0, 6)}…{digest.slice(-4)}
            <ExternalLink className="size-3.5" />
          </Link>
        </motion.div>
      </motion.div>

      <motion.div
        variants={scaleIn}
        className="divide-y divide-ghost-border bg-cloud-gray px-6"
        style={{ borderRadius: 24 }}
      >
        <motion.div
          variants={stagger(0.05, 0.06)}
          initial="initial"
          animate="animate"
        >
          {allocation.legs.map((leg) => (
            <motion.div
              key={leg.id}
              variants={fadeUp}
              className="flex items-center justify-between py-3 first:pt-5 last:pb-5"
            >
              <div className="flex items-center gap-3">
                <AssetIcon
                  src={protocolIconUrl(leg.venue)}
                  label={leg.venue}
                  size={36}
                />
                <div>
                  <div className="text-body font-semibold leading-tight">
                    {leg.venue}
                  </div>
                  <div className="text-body-sm text-subtle-gray">
                    {leg.description}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-body font-semibold tabular-nums">
                  $
                  {leg.amountUsd.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </div>
                <div className="text-body-sm text-subtle-gray tabular-nums">
                  {leg.apy.toFixed(2)}% APY
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
