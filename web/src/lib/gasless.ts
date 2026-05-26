import { Transaction } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { resolveRecipient } from "@/lib/suins";
import {
  resolveSymbol,
  canonicalCoinType,
  type CoinMap,
} from "@/lib/client-coins";

/**
 * Sui protocol-level gasless stablecoin transfers (mainnet). A P2P transfer of
 * one of these allowlisted stablecoins via `0x2::balance::send_funds` resolves
 * to gasPrice=0 / gasBudget=0 server-side — the sender needs NO SUI. Only a
 * pure transfer qualifies; it cannot be combined with swaps/deposits, so this
 * lives outside the composite executePlan PTB.
 */
export const GASLESS_STABLECOIN_TYPES = [
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  "0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI",
  "0x41d587e5336f1c86cad50d38a7136db99333bb9bda91cea4ba69115defeb1402::sui_usde::SUI_USDE",
  "0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY",
  "0xf16e6b723f242ec745dfd7634ad072c42d5c1d9ac9d62a39c381303eaa57693a::fdusd::FDUSD",
  "0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2ab8f6b9c8902f14df2ff2::ausd::AUSD",
  "0xe14726c336e81b32328e92afc37345d159f5b550b09fa92bd43640cfdd0a0cfd::usdb::USDB",
] as const;

/** Symbols for prompts / user-facing errors. */
export const GASLESS_SYMBOLS = [
  "USDC",
  "USDSUI",
  "suiUSDe",
  "USDY",
  "FDUSD",
  "AUSD",
  "USDB",
] as const;

const GASLESS_SET = new Set(GASLESS_STABLECOIN_TYPES.map(canonicalCoinType));

export function isGaslessStablecoin(coinType: string): boolean {
  return GASLESS_SET.has(canonicalCoinType(coinType));
}

export type GaslessSend = {
  tx: Transaction;
  symbol: string;
  coinType: string;
  decimals: number;
  amountHuman: number;
  /** Resolved 0x recipient. */
  recipient: string;
  /** Original SuiNS name, when one was used (for display). */
  recipientName?: string;
};

/**
 * Build a gasless stablecoin transfer transaction. Validates the token is on
 * the allowlist and resolves the recipient (0x or SuiNS). The transaction sets
 * no gas — the gRPC client resolves it to gas=0 at build/sign time.
 */
export async function buildGaslessSend(args: {
  symbol: string;
  amountHuman: number;
  recipient: string;
  sender: string;
  coinMap: CoinMap | null;
  client: SuiGrpcClient;
}): Promise<GaslessSend> {
  const { symbol, amountHuman, recipient, sender, coinMap, client } = args;

  const coin = resolveSymbol(coinMap, symbol);
  if (!coin) {
    throw new Error(`Unknown token '${symbol}'.`);
  }
  if (!isGaslessStablecoin(coin.coin_type)) {
    throw new Error(
      `${symbol.toUpperCase()} isn't a gasless-eligible stablecoin (only ${GASLESS_SYMBOLS.join(", ")} qualify). For other tokens, send via a normal plan instead.`,
    );
  }
  if (!(amountHuman > 0)) {
    throw new Error("Amount must be greater than 0.");
  }

  const { address, name } = await resolveRecipient(recipient, client);
  const raw = BigInt(Math.floor(amountHuman * 10 ** coin.decimals));
  if (raw <= BigInt(0)) {
    throw new Error("Amount is too small for this token's precision.");
  }

  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: "0x2::balance::send_funds",
    typeArguments: [coin.coin_type],
    arguments: [
      tx.balance({ type: coin.coin_type, balance: raw }),
      tx.pure.address(address),
    ],
  });

  return {
    tx,
    symbol: symbol.toUpperCase(),
    coinType: coin.coin_type,
    decimals: coin.decimals,
    amountHuman,
    recipient: address,
    recipientName: name,
  };
}
