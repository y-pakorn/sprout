import { useCurrentClient } from "@mysten/dapp-kit-react";
import {
  Transaction as SuiTransaction,
  coinWithBalance,
  type Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import {
  resolveSymbol,
  canonicalCoinType,
  type CoinMap,
} from "@/lib/client-coins";
import { fetchVaults, fetchDeployment } from "@/lib/client-vaults";
import type { SuiVault } from "@/lib/vaults";
import { loadVaultReceiptIndex } from "@/lib/vault-receipt-index";
import {
  appendDepositCall,
  appendRedeemCall,
  appendCancelRedeemCall,
} from "@/lib/ember-actions";
import { metaAg, metaQuote, quoteOut, extractRoute } from "@/lib/seven-k";
import { getTokenPrices, computeImpactFromAmounts } from "@/lib/bluefin7k";
import type {
  RawStep,
  ResolvedStep,
  ResolvedSwapStep,
  ResolvedSplitStep,
  ResolvedDepositStep,
  ResolvedRedeemStep,
  ResolvedCancelRedeemStep,
  CachedActionPlan,
} from "@/lib/ai/action-plan-cache";

/** The dapp-kit core client shape (used here only for the gas dryRun). */
export type SuiClientLike = ReturnType<typeof useCurrentClient>;

export type BuildPlanArgs = {
  steps: RawStep[];
  /** Sender address — coin selection + simulation are done as this account. */
  sender: string;
  coinMap: CoinMap | null;
  /** Pre-fetched vault list, if the caller already has one; else we fetch. */
  vaultList: SuiVault[] | null;
  /** Global slippage (%), applied to swap steps with no per-step override. */
  slippagePct: number;
  /** Core client for the gas dryRun. */
  client: SuiClientLike;
  /** When false, skip the dryRun and fall back to `prevGasSui` / heuristic. */
  estimateGas: boolean;
  /** Previously-computed real gas (SUI) to preserve on silent rebuilds. */
  prevGasSui?: number;
};

export type BuiltPlan = {
  tx: Transaction;
  resolved: ResolvedStep[];
  summary: CachedActionPlan["summary"];
};

/**
 * Pure PTB builder for an executePlan tool call. Fetches the vault/deployment
 * context it needs, assembles every step into a single shared transaction
 * (topo-sorted by handle dependencies), transfers any orphan coin Results back
 * to the sender, and estimates gas via dryRun. Returns the transaction plus the
 * resolved step metadata and a header summary. No React / no dispatch — the
 * caller owns caching and the tool-result round-trip.
 */
export async function buildPlanTransaction(args: BuildPlanArgs): Promise<BuiltPlan> {
  const { steps, sender, coinMap: map, vaultList, slippagePct, client } = args;

  // Vault list + deployment are needed for any step that touches the
  // gateway (deposit, redeem, cancel).
  const needsVaults = steps.some(
    (s) =>
      s.kind === "deposit" ||
      s.kind === "redeemFromVault" ||
      s.kind === "cancelRedeemFromVault"
  );
  const vaults = needsVaults ? vaultList ?? (await fetchVaults()) : null;
  const deployment = needsVaults ? await fetchDeployment() : null;
  // Receipt-coin index lets us resolve receipt symbols (e.g. ercUSD) that
  // aren't in the standard coin map — needed for redeemFromVault AND for
  // swaps whose input is a vault share (so resolveOrigin can resolve them
  // and we can flag the redeem-vs-swap tradeoff).
  const needsReceiptIndex =
    needsVaults || steps.some((s) => s.kind === "swap");
  const vaultByReceipt = needsReceiptIndex
    ? await loadVaultReceiptIndex()
    : new Map<string, never>();

  const tx = new SuiTransaction();
  tx.setSender(sender);

  type HandleEntry = {
    arg: TransactionObjectArgument;
    symbol: string;
    coinType: string;
    decimals: number;
    expectedHuman: number;
  };
  const handles = new Map<string, HandleEntry>();
  // Handle ids consumed by a downstream step. Any handle NOT in this set
  // by the end of the steps walk is a Result coin that nothing took
  // ownership of — we must explicitly transfer those to the sender or
  // Sui will reject the PTB with `UnusedValueWithoutDrop`.
  const consumedHandles = new Set<string>();
  const resolved: ResolvedStep[] = [];

  function resolveOrigin(
    step: RawStep,
    /** When false, don't pre-add a coinWithBalance Result to the tx
     *  for balance-based origins. 7K's buildTx pulls its own input
     *  coin via getSplitCoinForTx when no coinIn is given — pre-
     *  adding our own would leave it as an orphan Result. */
    addCoinToTx = true
  ): HandleEntry {
    if (step.fromHandle) {
      const h = handles.get(step.fromHandle);
      if (!h) {
        const available = Array.from(handles.keys()).join(", ") || "(none)";
        throw new Error(
          `Step ${step.id}: handle '${step.fromHandle}' has not been produced yet by the time this step runs. Available handles at this point: [${available}]. This usually means an upstream step failed or the id reference is mistyped. FIX: verify the upstream step's id matches and retry executePlan.`
        );
      }
      consumedHandles.add(step.fromHandle);
      return h;
    }
    if (!step.fromSymbol || step.fromAmount == null) {
      throw new Error(
        `Step ${step.id}: missing origin — provide either fromHandle or fromSymbol+fromAmount.`
      );
    }
    const coin = resolveSymbol(map, step.fromSymbol);
    if (coin) {
      if (!addCoinToTx) {
        // Metadata-only: 7K's buildTx will pull from sender balance.
        return {
          arg: null as unknown as TransactionObjectArgument,
          symbol: step.fromSymbol.toUpperCase(),
          coinType: coin.coin_type,
          decimals: coin.decimals,
          expectedHuman: step.fromAmount,
        };
      }
      const raw = BigInt(Math.floor(step.fromAmount * 10 ** coin.decimals));
      const arg = tx.add(
        coinWithBalance({ balance: raw, type: coin.coin_type })
      ) as unknown as TransactionObjectArgument;
      return {
        arg,
        symbol: step.fromSymbol.toUpperCase(),
        coinType: coin.coin_type,
        decimals: coin.decimals,
        expectedHuman: step.fromAmount,
      };
    }
    // Fall back: receipt coin (vault share token) symbol lookup. Receipt
    // tokens aren't in the standard coin map — they live in the vault
    // receipt index.
    const wantSym = step.fromSymbol.toUpperCase();
    for (const ct of vaultByReceipt.keys()) {
      // The receipt symbol is the trailing :: segment of the coin type.
      const sym = ct.split("::").pop()?.toUpperCase();
      if (sym !== wantSym) continue;
      const entry = vaultByReceipt.get(ct) as { shareDecimals: number };
      const decimals = entry.shareDecimals;
      if (!addCoinToTx) {
        // Metadata-only (balance-based swap): 7K's buildTx pulls the
        // receipt coin from the sender — adding our own coinWithBalance
        // here would orphan a Result and break the swap.
        return {
          arg: null as unknown as TransactionObjectArgument,
          symbol: wantSym,
          coinType: ct,
          decimals,
          expectedHuman: step.fromAmount,
        };
      }
      const raw = BigInt(Math.floor(step.fromAmount * 10 ** decimals));
      const arg = tx.add(
        coinWithBalance({ balance: raw, type: ct, useGasCoin: false })
      ) as unknown as TransactionObjectArgument;
      return {
        arg,
        symbol: wantSym,
        coinType: ct,
        decimals,
        expectedHuman: step.fromAmount,
      };
    }
    throw new Error(
      `Step ${step.id}: unknown token symbol '${step.fromSymbol}'. If you meant a vault receipt token, use the symbol from getVaultBalance.positions[].receiptCoinSymbol.`
    );
  }

  // Topo-sort steps by fromHandle dependencies. The agent may emit
  // them in any order; we walk the DAG so each step runs after the
  // step it consumes. Steps with no fromHandle (drawn directly from
  // balance) have no deps.
  const stepById = new Map<string, RawStep>();
  for (const s of steps) {
    if (stepById.has(s.id)) {
      throw new Error(`Duplicate step id '${s.id}' in plan.`);
    }
    stepById.set(s.id, s);
  }
  function depsOf(s: RawStep): string[] {
    const out: string[] = [];
    if (s.fromHandle) out.push(s.fromHandle);
    if (s.fromHandles) out.push(...s.fromHandles);
    // Strip ".N" indexing — "split1.0" → "split1".
    return out.map((h) => h.split(".")[0]);
  }
  const sorted: RawStep[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function checkHandleShape(s: RawStep, handle: string) {
    const dep = handle.split(".")[0];
    const parent = stepById.get(dep);
    if (!parent) {
      const ids = Array.from(stepById.keys()).join(", ") || "(none)";
      throw new Error(
        `Step ${s.id}: unknown handle '${handle}'. No upstream step has id '${dep}'. Existing step ids in this plan: [${ids}]. FIX: either rename your upstream step to '${dep}', or change ${s.id}.fromHandle to reference an existing id. Then retry executePlan.`
      );
    }
    const hasDot = handle.includes(".");
    if (hasDot && parent.kind !== "split") {
      throw new Error(
        `Step ${s.id}: handle '${handle}' uses split-output syntax \`<id>.<i>\` but upstream step '${parent.id}' is a ${parent.kind}, not a split. ${parent.kind} steps produce a single handle '${parent.id}' (no dot). FIX: either (a) use 'fromHandle: \"${parent.id}\"' to consume the whole ${parent.kind} output, or (b) insert a split step between '${parent.id}' and '${s.id}' (e.g. { kind: \"split\", id: \"split_${parent.id}\", fromHandle: \"${parent.id}\", portionsBps: [...] }) and have '${s.id}' reference 'split_${parent.id}.0'. Then retry executePlan.`
      );
    }
    if (!hasDot && parent.kind === "split") {
      throw new Error(
        `Step ${s.id}: handle '${handle}' references split step '${parent.id}' but doesn't pick a portion. Split steps produce indexed handles '${parent.id}.0', '${parent.id}.1', etc. FIX: change ${s.id}.fromHandle to one of those (e.g. '${parent.id}.0'). Then retry executePlan.`
      );
    }
    return parent;
  }
  function visit(s: RawStep) {
    if (visited.has(s.id)) return;
    if (visiting.has(s.id)) {
      throw new Error(`Step ${s.id}: dependency cycle detected.`);
    }
    visiting.add(s.id);
    const handleRefs = [
      ...(s.fromHandle ? [s.fromHandle] : []),
      ...(s.fromHandles ?? []),
    ];
    for (const h of handleRefs) {
      const parent = checkHandleShape(s, h);
      visit(parent);
    }
    void depsOf;
    visiting.delete(s.id);
    visited.add(s.id);
    sorted.push(s);
  }
  for (const s of steps) visit(s);

  for (const step of sorted) {
    // cancelRedeemFromVault has no coin origin — just a vault + sequence.
    if (step.kind === "cancelRedeemFromVault") {
      if (!step.vaultId) {
        throw new Error(`Cancel ${step.id}: missing vaultId.`);
      }
      if (!step.sequenceNumber) {
        throw new Error(
          `Cancel ${step.id}: missing sequenceNumber. Read it from getVaultBalance.withdrawals[].sequenceNumber.`
        );
      }
      if (!vaults || !deployment) {
        throw new Error("Vaults / deployment data not available.");
      }
      const v = vaults.find((x) => x.id === step.vaultId);
      if (!v) {
        throw new Error(
          `Cancel ${step.id}: unknown vault id '${step.vaultId}'.`
        );
      }
      const receiptCoinType =
        v.receiptCoinType ||
        deployment.vaultsByObjectId[v.objectId]?.receiptCoinType ||
        "";
      if (!receiptCoinType) {
        throw new Error(
          `Cancel ${step.id}: no receipt coin type for vault '${v.name}'.`
        );
      }
      let seqBig: bigint;
      try {
        seqBig = BigInt(step.sequenceNumber);
      } catch {
        throw new Error(
          `Cancel ${step.id}: sequenceNumber '${step.sequenceNumber}' is not a valid u128.`
        );
      }
      appendCancelRedeemCall({
        tx,
        gateway: {
          packageId: deployment.packageId,
          protocolConfigId: deployment.protocolConfigId,
        },
        vault: {
          objectId: v.objectId,
          depositCoinType: v.depositCoinType,
          receiptCoinType,
        },
        sequenceNumber: seqBig,
      });
      resolved.push({
        kind: "cancelRedeemFromVault",
        id: step.id,
        vault: v,
        sequenceNumber: step.sequenceNumber,
      });
      continue;
    }

    // Merge has a different origin shape (multiple sources). Handle
    // it before the single-origin resolution.
    if (step.kind === "merge") {
      const sources: Array<{ entry: HandleEntry; label: string }> = [];
      if (step.fromHandles) {
        for (const hId of step.fromHandles) {
          const h = handles.get(hId);
          if (!h) {
            throw new Error(`Merge ${step.id}: unknown handle '${hId}'.`);
          }
          consumedHandles.add(hId);
          sources.push({ entry: h, label: hId });
        }
      }
      if (step.fromSymbol && step.fromAmount != null) {
        const coin = resolveSymbol(map, step.fromSymbol);
        if (!coin) {
          throw new Error(
            `Merge ${step.id}: unknown token '${step.fromSymbol}'.`
          );
        }
        const raw = BigInt(
          Math.floor(step.fromAmount * 10 ** coin.decimals)
        );
        const arg = tx.add(
          coinWithBalance({
            balance: raw,
            type: coin.coin_type,
            useGasCoin: false,
          })
        ) as unknown as TransactionObjectArgument;
        sources.push({
          entry: {
            arg,
            symbol: step.fromSymbol.toUpperCase(),
            coinType: coin.coin_type,
            decimals: coin.decimals,
            expectedHuman: step.fromAmount,
          },
          label: `balance:${step.fromSymbol.toUpperCase()}`,
        });
      }
      if (sources.length < 2) {
        throw new Error(
          `Merge ${step.id}: needs at least 2 source coins (fromHandles + optional fromSymbol/fromAmount).`
        );
      }
      // All sources must share coin type
      const ct = canonicalCoinType(sources[0].entry.coinType);
      for (const s of sources.slice(1)) {
        if (canonicalCoinType(s.entry.coinType) !== ct) {
          throw new Error(
            `Merge ${step.id}: source coin types don't match — got ${sources[0].entry.symbol} and ${s.entry.symbol}. Can only merge same-token coins.`
          );
        }
      }
      const [dest, ...rest] = sources;
      tx.mergeCoins(
        dest.entry.arg,
        rest.map((r) => r.entry.arg)
      );
      const totalHuman = sources.reduce(
        (s, x) => s + x.entry.expectedHuman,
        0
      );
      handles.set(step.id, {
        arg: dest.entry.arg,
        symbol: dest.entry.symbol,
        coinType: dest.entry.coinType,
        decimals: dest.entry.decimals,
        expectedHuman: totalHuman,
      });
      resolved.push({
        kind: "merge",
        id: step.id,
        symbol: dest.entry.symbol,
        coinType: dest.entry.coinType,
        decimals: dest.entry.decimals,
        totalHuman,
        sources: sources.map((s) => ({
          label: s.label,
          human: s.entry.expectedHuman,
        })),
      });
      continue;
    }

    // MetaAg requires an explicit coinIn for swaps, so always materialize
    // the origin coin (balance → coinWithBalance, or the upstream handle).
    const origin = resolveOrigin(step, true);

    if (step.kind === "swap") {
      if (!step.toSymbol) {
        throw new Error(`Swap ${step.id}: missing toSymbol.`);
      }
      // Vault receipt tokens (ercUSD, eACRED, …) can be swapped when an
      // aggregator has a route — tagged so the Guardian surfaces the
      // redeem-vs-swap tradeoff.
      const fromVaultEntry = vaultByReceipt.get(
        canonicalCoinType(origin.coinType)
      );
      const outCoin = resolveSymbol(map, step.toSymbol);
      if (!outCoin) {
        throw new Error(
          `Swap ${step.id}: unknown destination token '${step.toSymbol}'.`
        );
      }
      const slip = step.slippagePct ?? slippagePct;
      const amountInRaw = BigInt(
        Math.floor(origin.expectedHuman * 10 ** origin.decimals)
      );

      // Quote across all composable aggregators via the 7K Meta
      // Aggregator and take the best output.
      const quotes = await metaQuote({
        coinTypeIn: origin.coinType,
        coinTypeOut: outCoin.coin_type,
        amountIn: amountInRaw.toString(),
        sender,
      });
      if (quotes.length === 0) {
        throw new Error(
          `Swap ${step.id}: no route for ${origin.symbol} → ${step.toSymbol} on any aggregator.`
        );
      }
      const best = quotes[0];
      const runnerUp = quotes[1];
      const rateImprovementPct =
        runnerUp && quoteOut(runnerUp) > 0
          ? ((quoteOut(best) - quoteOut(runnerUp)) / quoteOut(runnerUp)) *
            100
          : undefined;
      const toHuman = quoteOut(best) / 10 ** outCoin.decimals;

      let impactPct = 0;
      try {
        const prices = await getTokenPrices([
          origin.coinType,
          outCoin.coin_type,
        ]);
        impactPct = computeImpactFromAmounts(
          amountInRaw,
          best.simulatedAmountOut ?? best.amountOut,
          prices[origin.coinType] ?? 0,
          prices[outCoin.coin_type] ?? 0,
          origin.decimals,
          outCoin.decimals
        );
      } catch (e) {
        console.warn(`[plan] swap ${step.id} price impact failed`, e);
      }

      let coinOut: TransactionObjectArgument;
      try {
        coinOut = await metaAg.swap(
          {
            quote: best,
            signer: sender,
            tx: tx as never,
            coinIn: origin.arg as never,
          },
          Math.round(slip * 100) // percent → bps
        );
      } catch (buildErr) {
        const raw = (buildErr as Error).message ?? String(buildErr);
        throw new Error(`Swap ${step.id}: build failed — ${raw}`);
      }

      handles.set(step.id, {
        arg: coinOut as unknown as TransactionObjectArgument,
        symbol: step.toSymbol.toUpperCase(),
        coinType: outCoin.coin_type,
        decimals: outCoin.decimals,
        expectedHuman: toHuman,
      });
      const fromCoinMeta = resolveSymbol(map, origin.symbol);
      const route = extractRoute(best);
      resolved.push({
        kind: "swap",
        id: step.id,
        fromSymbol: origin.symbol,
        fromCoinType: origin.coinType,
        fromDecimals: origin.decimals,
        fromAmountHuman: origin.expectedHuman,
        toSymbol: step.toSymbol.toUpperCase(),
        toCoinType: outCoin.coin_type,
        toDecimals: outCoin.decimals,
        toAmountHuman: toHuman,
        slippagePct: slip,
        hops: route.hops,
        dexes: route.dexes,
        routeSplits: route.splits,
        impactPct,
        provider: best.provider,
        rateImprovementPct,
        comparedProvider: runnerUp?.provider,
        quote: best,
        fromVerified: fromCoinMeta?.verified ?? false,
        toVerified: outCoin.verified,
        fromIcon: fromCoinMeta?.icon_url,
        toIcon: outCoin.icon_url,
        fromVault: fromVaultEntry
          ? {
              vaultName: fromVaultEntry.position.vaultName,
              depositSymbol: fromVaultEntry.position.depositSymbol,
            }
          : undefined,
      });
    } else if (step.kind === "split") {
      if (!step.portionsBps || step.portionsBps.length < 2) {
        throw new Error(
          `Split ${step.id}: portionsBps must have at least 2 entries.`
        );
      }
      const bpsSum = step.portionsBps.reduce((s, b) => s + b, 0);
      if (bpsSum !== 10000) {
        throw new Error(
          `Split ${step.id}: portionsBps must sum to 10000; got ${bpsSum}.`
        );
      }
      const totalRaw = BigInt(
        Math.floor(origin.expectedHuman * 10 ** origin.decimals)
      );
      const portionsRaw: bigint[] = [];
      let runningSum = BigInt(0);
      for (let i = 0; i < step.portionsBps.length; i++) {
        if (i === step.portionsBps.length - 1) {
          portionsRaw.push(totalRaw - runningSum);
        } else {
          const p =
            (totalRaw * BigInt(step.portionsBps[i])) / BigInt(10000);
          portionsRaw.push(p);
          runningSum += p;
        }
      }
      const splitArgs = portionsRaw.map((p) => tx.pure.u64(p));
      // @mysten/sui v2 splitCoins returns a Result (indexable), not an array.
      const splitResult = tx.splitCoins(origin.arg, splitArgs);
      for (let i = 0; i < portionsRaw.length; i++) {
        handles.set(`${step.id}.${i}`, {
          arg: splitResult[i] as unknown as TransactionObjectArgument,
          symbol: origin.symbol,
          coinType: origin.coinType,
          decimals: origin.decimals,
          expectedHuman: Number(portionsRaw[i]) / 10 ** origin.decimals,
        });
      }
      resolved.push({
        kind: "split",
        id: step.id,
        sourceSymbol: origin.symbol,
        sourceCoinType: origin.coinType,
        sourceDecimals: origin.decimals,
        totalHuman: origin.expectedHuman,
        portions: step.portionsBps.map((bps, i) => ({
          bps,
          human: Number(portionsRaw[i]) / 10 ** origin.decimals,
          raw: portionsRaw[i].toString(),
        })),
      });
    } else if (step.kind === "deposit") {
      if (!step.vaultId) {
        throw new Error(`Deposit ${step.id}: missing vaultId.`);
      }
      if (!vaults || !deployment) {
        throw new Error("Vaults / deployment data not available.");
      }
      const v = vaults.find((x) => x.id === step.vaultId);
      if (!v) {
        throw new Error(
          `Deposit ${step.id}: unknown vault id '${step.vaultId}'.`
        );
      }
      if (
        canonicalCoinType(origin.coinType) !==
        canonicalCoinType(v.depositCoinType)
      ) {
        throw new Error(
          `Deposit ${step.id}: vault '${v.name}' expects ${v.depositSymbol} but the source coin is ${origin.symbol}. Insert a swap step that produces ${v.depositSymbol} first.`
        );
      }
      const receiptCoinType =
        v.receiptCoinType ||
        deployment.vaultsByObjectId[v.objectId]?.receiptCoinType ||
        "";
      if (!receiptCoinType) {
        throw new Error(
          `Deposit ${step.id}: no receipt coin type for vault '${v.name}'.`
        );
      }
      appendDepositCall({
        tx,
        gateway: {
          packageId: deployment.packageId,
          protocolConfigId: deployment.protocolConfigId,
        },
        vault: {
          objectId: v.objectId,
          depositCoinType: v.depositCoinType,
          receiptCoinType,
        },
        coinArg: origin.arg,
      });
      resolved.push({
        kind: "deposit",
        id: step.id,
        vault: v,
        sourceSymbol: origin.symbol,
        sourceCoinType: origin.coinType,
        sourceDecimals: origin.decimals,
        amountHuman: origin.expectedHuman,
      });
    } else if (step.kind === "redeemFromVault") {
      if (!step.vaultId) {
        throw new Error(`Redeem ${step.id}: missing vaultId.`);
      }
      if (!vaults || !deployment) {
        throw new Error("Vaults / deployment data not available.");
      }
      const v = vaults.find((x) => x.id === step.vaultId);
      if (!v) {
        throw new Error(
          `Redeem ${step.id}: unknown vault id '${step.vaultId}'.`
        );
      }
      const receiptCoinType =
        v.receiptCoinType ||
        deployment.vaultsByObjectId[v.objectId]?.receiptCoinType ||
        "";
      if (!receiptCoinType) {
        throw new Error(
          `Redeem ${step.id}: no receipt coin type for vault '${v.name}'.`
        );
      }
      if (
        canonicalCoinType(origin.coinType) !==
        canonicalCoinType(receiptCoinType)
      ) {
        throw new Error(
          `Redeem ${step.id}: source coin (${
            origin.symbol
          }) doesn't match vault '${v.name}' receipt token (${
            v.receiptCoinSymbol ?? "share"
          }). Use fromSymbol="${
            v.receiptCoinSymbol ?? "ercUSD"
          }" for this redemption.`
        );
      }
      appendRedeemCall({
        tx,
        gateway: {
          packageId: deployment.packageId,
          protocolConfigId: deployment.protocolConfigId,
        },
        vault: {
          objectId: v.objectId,
          depositCoinType: v.depositCoinType,
          receiptCoinType,
        },
        sharesCoinArg: origin.arg,
      });
      resolved.push({
        kind: "redeemFromVault",
        id: step.id,
        vault: v,
        receiptSymbol: origin.symbol,
        receiptCoinType: origin.coinType,
        receiptDecimals: origin.decimals,
        sharesHuman: origin.expectedHuman,
      });
    }
  }

  // Transfer any unconsumed coin handles to the sender. Without this a
  // solo swap (or any branch whose terminal Result coin isn't deposited
  // or redeemed) leaves an unused PTB Result and Sui rejects the tx
  // with `UnusedValueWithoutDrop`.
  const orphanArgs: TransactionObjectArgument[] = [];
  for (const [id, entry] of handles) {
    if (consumedHandles.has(id)) continue;
    orphanArgs.push(entry.arg);
  }
  if (orphanArgs.length > 0) {
    tx.transferObjects(orphanArgs, tx.pure.address(sender));
  }

  const depositSteps = resolved.filter(
    (s): s is ResolvedDepositStep => s.kind === "deposit"
  );
  const swapSteps = resolved.filter(
    (s): s is ResolvedSwapStep => s.kind === "swap"
  );
  const splitSteps = resolved.filter(
    (s): s is ResolvedSplitStep => s.kind === "split"
  );
  const redeemSteps = resolved.filter(
    (s): s is ResolvedRedeemStep => s.kind === "redeemFromVault"
  );
  const cancelSteps = resolved.filter(
    (s): s is ResolvedCancelRedeemStep => s.kind === "cancelRedeemFromVault"
  );

  const blendedApyPct =
    depositSteps.length > 0
      ? depositSteps.reduce((s, d) => s + d.vault.apyPct, 0) /
        depositSteps.length
      : 0;

  // Real gas estimate via dryRun. Heuristic below is the fallback when
  // dryRun fails (simulated insufficient balance, network blip, etc.).
  // Skipped on silent rebuilds — gas varies negligibly with slippage
  // and an extra tx.build() round-trip increases the chance of racing
  // 7K's SDK on rapid slippage changes.
  const heuristicGasSui =
    0.012 +
    0.004 * depositSteps.length +
    0.006 * swapSteps.length +
    0.004 * redeemSteps.length +
    0.003 * cancelSteps.length;
  let estimatedGasSui = heuristicGasSui;
  if (args.estimateGas) {
    try {
      const sim = await client.core.simulateTransaction({
        transaction: tx,
        include: { effects: true },
      });
      const simTx =
        sim.$kind === "Transaction" ? sim.Transaction : sim.FailedTransaction;
      const gas = simTx.effects?.gasUsed;
      if (gas) {
        const mist =
          BigInt(gas.computationCost) +
          BigInt(gas.storageCost) -
          BigInt(gas.storageRebate);
        // Floor at 0 — a net rebate would otherwise render as negative.
        const sui = Math.max(0, Number(mist) / 1e9);
        if (sui > 0 && Number.isFinite(sui)) estimatedGasSui = sui;
      }
    } catch (e) {
      console.warn(
        "[buildPlanTransaction] gas dryRun failed; falling back to heuristic",
        e
      );
    }
  } else if (args.prevGasSui && args.prevGasSui > 0) {
    // Preserve the previously-computed real gas if we have one — the
    // heuristic is otherwise a step backward on rebuild.
    estimatedGasSui = args.prevGasSui;
  }

  return {
    tx,
    resolved,
    summary: {
      swapCount: swapSteps.length,
      splitCount: splitSteps.length,
      depositCount: depositSteps.length,
      redeemCount: redeemSteps.length,
      cancelCount: cancelSteps.length,
      vaults: depositSteps.map((d) => d.vault),
      blendedApyPct,
      estimatedGasSui,
    },
  };
}
