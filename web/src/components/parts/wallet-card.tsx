"use client";

import { motion } from "motion/react";
import { AssetIcon } from "@/components/asset-icon";
import { truncateCoinType } from "@/lib/client-coins";

export type WalletBalance = {
  symbol: string;
  balance: number;
  coinType: string;
  known: boolean;
};

type IconLookup = (coinType: string) => string | undefined;

type Props = {
  balances: WalletBalance[];
  iconLookup: IconLookup;
};

function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (n >= 0.0001) return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return n.toExponential(2);
}

/**
 * Portfolio card listing every non-zero token balance.
 * Shown after getBalances resolves.
 */
export function WalletCard({ balances, iconLookup }: Props) {
  if (balances.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="bg-cloud-gray px-5 py-4 text-body-sm text-subtle-gray"
        style={{ borderRadius: 24 }}
      >
        Wallet is empty — no token balances found.
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.35, bounce: 0.18 }}
      className="bg-cloud-gray p-2"
      style={{ borderRadius: 24, maxWidth: 460 }}
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-3">
        <span className="text-body-sm font-semibold text-midnight-black">
          Your wallet
        </span>
        <span className="text-caption font-medium text-subtle-gray">
          {balances.length} token{balances.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {balances.map((b, i) => (
          <motion.li
            key={b.coinType}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * i, duration: 0.2 }}
            className="flex items-center gap-3 bg-canvas-white px-3 py-2.5"
            style={{ borderRadius: 18 }}
          >
            <AssetIcon
              src={iconLookup(b.coinType)}
              label={b.symbol}
              size={32}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-sm font-semibold text-midnight-black">
                {b.symbol}
              </span>
              {!b.known && (
                <span
                  className="truncate text-caption text-subtle-gray"
                  title={b.coinType}
                >
                  {truncateCoinType(b.coinType)}
                </span>
              )}
            </div>
            <span className="text-body-sm font-semibold tabular-nums text-midnight-black">
              {formatAmount(b.balance)}
            </span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}
