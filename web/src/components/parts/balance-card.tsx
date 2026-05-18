"use client";

import { motion } from "motion/react";
import { AssetIcon } from "@/components/asset-icon";

type Props = {
  symbol: string;
  balance: number;
  iconUrl?: string;
};

function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (n >= 0.0001) return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return n.toExponential(2);
}

/** Compact single-token balance card. Shown after getBalance resolves. */
export function BalanceCard({ symbol, balance, iconUrl }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className="inline-flex items-center gap-3 bg-cloud-gray px-4 py-3"
      style={{ borderRadius: 24 }}
    >
      <AssetIcon src={iconUrl} label={symbol} size={36} />
      <div className="flex flex-col">
        <span className="text-caption font-medium text-subtle-gray">
          {symbol} balance
        </span>
        <span className="text-body-lg font-semibold leading-none text-midnight-black">
          {formatAmount(balance)}
        </span>
      </div>
    </motion.div>
  );
}
