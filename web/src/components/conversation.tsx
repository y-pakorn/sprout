"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { StickToBottom } from "use-stick-to-bottom";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";

type SuiClientLike = ReturnType<typeof useSuiClient>;
import type { Transaction } from "@mysten/sui/transactions";
import { ChatInput } from "@/components/chat-input";
import { ExamplePrompts } from "@/components/example-prompts";
import { AgentMessage } from "@/components/agent-message";
import { ErrorBanner } from "@/components/parts/error-banner";
import { CinematicShell } from "@/components/parts/cinematic-shell";
import {
  useCoinMap,
  resolveSymbol,
  canonicalCoinType,
} from "@/lib/client-coins";
import {
  useVaults,
  fetchVaults,
  fetchDeployment,
} from "@/lib/client-vaults";
import type { SuiVault } from "@/lib/vaults";
import {
  actionPlanCache,
  vaultsListCache,
  type CachedActionPlan,
  type ResolvedStep,
  type ResolvedSwapStep,
  type ResolvedSplitStep,
  type ResolvedDepositStep,
  type ResolvedRedeemStep,
  type ResolvedCancelRedeemStep,
  type RawStep,
} from "@/lib/ai/action-plan-cache";
import {
  getGlossary,
  type GlossaryKey,
} from "@/lib/ai/vault-glossary";
import {
  getQuote,
  buildTx,
  extractRoute,
  getTokenPrices,
  computePriceImpactPct,
  dexLabel,
  PARTNER_ADDRESS,
  PARTNER_COMMISSION_BPS,
} from "@/lib/bluefin7k";
import {
  Transaction as SuiTransaction,
  coinWithBalance,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import type { VaultPosition } from "@/components/parts/wallet-card";
import {
  loadVaultReceiptIndex,
  type VaultReceiptEntry,
} from "@/lib/vault-receipt-index";
import {
  appendDepositCall,
  appendRedeemCall,
  appendCancelRedeemCall,
} from "@/lib/ember-actions";

// Re-export for legacy local type references. `VaultPosition` import above
// keeps the prop-shape contract with downstream cards stable.
type VaultPositionInfo = VaultReceiptEntry;

export function Conversation() {
  const account = useCurrentAccount();
  const coinMap = useCoinMap();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  // Refs so onToolCall (which captures first-render closure) always reads
  // the latest wallet/client values without re-subscribing.
  const accountRef = useRef(account);
  accountRef.current = account;
  const suiClientRef = useRef(suiClient);
  suiClientRef.current = suiClient;

  // Slippage state — applies to any swap step inside an executePlan plan.
  // Used to rebuild the plan when the user adjusts the cap on the card.
  const [slippagePct, setSlippagePct] = useState(1);
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
    [],
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

  const { messages, sendMessage, addToolResult, regenerate, status, error } = useChat({
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
          addToolResultRef,
        );
        return;
      }
      if (toolCall.toolName === "getBalances") {
        void runGetBalances(
          toolCall,
          coinMap,
          accountRef.current,
          suiClientRef.current,
          addToolResultRef,
        );
        return;
      }
      if (toolCall.toolName === "getVaultBalance") {
        void runGetVaultBalance(
          toolCall,
          accountRef.current,
          suiClientRef.current,
          addToolResultRef,
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
          addToolResultRef,
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
  addToolResultRef.current = addToolResult as unknown as typeof addToolResultRef.current;

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
    ref: React.RefObject<AddResultFn | null>,
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
      const res = await client.getBalance({
        owner: acct.address,
        coinType: coin.coin_type,
      });
      // If the caller is asking about a vault receipt token, attach the
      // vault position metadata so the result renders as a vault card.
      const vaultByReceipt = await loadVaultReceiptIndex();
      const vaultMatch = vaultByReceipt.get(canonicalCoinType(coin.coin_type));
      const decimals = vaultMatch?.shareDecimals ?? coin.decimals;
      const human = Number(res.totalBalance) / 10 ** decimals;
      // USD price: vault receipt tokens come from Bluefin's vault list
      // (the 7K /price endpoint silently drops them — verified). Plain
      // tokens come from the 7K oracle.
      let priceUsd: number | undefined;
      if (vaultMatch?.position.receiptPriceUsd) {
        priceUsd = vaultMatch.position.receiptPriceUsd;
      } else {
        const priceMap = await getTokenPrices([coin.coin_type]).catch(
          () => ({}) as Record<string, number>,
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
    ref: React.RefObject<AddResultFn | null>,
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
      const all = await client.getAllBalances({ owner: acct.address });
      // Reverse-index coinType → {symbol, decimals} from the known coin map
      const byType = new Map<
        string,
        { symbol: string; decimals: number }
      >();
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
          const decimals =
            vault?.shareDecimals ?? known?.decimals ?? 9;
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
            b.rawCoinType ? [b.coinType, b.rawCoinType] : [b.coinType],
          ),
        ),
      );
      const priceMap = await getTokenPrices(priceQueryTypes).catch(
        () => ({}) as Record<string, number>,
      );
      for (const b of balances) {
        // Vault positions: use the canonical share price from the vault
        // list (Bluefin's own oracle).
        if (b.vaultPosition?.receiptPriceUsd) {
          b.priceUsd = b.vaultPosition.receiptPriceUsd;
          b.valueUsd = Number(
            (b.balance * b.vaultPosition.receiptPriceUsd).toFixed(6),
          );
          continue;
        }
        // Plain tokens: 7K oracle.
        const p =
          priceMap[b.coinType] ??
          priceMap[b.rawCoinType ?? ""] ??
          undefined;
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
      for (const b of balances) delete (b as { rawCoinType?: string }).rawCoinType;
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
    ref: React.RefObject<AddResultFn | null>,
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
        client.getAllBalances({ owner: acct.address }),
        loadVaultReceiptIndex(),
      ]);
      if (!serverRes.ok) {
        throw new Error(`vault-balance fetch failed: ${serverRes.status}`);
      }
      const server = (await serverRes.json()) as import(
        "@/lib/vault-balance"
      ).VaultBalanceServerData;
      // Derive positions from wallet balances: every non-zero balance
      // whose coin type is a known vault receipt token is an active
      // position. Vault metadata + share price come from the receipt
      // index (vault list), shares come from chain.
      type RawBal = { coinType: string; totalBalance: string };
      const positions: import(
        "@/lib/vault-balance"
      ).VaultBalancePosition[] = [];
      for (const b of allBalances as RawBal[]) {
        if (BigInt(b.totalBalance) <= BigInt(0)) continue;
        const canon = canonicalCoinType(b.coinType);
        const match = vaultByReceipt.get(canon);
        if (!match) continue;
        const shares = Number(b.totalBalance) / 10 ** match.shareDecimals;
        const receiptPriceUsd = match.position.receiptPriceUsd ?? 0;
        const positionValueUsd = Number(
          (shares * receiptPriceUsd).toFixed(6),
        );
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
    ref: React.RefObject<AddResultFn | null>,
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
    ref: React.RefObject<AddResultFn | null>,
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { key } = toolCall.input as { key: GlossaryKey };
    const text = getGlossary(key);
    await addResult({
      tool: "explainConcept",
      toolCallId: toolCall.toolCallId,
      output: text
        ? { key, text }
        : { error: `Unknown glossary key: ${key}` },
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
    silent = false,
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
      // Vault list + deployment are needed for any step that touches the
      // gateway (deposit, redeem, cancel).
      const needsVaults = steps.some(
        (s) =>
          s.kind === "deposit" ||
          s.kind === "redeemFromVault" ||
          s.kind === "cancelRedeemFromVault",
      );
      const vaults = needsVaults
        ? (vaultList ?? (await fetchVaults()))
        : null;
      const deployment = needsVaults ? await fetchDeployment() : null;
      // Receipt-coin index lets us resolve receipt symbols (e.g. ercUSD)
      // for redeemFromVault — they're not in the standard coin map.
      const vaultByReceipt = needsVaults
        ? await loadVaultReceiptIndex()
        : new Map<string, never>();

      const tx = new SuiTransaction();
      tx.setSender(acct.address);

      type HandleEntry = {
        arg: TransactionObjectArgument;
        symbol: string;
        coinType: string;
        decimals: number;
        expectedHuman: number;
      };
      const handles = new Map<string, HandleEntry>();
      const resolved: ResolvedStep[] = [];

      function resolveOrigin(step: RawStep): HandleEntry {
        if (step.fromHandle) {
          const h = handles.get(step.fromHandle);
          if (!h) {
            const available = Array.from(handles.keys()).join(", ") || "(none)";
            throw new Error(
              `Step ${step.id}: handle '${step.fromHandle}' has not been produced yet by the time this step runs. Available handles at this point: [${available}]. This usually means an upstream step failed or the id reference is mistyped. FIX: verify the upstream step's id matches and retry executePlan.`,
            );
          }
          return h;
        }
        if (!step.fromSymbol || step.fromAmount == null) {
          throw new Error(
            `Step ${step.id}: missing origin — provide either fromHandle or fromSymbol+fromAmount.`,
          );
        }
        const coin = resolveSymbol(map, step.fromSymbol);
        if (coin) {
          const raw = BigInt(
            Math.floor(step.fromAmount * 10 ** coin.decimals),
          );
          const arg = tx.add(
            coinWithBalance({ balance: raw, type: coin.coin_type }),
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
        for (const v of vaultByReceipt.values()) {
          const vTyped = v as {
            position: { depositCoinType: string };
            shareDecimals: number;
          };
          for (const ct of vaultByReceipt.keys()) {
            if (vaultByReceipt.get(ct) !== v) continue;
            // The receipt symbol is the trailing :: segment of the coin type.
            const sym = ct.split("::").pop()?.toUpperCase();
            if (sym === wantSym) {
              const raw = BigInt(
                Math.floor(step.fromAmount * 10 ** vTyped.shareDecimals),
              );
              const arg = tx.add(
                coinWithBalance({ balance: raw, type: ct }),
              ) as unknown as TransactionObjectArgument;
              return {
                arg,
                symbol: wantSym,
                coinType: ct,
                decimals: vTyped.shareDecimals,
                expectedHuman: step.fromAmount,
              };
            }
          }
        }
        throw new Error(
          `Step ${step.id}: unknown token symbol '${step.fromSymbol}'. If you meant a vault receipt token, use the symbol from getVaultBalance.positions[].receiptCoinSymbol.`,
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
            `Step ${s.id}: unknown handle '${handle}'. No upstream step has id '${dep}'. Existing step ids in this plan: [${ids}]. FIX: either rename your upstream step to '${dep}', or change ${s.id}.fromHandle to reference an existing id. Then retry executePlan with the corrected plan.`,
          );
        }
        const hasDot = handle.includes(".");
        if (hasDot && parent.kind !== "split") {
          throw new Error(
            `Step ${s.id}: handle '${handle}' uses split-output syntax \`<id>.<i>\` but upstream step '${parent.id}' is a ${parent.kind}, not a split. ${parent.kind} steps produce a single handle '${parent.id}' (no dot). FIX: either (a) use 'fromHandle: \"${parent.id}\"' to consume the whole ${parent.kind} output, or (b) insert a split step between '${parent.id}' and '${s.id}' (e.g. { kind: \"split\", id: \"split_${parent.id}\", fromHandle: \"${parent.id}\", portionsBps: [...] }) and have '${s.id}' reference 'split_${parent.id}.0'. Then retry executePlan.`,
          );
        }
        if (!hasDot && parent.kind === "split") {
          throw new Error(
            `Step ${s.id}: handle '${handle}' references split step '${parent.id}' but doesn't pick a portion. Split steps produce indexed handles '${parent.id}.0', '${parent.id}.1', etc. FIX: change ${s.id}.fromHandle to one of those (e.g. '${parent.id}.0'). Then retry executePlan.`,
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
        const handles = [
          ...(s.fromHandle ? [s.fromHandle] : []),
          ...(s.fromHandles ?? []),
        ];
        for (const h of handles) {
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
              `Cancel ${step.id}: missing sequenceNumber. Read it from getVaultBalance.withdrawals[].sequenceNumber.`,
            );
          }
          if (!vaults || !deployment) {
            throw new Error("Vaults / deployment data not available.");
          }
          const v = vaults.find((x) => x.id === step.vaultId);
          if (!v) {
            throw new Error(
              `Cancel ${step.id}: unknown vault id '${step.vaultId}'.`,
            );
          }
          const receiptCoinType =
            v.receiptCoinType ||
            deployment.vaultsByObjectId[v.objectId]?.receiptCoinType ||
            "";
          if (!receiptCoinType) {
            throw new Error(
              `Cancel ${step.id}: no receipt coin type for vault '${v.name}'.`,
            );
          }
          let seqBig: bigint;
          try {
            seqBig = BigInt(step.sequenceNumber);
          } catch {
            throw new Error(
              `Cancel ${step.id}: sequenceNumber '${step.sequenceNumber}' is not a valid u128.`,
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
                throw new Error(
                  `Merge ${step.id}: unknown handle '${hId}'.`,
                );
              }
              sources.push({ entry: h, label: hId });
            }
          }
          if (step.fromSymbol && step.fromAmount != null) {
            const coin = resolveSymbol(map, step.fromSymbol);
            if (!coin) {
              throw new Error(
                `Merge ${step.id}: unknown token '${step.fromSymbol}'.`,
              );
            }
            const raw = BigInt(
              Math.floor(step.fromAmount * 10 ** coin.decimals),
            );
            const arg = tx.add(
              coinWithBalance({ balance: raw, type: coin.coin_type }),
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
              `Merge ${step.id}: needs at least 2 source coins (fromHandles + optional fromSymbol/fromAmount).`,
            );
          }
          // All sources must share coin type
          const ct = canonicalCoinType(sources[0].entry.coinType);
          for (const s of sources.slice(1)) {
            if (canonicalCoinType(s.entry.coinType) !== ct) {
              throw new Error(
                `Merge ${step.id}: source coin types don't match — got ${sources[0].entry.symbol} and ${s.entry.symbol}. Can only merge same-token coins.`,
              );
            }
          }
          const [dest, ...rest] = sources;
          tx.mergeCoins(
            dest.entry.arg,
            rest.map((r) => r.entry.arg),
          );
          const totalHuman = sources.reduce(
            (s, x) => s + x.entry.expectedHuman,
            0,
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

        const origin = resolveOrigin(step);

        if (step.kind === "swap") {
          if (!step.toSymbol) {
            throw new Error(`Swap ${step.id}: missing toSymbol.`);
          }
          const outCoin = resolveSymbol(map, step.toSymbol);
          if (!outCoin) {
            throw new Error(
              `Swap ${step.id}: unknown destination token '${step.toSymbol}'.`,
            );
          }
          const slip = step.slippagePct ?? slippagePct;
          const amountInRaw = BigInt(
            Math.floor(origin.expectedHuman * 10 ** origin.decimals),
          );
          const quote = await getQuote({
            tokenIn: origin.coinType,
            tokenOut: outCoin.coin_type,
            amountIn: amountInRaw.toString(),
          });
          const route = extractRoute(quote);
          let impactPct = 0;
          try {
            const prices = await getTokenPrices([
              origin.coinType,
              outCoin.coin_type,
            ]);
            impactPct = computePriceImpactPct(
              quote,
              prices[origin.coinType] ?? 0,
              prices[outCoin.coin_type] ?? 0,
              origin.decimals,
              outCoin.decimals,
            );
          } catch (e) {
            console.warn(`[plan] swap ${step.id} price impact failed`, e);
          }
          let built;
          try {
            built = await buildTx({
              quoteResponse: quote,
              accountAddress: acct.address,
              slippage: slip / 100,
              commission: {
                partner: PARTNER_ADDRESS,
                commissionBps: PARTNER_COMMISSION_BPS,
              },
              extendTx: { tx: tx as never },
            });
          } catch (buildErr) {
            const raw = (buildErr as Error).message ?? String(buildErr);
            // 7K's SDK throws a confusing TypeError when the user's
            // balance is short. Surface a cleaner message.
            if (/insufficient balance/i.test(raw)) {
              const m = raw.match(/Insufficient balance of ([^\s]+) for/i);
              const coin = m?.[1] ?? origin.coinType;
              const symbolGuess = coin.split("::").pop() ?? origin.symbol;
              throw new Error(
                `Swap ${step.id}: your wallet doesn't have enough ${symbolGuess} on-chain (refresh and re-check balances). 7K reported: ${raw}`,
              );
            }
            if (/readUint8 is not a function/i.test(raw)) {
              throw new Error(
                `Swap ${step.id}: 7K SDK couldn't build the transaction (likely insufficient balance or unsupported route for ${origin.symbol} → ${step.toSymbol}). Refresh balances and try again.`,
              );
            }
            throw new Error(
              `Swap ${step.id}: build failed — ${raw}`,
            );
          }
          const toHuman =
            Number(quote.returnAmountWithDecimal) /
            10 ** outCoin.decimals;
          handles.set(step.id, {
            arg: built.coinOut as unknown as TransactionObjectArgument,
            symbol: step.toSymbol.toUpperCase(),
            coinType: outCoin.coin_type,
            decimals: outCoin.decimals,
            expectedHuman: toHuman,
          });
          const fromCoinMeta = resolveSymbol(map, origin.symbol);
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
            hops: route.hopCount,
            dexes: route.dexes.map(dexLabel),
            impactPct,
            quote,
            fromVerified: fromCoinMeta?.verified ?? false,
            toVerified: outCoin.verified,
            fromIcon: fromCoinMeta?.icon_url,
            toIcon: outCoin.icon_url,
          });
        } else if (step.kind === "split") {
          if (!step.portionsBps || step.portionsBps.length < 2) {
            throw new Error(
              `Split ${step.id}: portionsBps must have at least 2 entries.`,
            );
          }
          const bpsSum = step.portionsBps.reduce((s, b) => s + b, 0);
          if (bpsSum !== 10000) {
            throw new Error(
              `Split ${step.id}: portionsBps must sum to 10000; got ${bpsSum}.`,
            );
          }
          const totalRaw = BigInt(
            Math.floor(origin.expectedHuman * 10 ** origin.decimals),
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
              expectedHuman:
                Number(portionsRaw[i]) / 10 ** origin.decimals,
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
              `Deposit ${step.id}: unknown vault id '${step.vaultId}'.`,
            );
          }
          if (
            canonicalCoinType(origin.coinType) !==
            canonicalCoinType(v.depositCoinType)
          ) {
            throw new Error(
              `Deposit ${step.id}: vault '${v.name}' expects ${v.depositSymbol} but the source coin is ${origin.symbol}. Insert a swap step that produces ${v.depositSymbol} first.`,
            );
          }
          const receiptCoinType =
            v.receiptCoinType ||
            deployment.vaultsByObjectId[v.objectId]?.receiptCoinType ||
            "";
          if (!receiptCoinType) {
            throw new Error(
              `Deposit ${step.id}: no receipt coin type for vault '${v.name}'.`,
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
              `Redeem ${step.id}: unknown vault id '${step.vaultId}'.`,
            );
          }
          const receiptCoinType =
            v.receiptCoinType ||
            deployment.vaultsByObjectId[v.objectId]?.receiptCoinType ||
            "";
          if (!receiptCoinType) {
            throw new Error(
              `Redeem ${step.id}: no receipt coin type for vault '${v.name}'.`,
            );
          }
          if (
            canonicalCoinType(origin.coinType) !==
            canonicalCoinType(receiptCoinType)
          ) {
            throw new Error(
              `Redeem ${step.id}: source coin (${origin.symbol}) doesn't match vault '${v.name}' receipt token (${v.receiptCoinSymbol ?? "share"}). Use fromSymbol="${v.receiptCoinSymbol ?? "ercUSD"}" for this redemption.`,
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

      const depositSteps = resolved.filter(
        (s): s is ResolvedDepositStep => s.kind === "deposit",
      );
      const swapSteps = resolved.filter(
        (s): s is ResolvedSwapStep => s.kind === "swap",
      );
      const splitSteps = resolved.filter(
        (s): s is ResolvedSplitStep => s.kind === "split",
      );
      const redeemSteps = resolved.filter(
        (s): s is ResolvedRedeemStep => s.kind === "redeemFromVault",
      );
      const cancelSteps = resolved.filter(
        (s): s is ResolvedCancelRedeemStep =>
          s.kind === "cancelRedeemFromVault",
      );

      const blendedApyPct =
        depositSteps.length > 0
          ? depositSteps.reduce((s, d) => s + d.vault.apyPct, 0) /
            depositSteps.length
          : 0;
      const estimatedGasSui =
        0.012 +
        0.004 * depositSteps.length +
        0.006 * swapSteps.length +
        0.004 * redeemSteps.length +
        0.003 * cancelSteps.length;

      const cached: CachedActionPlan = {
        tx,
        steps: resolved,
        originalInput: steps,
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
        fetchedAt: Date.now(),
      };
      actionPlanCache.set(toolCall.toolCallId, cached);
      if (silent) {
        bumpRefresh((v) => v + 1);
        return;
      }

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
        })),
        blendedApyPct: Number(blendedApyPct.toFixed(3)),
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

  async function handlePlanRefresh(toolCallId: string) {
    const cached = actionPlanCache.get(toolCallId);
    if (!cached) return;
    if (planSigning || planConfirming || planExecuted) return;
    await runExecutePlan(
      { toolCallId, input: { steps: cached.originalInput } },
      coinMap,
      vaultsRef.current,
      accountRef.current,
      addToolResultRef,
      true, // silent — don't dispatch addResult; just refresh the cache
    );
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
      setPlanSigning(false);
      setPlanConfirming(true);
      setPlanTxDigest(signed.digest);

      try {
        const finalized = await suiClientRef.current.waitForTransaction({
          digest: signed.digest,
          options: { showEffects: true, showBalanceChanges: true },
          timeout: 30_000,
        });
        const status = finalized.effects?.status?.status;
        if (status === "success") {
          setPlanTxStatus("success");
          const gas = finalized.effects?.gasUsed;
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
            (s): s is ResolvedDepositStep => s.kind === "deposit",
          );
          const sharesPerDeposit = depositResolvedSteps.map((d) => {
            const receiptType = d.vault.receiptCoinType
              ? canonicalCoinType(d.vault.receiptCoinType)
              : undefined;
            if (!receiptType) return 0;
            const change = finalized.balanceChanges?.find((b) => {
              const owner = b.owner as { AddressOwner?: string };
              return (
                owner?.AddressOwner === acct.address &&
                canonicalCoinType(b.coinType) === receiptType &&
                BigInt(b.amount) > BigInt(0)
              );
            });
            if (!change) return 0;
            return (
              Number(BigInt(change.amount)) / 10 ** d.vault.depositDecimals
            );
          });
          setPlanReceivedShares(sharesPerDeposit);
        } else {
          setPlanTxStatus("failure");
          setPlanTxError(
            finalized.effects?.status?.error ||
              "Deposit failed on chain.",
          );
        }
      } catch (waitErr) {
        console.warn("[depositConfirm] waitForTransaction failed", waitErr);
        setPlanTxStatus("failure");
        setPlanTxError(
          `Couldn't confirm on chain: ${(waitErr as Error).message}. The tx may still be processing.`,
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
      <StickToBottom
        className="flex-1 overflow-y-auto pt-16"
        resize="smooth"
        initial="smooth"
      >
        <StickToBottom.Content className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-4 pb-3">
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

          {/* Thinking pill — staggered glowing dot wave, no text */}
          {status === "submitted" && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="liquid-glass inline-flex items-center gap-1.5 self-start px-4 py-2.5"
              style={{ borderRadius: 9999 }}
              role="status"
              aria-label="Sprout is thinking"
            >
              {[0, 0.15, 0.3].map((delay) => (
                <motion.span
                  key={delay}
                  className="inline-block size-1.5 bg-cash-lime"
                  style={{ borderRadius: 9999 }}
                  animate={{
                    scale: [0.6, 1, 0.6],
                    y: [0, -3, 0],
                    boxShadow: [
                      "0 0 0px rgba(0, 213, 79, 0)",
                      "0 0 12px rgba(0, 213, 79, 0.7)",
                      "0 0 0px rgba(0, 213, 79, 0)",
                    ],
                  }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay,
                  }}
                />
              ))}
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
            <div
              className="bg-destructive/15 px-4 py-3 text-body-sm text-destructive"
              style={{ borderRadius: 18 }}
            >
              {error.message}
            </div>
          )}
        </StickToBottom.Content>
      </StickToBottom>

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
      <div
        className="relative z-20 mx-auto flex w-full max-w-3xl flex-col items-center justify-center px-6"
        style={{ minHeight: "100vh" }}
      >
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", visualDuration: 0.7, bounce: 0.15 }}
          className="display-tight max-w-[1100px] text-center font-medium leading-[1.05] tracking-tight text-canvas-white"
          style={{
            fontSize: "clamp(40px, 5.4vw, 72px)",
            textShadow: "0 2px 24px rgba(0,0,0,0.25)",
          }}
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
          <ExamplePrompts onPick={onSubmit} tone="glass" />
        </motion.div>
      </div>
    </CinematicShell>
  );
}
