"use client";

// Single source for Ember Vault gateway PTB calls. Every place that
// constructs deposit / redeem / cancel move calls imports from here so
// argument order, type args, and edge-case quirks (e.g. `redeem_shares`
// putting clock FIRST, unlike `deposit_asset_v2`) live in exactly one
// file. See:
//   https://github.com/ember-protocol/Ember-Vaults/blob/28a2d8e/sources/gateway.move

import type {
  Transaction,
  TransactionObjectArgument,
} from "@mysten/sui/transactions";

type VaultRef = {
  /** On-chain Vault<T, R> object id. */
  objectId: string;
  /** Canonical Move type of the deposit coin (T). */
  depositCoinType: string;
  /** Canonical Move type of the receipt coin (R). */
  receiptCoinType: string;
};

type GatewayRef = {
  /** Move package id of the ember_vaults deployment. */
  packageId: string;
  /** ProtocolConfig shared-object id. */
  protocolConfigId: string;
};

/**
 * Appends `gateway::deposit_asset_v2<T, R>(vault, config, coin, min_shares,
 * receiver, clock)` to `tx`. Receipt token is auto-transferred to the
 * sender. `min_shares = 0` accepts any slippage (v1 default).
 */
export function appendDepositCall(args: {
  tx: Transaction;
  gateway: GatewayRef;
  vault: VaultRef;
  coinArg: TransactionObjectArgument;
  minShares?: bigint;
  receiver?: string | null;
}): void {
  const {
    tx,
    gateway,
    vault,
    coinArg,
    minShares = BigInt(0),
    receiver = null,
  } = args;
  tx.moveCall({
    target: `${gateway.packageId}::gateway::deposit_asset_v2`,
    typeArguments: [vault.depositCoinType, vault.receiptCoinType],
    arguments: [
      tx.object(vault.objectId),
      tx.object(gateway.protocolConfigId),
      coinArg,
      tx.pure.u64(minShares),
      tx.pure.option("address", receiver),
      tx.object.clock(),
    ],
  });
}

/**
 * Appends `gateway::redeem_shares<T, R>(clock, vault, config, shares,
 * receiver)` to `tx`. Note the gateway puts `clock` FIRST here —
 * different from `deposit_asset_v2` — which is the single most
 * accident-prone bit of the contract surface. Queues a withdrawal that
 * the protocol processes after the per-vault lockup window.
 */
export function appendRedeemCall(args: {
  tx: Transaction;
  gateway: GatewayRef;
  vault: VaultRef;
  sharesCoinArg: TransactionObjectArgument;
  receiver?: string | null;
}): void {
  const { tx, gateway, vault, sharesCoinArg, receiver = null } = args;
  tx.moveCall({
    target: `${gateway.packageId}::gateway::redeem_shares`,
    typeArguments: [vault.depositCoinType, vault.receiptCoinType],
    arguments: [
      tx.object.clock(),
      tx.object(vault.objectId),
      tx.object(gateway.protocolConfigId),
      sharesCoinArg,
      tx.pure.option("address", receiver),
    ],
  });
}

/**
 * Appends `gateway::cancel_pending_withdrawal_request<T, R>(vault, config,
 * sequence_number)` to `tx`. Returns the user's shares to their wallet.
 * `sequenceNumber` accepts a bigint (preferred) or a numeric string (from
 * the upstream API).
 */
export function appendCancelRedeemCall(args: {
  tx: Transaction;
  gateway: GatewayRef;
  vault: VaultRef;
  sequenceNumber: bigint | string;
}): void {
  const { tx, gateway, vault, sequenceNumber } = args;
  const seq =
    typeof sequenceNumber === "bigint"
      ? sequenceNumber
      : BigInt(sequenceNumber);
  tx.moveCall({
    target: `${gateway.packageId}::gateway::cancel_pending_withdrawal_request`,
    typeArguments: [vault.depositCoinType, vault.receiptCoinType],
    arguments: [
      tx.object(vault.objectId),
      tx.object(gateway.protocolConfigId),
      tx.pure.u128(seq),
    ],
  });
}
