"use client";

import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useStickToBottom } from "use-stick-to-bottom";
import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";

type SuiClientLike = ReturnType<typeof useCurrentClient>;
import type { Transaction } from "@mysten/sui/transactions";
import { fetchAllBalances, fetchBalance } from "@/lib/grpc-balances";
import { ChatInput } from "@/components/chat-input";
import { ExamplePrompts } from "@/components/example-prompts";
import { AgentMessage } from "@/components/agent-message";
import { ErrorBanner } from "@/components/parts/error-banner";
import { CinematicShell } from "@/components/parts/cinematic-shell";
import { LiquidBlob } from "@/components/parts/liquid-blob";
import { SPRING_BOUNCY } from "@/lib/motion";
import {
  useCoinMap,
  resolveSymbol,
  canonicalCoinType,
} from "@/lib/client-coins";
import { useVaults, fetchVaults } from "@/lib/client-vaults";
import type { SuiVault } from "@/lib/vaults";
import {
  actionPlanCache,
  vaultsListCache,
  type CachedActionPlan,
  type ResolvedSwapStep,
  type ResolvedSplitStep,
  type ResolvedDepositStep,
  type ResolvedRedeemStep,
  type ResolvedCancelRedeemStep,
  type RawStep,
} from "@/lib/ai/action-plan-cache";
import { getGlossary, type GlossaryKey } from "@/lib/ai/vault-glossary";
import { getTokenPrices } from "@/lib/bluefin7k";
import { providerLabel } from "@/lib/seven-k";
import { buildPlanTransaction } from "@/lib/ai/build-plan-transaction";
import type { VaultPosition } from "@/components/parts/wallet-card";
import {
  loadVaultReceiptIndex,
  type VaultReceiptEntry,
} from "@/lib/vault-receipt-index";

// Re-export for legacy local type references. `VaultPosition` import above
// keeps the prop-shape contract with downstream cards stable.
type VaultPositionInfo = VaultReceiptEntry;

export function Conversation() {
  const account = useCurrentAccount();
  const coinMap = useCoinMap();
  const suiClient = useCurrentClient();
  const dAppKit = useDAppKit();
  const signAndExecute = (args: { transaction: Transaction }) =>
    dAppKit.signAndExecuteTransaction(args);

  // Stick-to-bottom for the active conversation. Used via the hook (not the
  // component) so the scroller is an inner div and the scroll-to-bottom button
  // can live in a non-scrolling wrapper that stays pinned to the viewport.
  const stick = useStickToBottom({ resize: "smooth", initial: "smooth" });

  // Refs so onToolCall (which captures first-render closure) always reads
  // the latest wallet/client values without re-subscribing.
  const accountRef = useRef(account);
  accountRef.current = account;
  const suiClientRef = useRef(suiClient);
  suiClientRef.current = suiClient;

  // Slippage state — applies to any swap step inside an executePlan plan.
  // The ref mirror is used by runExecutePlan so silent rebuilds triggered
  // immediately after setSlippagePct see the NEW value, not the stale
  // closure-captured one.
  const [slippagePct, setSlippagePct] = useState(1);
  const slippageRef = useRef(slippagePct);
  slippageRef.current = slippagePct;
  const [signError, setSignError] = useState<string | null>(null);

  // Active plan-deposit state (one plan card may be live at a time).
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [planSigning, setPlanSigning] = useState(false);
  const [planConfirming, setPlanConfirming] = useState(false);
  const [planExecuted, setPlanExecuted] = useState(false);
  const [planTxDigest, setPlanTxDigest] = useState<string | undefined>();
  const [planTxStatus, setPlanTxStatus] = useState<
    "success" | "failure" | undefined
  >();
  const [planTxError, setPlanTxError] = useState<string | undefined>();
  const [planGasSui, setPlanGasSui] = useState<number | undefined>();
  /** Per-vault shares received (in human units), indexed by allocation order. */
  const [planReceivedShares, setPlanReceivedShares] = useState<
    number[] | undefined
  >();

  // Vaults list (cached client-side, fetched once on mount)
  const vaults = useVaults();
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    []
  );

  // Stash addToolResult in a ref so the onToolCall closure always sees
  // the latest binding (useChat returns a new function per render, but
  // the callback we pass to useChat captures the *first* render's value).
  const addToolResultRef = useRef<
    | ((args: {
        tool: string;
        toolCallId: string;
        output: unknown;
      }) => Promise<void> | void)
    | null
  >(null);

  const { messages, sendMessage, addToolResult, regenerate, status, error } =
    useChat({
      transport,
      sendAutomaticallyWhen: ({ messages: msgs }) => {
        // Re-submit when the LAST part of the assistant turn is a resolved
        // tool call (no text after it). This lets the agent chain
        // (getBalance → listVaults → executePlan, getBalances → listVaults
        // → executePlan, etc.) even when it intersperses commentary text
        // BEFORE the tool call. We stop re-firing only when the agent
        // emits text AFTER its last tool result — that's its "I'm done"
        // signal.
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== "assistant") return false;
        let lastToolIdx = -1;
        for (let i = last.parts.length - 1; i >= 0; i--) {
          if (last.parts[i].type.startsWith("tool-")) {
            lastToolIdx = i;
            break;
          }
        }
        if (lastToolIdx === -1) return false;
        const lastTool = last.parts[lastToolIdx] as { state?: string };
        const resolved =
          lastTool.state === "output-available" ||
          lastTool.state === "output-error";
        if (!resolved) return false;
        // If text was emitted AFTER the last tool, the agent is signaling
        // it's done — don't re-fire.
        for (let i = lastToolIdx + 1; i < last.parts.length; i++) {
          const p = last.parts[i] as { type: string; text?: string };
          if (p.type === "text" && p.text?.trim()) return false;
        }
        return true;
      },
      /**
       * onToolCall MUST return quickly. The SDK awaits us, and addToolResult
       * queues a job on the SDK's executor that's blocked on the streaming
       * loop — awaiting addToolResult here would deadlock. So we fire-and-
       * forget the async work; the queued result update lands after the
       * stream's tool-call step finishes.
       */
      onToolCall({ toolCall }) {
        if (toolCall.toolName === "getBalance") {
          void runGetBalance(
            toolCall,
            coinMap,
            accountRef.current,
            suiClientRef.current,
            addToolResultRef
          );
          return;
        }
        if (toolCall.toolName === "getBalances") {
          void runGetBalances(
            toolCall,
            coinMap,
            accountRef.current,
            suiClientRef.current,
            addToolResultRef
          );
          return;
        }
        if (toolCall.toolName === "getVaultBalance") {
          void runGetVaultBalance(
            toolCall,
            accountRef.current,
            suiClientRef.current,
            addToolResultRef
          );
          return;
        }
        if (toolCall.toolName === "listVaults") {
          void runListVaults(toolCall, addToolResultRef);
          return;
        }
        if (toolCall.toolName === "executePlan") {
          void runExecutePlan(
            toolCall,
            coinMap,
            vaultsRef.current,
            accountRef.current,
            addToolResultRef
          );
          return;
        }
        if (toolCall.toolName === "explainConcept") {
          void runExplainConcept(toolCall, addToolResultRef);
          return;
        }
      },
    });

  // Keep the ref pointed at the latest addToolResult
  addToolResultRef.current =
    addToolResult as unknown as typeof addToolResultRef.current;

  // Background work fired by onToolCall — runs to completion after the
  // SDK's streaming step finishes, then dispatches addToolResult which
  // the queued job executor will pick up next.
  type AddResultFn = (args: {
    tool: string;
    toolCallId: string;
    output: unknown;
  }) => Promise<void> | void;

  async function runGetBalance(
    toolCall: { toolCallId: string; input: unknown },
    map: typeof coinMap,
    acct: ReturnType<typeof useCurrentAccount>,
    client: SuiClientLike,
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    if (!acct) {
      await addResult({
        tool: "getBalance",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "Wallet not connected. The user needs to connect a wallet (button in the top-right) before I can read balances.",
        },
      });
      return;
    }
    const { symbol } = toolCall.input as { symbol: string };
    const coin = resolveSymbol(map, symbol);
    if (!coin) {
      await addResult({
        tool: "getBalance",
        toolCallId: toolCall.toolCallId,
        output: {
          error: `Unknown token symbol: ${symbol}. Try USDC, SUI, USDT, WAL, DEEP, or BUCK.`,
        },
      });
      return;
    }
    try {
      const totalBalanceRaw = await fetchBalance(
        client,
        acct.address,
        coin.coin_type
      );
      // If the caller is asking about a vault receipt token, attach the
      // vault position metadata so the result renders as a vault card.
      const vaultByReceipt = await loadVaultReceiptIndex();
      const vaultMatch = vaultByReceipt.get(canonicalCoinType(coin.coin_type));
      const decimals = vaultMatch?.shareDecimals ?? coin.decimals;
      const human = Number(totalBalanceRaw) / 10 ** decimals;
      // USD price: vault receipt tokens come from Bluefin's vault list
      // (the 7K /price endpoint silently drops them — verified). Plain
      // tokens come from the 7K oracle.
      let priceUsd: number | undefined;
      if (vaultMatch?.position.receiptPriceUsd) {
        priceUsd = vaultMatch.position.receiptPriceUsd;
      } else {
        const priceMap = await getTokenPrices([coin.coin_type]).catch(
          () => ({} as Record<string, number>)
        );
        priceUsd = priceMap[coin.coin_type];
      }
      const valueUsd =
        typeof priceUsd === "number" &&
        Number.isFinite(priceUsd) &&
        priceUsd > 0
          ? Number((human * priceUsd).toFixed(6))
          : undefined;
      await addResult({
        tool: "getBalance",
        toolCallId: toolCall.toolCallId,
        output: {
          symbol: symbol.toUpperCase(),
          balance: Number(human.toFixed(6)),
          decimals,
          coinType: coin.coin_type,
          priceUsd,
          valueUsd,
          vaultPosition: vaultMatch?.position,
        },
      });
    } catch (e) {
      await addResult({
        tool: "getBalance",
        toolCallId: toolCall.toolCallId,
        output: { error: `Balance lookup failed: ${(e as Error).message}` },
      });
    }
  }

  async function runGetBalances(
    toolCall: { toolCallId: string; input: unknown },
    map: typeof coinMap,
    acct: ReturnType<typeof useCurrentAccount>,
    client: SuiClientLike,
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    if (!acct) {
      await addResult({
        tool: "getBalances",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "Wallet not connected. The user needs to connect a wallet (button in the top-right) before I can read balances.",
        },
      });
      return;
    }
    try {
      const all = await fetchAllBalances(client, acct.address);
      // Reverse-index coinType → {symbol, decimals} from the known coin map
      const byType = new Map<string, { symbol: string; decimals: number }>();
      if (map) {
        for (const [symbol, info] of Object.entries(map)) {
          // Canonicalize so short-form (0x2::sui::SUI) and long-form
          // (0x000…002::sui::SUI) collide on the same key.
          byType.set(canonicalCoinType(info.coin_type), {
            symbol,
            decimals: info.decimals,
          });
        }
      }
      // Map any receipt-coin types to their vault metadata so balances
      // that are actually Ember vault positions render as such.
      const vaultByReceipt = await loadVaultReceiptIndex();
      type RawBal = { coinType: string; totalBalance: string };
      type OutBal = {
        symbol: string;
        balance: number;
        coinType: string;
        known: boolean;
        priceUsd?: number;
        valueUsd?: number;
        vaultPosition?: VaultPosition;
        /** Internal: pre-canonicalized coin type kept for the price lookup,
         *  removed before forwarding to the agent. */
        rawCoinType?: string;
      };
      const balances: OutBal[] = (all as RawBal[])
        .filter((b) => BigInt(b.totalBalance) > BigInt(0))
        .map((b) => {
          const canonType = canonicalCoinType(b.coinType);
          const known = byType.get(canonType);
          const vault = vaultByReceipt.get(canonType);
          // Receipt coins use the vault's stated decimals (or fall back to
          // the known coin map). Plain coins use known.decimals or 9.
          const decimals = vault?.shareDecimals ?? known?.decimals ?? 9;
          const human = Number(b.totalBalance) / 10 ** decimals;
          return {
            symbol: known?.symbol ?? b.coinType.split("::").pop() ?? "?",
            balance: Number(human.toFixed(6)),
            // Use the canonical type so the icon lookup (also canonicalized
            // via the same coin map) hits.
            coinType: canonType,
            // Vault receipts count as "known" so they don't get the unknown-coin
            // truncated address treatment.
            known: !!known || !!vault,
            vaultPosition: vault?.position,
            // Preserve the original (non-canonical) coin type as well so we
            // can ask getTokenPrices with the form the oracle returns prices
            // for. Sui's full coin types use long hex; the canonical form
            // (with leading zeros) is what dapp-kit reads, while the SDK
            // sometimes prefers the short form.
            rawCoinType: b.coinType,
          };
        })
        .sort((a, b) => {
          // Vault positions float to the top, then known tokens, then others.
          const aRank = a.vaultPosition ? 2 : a.known ? 1 : 0;
          const bRank = b.vaultPosition ? 2 : b.known ? 1 : 0;
          if (aRank !== bRank) return bRank - aRank;
          return b.balance - a.balance;
        });
      // Fetch oracle prices in a single batch and attach to each balance.
      // Try both forms (short + canonical) since the SDK accepts the
      // short-form keys the user sees in tokens API. Best-effort: any
      // missing price just renders without a value column.
      // Query oracle prices for ALL coins. The 7K aggregator's /price
      // endpoint does NOT return prices for Ember vault receipt tokens
      // (verified by curling it with ercUSD + USDC — only USDC came
      // back). For receipt tokens we use the per-share USD price that
      // Bluefin's vault list already gives us instead.
      const priceQueryTypes = Array.from(
        new Set(
          balances.flatMap((b): string[] =>
            b.rawCoinType ? [b.coinType, b.rawCoinType] : [b.coinType]
          )
        )
      );
      const priceMap = await getTokenPrices(priceQueryTypes).catch(
        () => ({} as Record<string, number>)
      );
      for (const b of balances) {
        // Vault positions: use the canonical share price from the vault
        // list (Bluefin's own oracle).
        if (b.vaultPosition?.receiptPriceUsd) {
          b.priceUsd = b.vaultPosition.receiptPriceUsd;
          b.valueUsd = Number(
            (b.balance * b.vaultPosition.receiptPriceUsd).toFixed(6)
          );
          continue;
        }
        // Plain tokens: 7K oracle.
        const p =
          priceMap[b.coinType] ?? priceMap[b.rawCoinType ?? ""] ?? undefined;
        if (typeof p === "number" && Number.isFinite(p) && p > 0) {
          b.priceUsd = p;
          b.valueUsd = Number((b.balance * p).toFixed(6));
        }
      }
      // Resort by USD value (descending) within each rank group now that
      // we have prices.
      balances.sort((a, b) => {
        const aRank = a.vaultPosition ? 2 : a.known ? 1 : 0;
        const bRank = b.vaultPosition ? 2 : b.known ? 1 : 0;
        if (aRank !== bRank) return bRank - aRank;
        const av = a.valueUsd ?? 0;
        const bv = b.valueUsd ?? 0;
        if (av !== bv) return bv - av;
        return b.balance - a.balance;
      });
      // Strip the helper rawCoinType field before sending to the agent.
      for (const b of balances)
        delete (b as { rawCoinType?: string }).rawCoinType;
      await addResult({
        tool: "getBalances",
        toolCallId: toolCall.toolCallId,
        output: { balances },
      });
    } catch (e) {
      await addResult({
        tool: "getBalances",
        toolCallId: toolCall.toolCallId,
        output: { error: `Wallet read failed: ${(e as Error).message}` },
      });
    }
  }

  async function runGetVaultBalance(
    toolCall: { toolCallId: string; input: unknown },
    acct: ReturnType<typeof useCurrentAccount>,
    client: SuiClientLike,
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    if (!acct) {
      await addResult({
        tool: "getVaultBalance",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "Wallet not connected. The user needs to connect a wallet before I can read their vault balance.",
        },
      });
      return;
    }
    try {
      // Fetch in parallel:
      //  1. server-proxied withdrawals + history
      //  2. on-chain token balances (active positions = receipt-coin balances)
      //  3. vault receipt index (vault metadata + canonical share price)
      const [serverRes, allBalances, vaultByReceipt] = await Promise.all([
        fetch(`/api/vault-balance/${acct.address}`, { cache: "no-store" }),
        fetchAllBalances(client, acct.address),
        loadVaultReceiptIndex(),
      ]);
      if (!serverRes.ok) {
        throw new Error(`vault-balance fetch failed: ${serverRes.status}`);
      }
      const server =
        (await serverRes.json()) as import("@/lib/vault-balance").VaultBalanceServerData;
      // Derive positions from wallet balances: every non-zero balance
      // whose coin type is a known vault receipt token is an active
      // position. Vault metadata + share price come from the receipt
      // index (vault list), shares come from chain.
      type RawBal = { coinType: string; totalBalance: string };
      const positions: import("@/lib/vault-balance").VaultBalancePosition[] =
        [];
      for (const b of allBalances as RawBal[]) {
        if (BigInt(b.totalBalance) <= BigInt(0)) continue;
        const canon = canonicalCoinType(b.coinType);
        const match = vaultByReceipt.get(canon);
        if (!match) continue;
        const shares = Number(b.totalBalance) / 10 ** match.shareDecimals;
        const receiptPriceUsd = match.position.receiptPriceUsd ?? 0;
        const positionValueUsd = Number((shares * receiptPriceUsd).toFixed(6));
        positions.push({
          vaultId: match.position.vaultId,
          vaultName: match.position.vaultName,
          vaultLogoUrl: match.position.logoUrl,
          depositSymbol: match.position.depositSymbol,
          depositCoinType: match.position.depositCoinType,
          apyPct: match.position.apyPct,
          category: match.position.category,
          withdrawalPeriodDays: match.position.withdrawalPeriodDays,
          receiptCoinType: canon,
          receiptPriceUsd,
          shares: Number(shares.toFixed(6)),
          positionValueUsd,
        });
      }
      // Sort biggest position first
      positions.sort((a, b) => b.positionValueUsd - a.positionValueUsd);
      const data: import("@/lib/vault-balance").VaultBalance = {
        ...server,
        positions,
      };
      await addResult({
        tool: "getVaultBalance",
        toolCallId: toolCall.toolCallId,
        output: { data },
      });
    } catch (e) {
      await addResult({
        tool: "getVaultBalance",
        toolCallId: toolCall.toolCallId,
        output: {
          error: `Vault balance read failed: ${(e as Error).message}`,
        },
      });
    }
  }

  // ---- Vault tools ----------------------------------------------------

  async function runListVaults(
    toolCall: { toolCallId: string; input: unknown },
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) {
      console.error("[runListVaults] addResult ref is null");
      return;
    }
    const { depositSymbol, limit } = toolCall.input as {
      depositSymbol?: string;
      limit?: number;
    };
    try {
      const all = await fetchVaults();
      let filtered = all;
      if (depositSymbol) {
        const wanted = depositSymbol.toUpperCase();
        filtered = all.filter((v) => v.depositSymbol.toUpperCase() === wanted);
      }
      const top = filtered.slice(0, limit ?? 5);
      vaultsListCache.set(toolCall.toolCallId, {
        vaults: top,
        filteredSymbol: depositSymbol?.toUpperCase(),
      });
      await addResult({
        tool: "listVaults",
        toolCallId: toolCall.toolCallId,
        output: {
          listId: toolCall.toolCallId,
          count: top.length,
          vaults: top.map((v) => ({
            id: v.id,
            name: v.name,
            category: v.category,
            depositSymbol: v.depositSymbol,
            apyPct: Number(v.apyPct.toFixed(3)),
            tvlUsd: Math.round(v.tvlUsd),
            withdrawalPeriodDays: v.withdrawalPeriodDays,
            isPrivate: v.isPrivate,
          })),
        },
      });
    } catch (e) {
      console.error("[runListVaults] failed", e);
      await addResult({
        tool: "listVaults",
        toolCallId: toolCall.toolCallId,
        output: { error: `Vault list failed: ${(e as Error).message}` },
      });
    }
  }

  async function runExplainConcept(
    toolCall: { toolCallId: string; input: unknown },
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { key } = toolCall.input as { key: GlossaryKey };
    const text = getGlossary(key);
    await addResult({
      tool: "explainConcept",
      toolCallId: toolCall.toolCallId,
      output: text ? { key, text } : { error: `Unknown glossary key: ${key}` },
    });
  }

  async function runExecutePlan(
    toolCall: { toolCallId: string; input: unknown },
    map: typeof coinMap,
    vaultList: SuiVault[] | null,
    acct: ReturnType<typeof useCurrentAccount>,
    ref: React.RefObject<AddResultFn | null>,
    /** When true, skip the addResult dispatch — used by handlePlanRefresh
     *  which only needs the cache update + bumpRefresh. */
    silent = false
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    if (!acct) {
      if (!silent) {
        await addResult({
          tool: "executePlan",
          toolCallId: toolCall.toolCallId,
          output: {
            error:
              "Wallet not connected. The user needs to connect a wallet before I can build a transaction plan.",
          },
        });
      }
      return;
    }

    const { steps } = toolCall.input as { steps: RawStep[] };

    try {
      // On silent rebuilds, preserve the previously-computed real gas
      // (buildPlanTransaction skips the dryRun when estimateGas is false).
      const prev = silent
        ? actionPlanCache.get(toolCall.toolCallId)
        : undefined;

      const { tx, resolved, summary } = await buildPlanTransaction({
        steps,
        sender: acct.address,
        coinMap: map,
        vaultList,
        slippagePct: slippageRef.current,
        client: suiClientRef.current,
        estimateGas: !silent,
        prevGasSui: prev?.summary.estimatedGasSui,
      });

      const cached: CachedActionPlan = {
        tx,
        steps: resolved,
        originalInput: steps,
        summary,
        fetchedAt: Date.now(),
      };
      actionPlanCache.set(toolCall.toolCallId, cached);
      if (silent) {
        bumpRefresh((v) => v + 1);
        return;
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

      // Minimal summary back to the model — keeps prompt tokens tight.
      const output = {
        planId: toolCall.toolCallId,
        stepCount: resolved.length,
        swapCount: swapSteps.length,
        splitCount: splitSteps.length,
        depositCount: depositSteps.length,
        redeemCount: redeemSteps.length,
        cancelCount: cancelSteps.length,
        deposits: depositSteps.map((d) => ({
          vaultName: d.vault.name,
          apyPct: Number(d.vault.apyPct.toFixed(3)),
          amount: Number(d.amountHuman.toFixed(6)),
          symbol: d.sourceSymbol,
          withdrawalPeriodDays: d.vault.withdrawalPeriodDays,
        })),
        redeems: redeemSteps.map((r) => ({
          vaultName: r.vault.name,
          shares: Number(r.sharesHuman.toFixed(6)),
          symbol: r.receiptSymbol,
          withdrawalPeriodDays: r.vault.withdrawalPeriodDays,
        })),
        cancels: cancelSteps.map((c) => ({
          vaultName: c.vault.name,
          sequenceNumber: c.sequenceNumber,
        })),
        swaps: swapSteps.map((s) => ({
          id: s.id,
          fromSymbol: s.fromSymbol,
          fromAmount: Number(s.fromAmountHuman.toFixed(6)),
          toSymbol: s.toSymbol,
          toAmount: Number(s.toAmountHuman.toFixed(6)),
          impactPct: Number((s.impactPct ?? 0).toFixed(3)),
          hops: s.hops,
          aggregator: providerLabel(s.provider),
          rateImprovementPct:
            s.rateImprovementPct !== undefined
              ? Number(s.rateImprovementPct.toFixed(3))
              : undefined,
          comparedAggregator: s.comparedProvider
            ? providerLabel(s.comparedProvider)
            : undefined,
        })),
        blendedApyPct: Number(summary.blendedApyPct.toFixed(3)),
      };
      await addResult({
        tool: "executePlan",
        toolCallId: toolCall.toolCallId,
        output,
      });
    } catch (e) {
      console.error("[runExecutePlan] failed", e);
      if (silent) return;
      await addResult({
        tool: "executePlan",
        toolCallId: toolCall.toolCallId,
        output: { error: `Plan build failed: ${(e as Error).message}` },
      });
    }
  }

  // Bump-on-refresh forces React to re-render so AgentMessage re-reads
  // the (mutated) actionPlanCache entry after a slippage-driven rebuild.
  const [, bumpRefresh] = useState(0);

  // Guards against concurrent silent rebuilds (slippage click while
  // the 5s auto-refresh is in flight, or rapid slippage clicks). 7K's
  // buildTx is not safe to call in parallel — concurrent calls produce
  // the "readUint8 is not a function" symptom by corrupting internal
  // SDK state. We drop overlapping requests; the next 5s poll picks
  // up the latest slippage anyway.
  const planRefreshInFlight = useRef(false);

  async function handlePlanRefresh(toolCallId: string) {
    if (planRefreshInFlight.current) return;
    const cached = actionPlanCache.get(toolCallId);
    if (!cached) return;
    if (planSigning || planConfirming || planExecuted) return;
    planRefreshInFlight.current = true;
    try {
      await runExecutePlan(
        { toolCallId, input: { steps: cached.originalInput } },
        coinMap,
        vaultsRef.current,
        accountRef.current,
        addToolResultRef,
        true // silent — don't dispatch addResult; just refresh the cache
      );
    } finally {
      planRefreshInFlight.current = false;
    }
  }

  function handleSlippageChange(pct: number) {
    setSlippagePct(pct);
    if (!latestPlanToolCallId) return;
    const cached = actionPlanCache.get(latestPlanToolCallId);
    if (!cached || cached.summary.swapCount === 0) return;
    void handlePlanRefresh(latestPlanToolCallId);
  }

  async function handleConfirmPlan(toolCallId: string) {
    setSignError(null);
    setPlanTxError(undefined);
    setPlanTxStatus(undefined);
    setPlanGasSui(undefined);
    setPlanReceivedShares(undefined);
    const cached = actionPlanCache.get(toolCallId);
    if (!cached) {
      setSignError("Plan expired. Ask again to re-build.");
      return;
    }
    const acct = accountRef.current;
    if (!acct) {
      setSignError("Connect a wallet first.");
      return;
    }
    setActivePlanId(toolCallId);
    setPlanSigning(true);
    setPlanConfirming(false);
    setPlanExecuted(false);
    setPlanTxDigest(undefined);
    try {
      const signed = await signAndExecute({
        transaction: cached.tx as unknown as Transaction,
      });
      const signedTx =
        signed.$kind === "Transaction"
          ? signed.Transaction
          : signed.FailedTransaction;
      setPlanSigning(false);
      setPlanConfirming(true);
      setPlanTxDigest(signedTx.digest);

      try {
        const finalized = await suiClientRef.current.core.waitForTransaction({
          digest: signedTx.digest,
          include: { effects: true, balanceChanges: true },
        });
        const finTx =
          finalized.$kind === "Transaction"
            ? finalized.Transaction
            : finalized.FailedTransaction;
        if (finTx.status.success) {
          setPlanTxStatus("success");
          const gas = finTx.effects?.gasUsed;
          if (gas) {
            const mist =
              BigInt(gas.computationCost) +
              BigInt(gas.storageCost) -
              BigInt(gas.storageRebate);
            setPlanGasSui(Number(mist) / 1e9);
          }
          // Per-deposit received shares: positive balanceChange for
          // the user where the coinType matches each deposit step's
          // vault.receiptCoinType. Indexed by deposit-step order so the
          // receipt UI can render one row per deposit.
          const depositResolvedSteps = cached.steps.filter(
            (s): s is ResolvedDepositStep => s.kind === "deposit"
          );
          const sharesPerDeposit = depositResolvedSteps.map((d) => {
            const receiptType = d.vault.receiptCoinType
              ? canonicalCoinType(d.vault.receiptCoinType)
              : undefined;
            if (!receiptType) return 0;
            const change = finTx.balanceChanges?.find(
              (b) =>
                b.address === acct.address &&
                canonicalCoinType(b.coinType) === receiptType &&
                BigInt(b.amount) > BigInt(0)
            );
            if (!change) return 0;
            return (
              Number(BigInt(change.amount)) / 10 ** d.vault.depositDecimals
            );
          });
          setPlanReceivedShares(sharesPerDeposit);
        } else {
          setPlanTxStatus("failure");
          const err = finTx.status.success ? null : finTx.status.error;
          setPlanTxError(
            (typeof err === "string"
              ? err
              : err
              ? JSON.stringify(err)
              : null) || "Deposit failed on chain."
          );
        }
      } catch (waitErr) {
        console.warn("[depositConfirm] waitForTransaction failed", waitErr);
        setPlanTxStatus("failure");
        setPlanTxError(
          `Couldn't confirm on chain: ${
            (waitErr as Error).message
          }. The tx may still be processing.`
        );
      } finally {
        setPlanConfirming(false);
        setPlanExecuted(true);
      }
    } catch (e) {
      setSignError((e as Error).message || "Wallet rejected");
      setPlanSigning(false);
      setPlanConfirming(false);
    }
  }

  function handleCancelPlan(toolCallId: string) {
    if (activePlanId === toolCallId) {
      setActivePlanId(null);
      setPlanSigning(false);
      setPlanConfirming(false);
      setPlanExecuted(false);
      setPlanTxDigest(undefined);
      setPlanTxStatus(undefined);
      setPlanTxError(undefined);
      setPlanGasSui(undefined);
      setPlanReceivedShares(undefined);
      setSignError(null);
    }
  }

  // Build a coinType → icon_url lookup for the route hop chips
  const iconLookup = useMemo(() => {
    if (!coinMap) return () => undefined;
    const byType = new Map<string, string | undefined>();
    for (const v of Object.values(coinMap)) {
      byType.set(canonicalCoinType(v.coin_type), v.icon_url);
    }
    return (coinType: string) => byType.get(canonicalCoinType(coinType));
  }, [coinMap]);

  // Draft input
  const [draft, setDraft] = useState("");
  function submit(text: string) {
    if (!text.trim() || !coinMap) return;
    sendMessage({ text });
    setDraft("");
    setSignError(null);
  }

  if (messages.length === 0) {
    return (
      <IdleHero
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={submit}
        ready={!!coinMap}
      />
    );
  }

  const isStreaming = status === "streaming" || status === "submitted";
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  // Compact the last 4 user/assistant turns into plain text for the
  // autocomplete hook. Drop reasoning, tool calls, tool results — just
  // the visible text. Skip empty messages (e.g. an assistant message
  // that only emitted a tool call) so the model gets useful context.
  const recentForAutocomplete = messages
    .slice(-4)
    .map((m) => {
      const text = m.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("\n")
        .trim();
      const role: "user" | "assistant" =
        m.role === "user" ? "user" : "assistant";
      return { role, text };
    })
    .filter((m) => m.text.length > 0);

  const latestPlanToolCallId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      for (let j = msg.parts.length - 1; j >= 0; j--) {
        const part = msg.parts[j] as { type: string; toolCallId?: string };
        if (part.type === "tool-executePlan" && part.toolCallId) {
          return part.toolCallId;
        }
      }
    }
    return null;
  })();

  return (
    <CinematicShell mode="dim">
      <div className="flex h-dvh flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={stick.scrollRef}
            className="min-h-0 flex-1 overflow-y-auto pt-16"
          >
            <div
              ref={stick.contentRef}
              className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-4 pb-3"
            >
              {messages.map((m, i) => {
                const isLastAssistant = i === lastAssistantIdx;
                return (
                  <AgentMessage
                    key={m.id}
                    message={m}
                    isStreaming={isStreaming && isLastAssistant}
                    canRegenerate={isLastAssistant && !isStreaming}
                    onRegenerate={() => regenerate()}
                    planAction={{
                      activePlanId,
                      latestPlanId: latestPlanToolCallId,
                      slippagePct,
                      signing: planSigning,
                      confirming: planConfirming,
                      executed: planExecuted,
                      txDigest: planTxDigest,
                      txStatus: planTxStatus,
                      txError: planTxError,
                      gasUsedSui: planGasSui,
                      receivedShares: planReceivedShares,
                      walletConnected: !!account,
                      iconLookup,
                      onConfirm: handleConfirmPlan,
                      onCancel: handleCancelPlan,
                      onSlippageChange: handleSlippageChange,
                      onRefresh: handlePlanRefresh,
                    }}
                  />
                );
              })}

              {/* Thinking pill — gooey liquid blob */}
              {status === "submitted" && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="surface-card inline-flex items-center self-start px-3 py-2 rounded-button"
                  role="status"
                  aria-label="Sprout is thinking"
                >
                  <LiquidBlob size={22} />
                </motion.div>
              )}

              {signError && (
                <ErrorBanner
                  message={signError}
                  coinMap={coinMap}
                  onAskAgent={(prompt) => {
                    setSignError(null);
                    sendMessage({ text: prompt });
                  }}
                  onDismiss={() => setSignError(null)}
                />
              )}

              {error && (
                <div className="bg-destructive/15 px-4 py-3 text-body-sm text-destructive rounded-[18px]">
                  {error.message}
                </div>
              )}
            </div>
          </div>

          <AnimatePresence>
            {stick.escapedFromLock && !stick.isAtBottom && (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.9 }}
                transition={SPRING_BOUNCY}
                onClick={() => stick.scrollToBottom()}
                aria-label="Scroll to bottom"
                className="absolute bottom-3 left-1/2 z-10 inline-flex size-9 -translate-x-1/2 items-center justify-center surface-card text-muted-ash shadow-header transition-colors hover:text-midnight-ink rounded-full"
              >
                <ChevronDown className="size-4" strokeWidth={2.4} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <div className="shrink-0">
          <div className="mx-auto w-full max-w-3xl px-6 py-4">
            <ChatInput
              value={draft}
              onChange={setDraft}
              onSubmit={() => submit(draft)}
              disabled={isStreaming}
              placeholder={
                isStreaming
                  ? "Sprout is thinking…"
                  : "Tell me a swap or a goal…"
              }
              recentMessages={recentForAutocomplete}
            />
          </div>
        </div>
      </div>
    </CinematicShell>
  );
}

function IdleHero({
  draft,
  onDraftChange,
  onSubmit,
  ready,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onSubmit: (text: string) => void;
  ready: boolean;
}) {
  return (
    <CinematicShell mode="bright">
      {/* Foreground content. Vertically centered stack: headline + input
       *  + example chips, all in one column. */}
      <div className="relative z-20 mx-auto flex w-full max-w-3xl flex-col items-center justify-center px-6 min-h-screen">
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", visualDuration: 0.7, bounce: 0.15 }}
          className="font-alt display-tight max-w-[1100px] text-center font-medium leading-[1.05] tracking-tight text-midnight-ink text-[clamp(40px,5.4vw,72px)]"
        >
          <span className="block">Yield without friction.</span>
          <span className="block">Grow on your terms.</span>
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            visualDuration: 0.7,
            bounce: 0.15,
            delay: 0.3,
          }}
          className="mt-10 w-full max-w-2xl space-y-4"
        >
          <ChatInput
            value={draft}
            onChange={onDraftChange}
            onSubmit={() => onSubmit(draft)}
            autoFocus
            disabled={!ready}
            placeholder={ready ? "Tell me a goal…" : "Loading tokens…"}
          />
          <ExamplePrompts onPick={onSubmit} />
        </motion.div>
      </div>
    </CinematicShell>
  );
}
