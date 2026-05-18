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
import { quoteCache } from "@/lib/ai/quote-cache";
import {
  actionPlanCache,
  vaultsListCache,
  type CachedActionPlan,
  type ResolvedStep,
  type ResolvedSwapStep,
  type ResolvedSplitStep,
  type ResolvedDepositStep,
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

  // Active swap-action state (one swap card may be live at a time).
  // Flow: idle → signing (wallet popup) → confirming (waiting for finality)
  //   → executed:success | executed:failure
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null);
  const [slippagePct, setSlippagePct] = useState(1);
  const [signing, setSigning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [executed, setExecuted] = useState(false);
  const [txDigest, setTxDigest] = useState<string | undefined>();
  const [txStatus, setTxStatus] = useState<"success" | "failure" | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  const [gasUsedSui, setGasUsedSui] = useState<number | undefined>();
  const [receivedAmount, setReceivedAmount] = useState<number | undefined>();
  const [signError, setSignError] = useState<string | null>(null);

  // Active vault-deposit state (mirrors the swap state machine).
  const [activeDepositId, setActiveDepositId] = useState<string | null>(null);
  const [depositSigning, setDepositSigning] = useState(false);
  const [depositConfirming, setDepositConfirming] = useState(false);
  const [depositExecuted, setDepositExecuted] = useState(false);
  const [depositTxDigest, setDepositTxDigest] = useState<string | undefined>();
  const [depositTxStatus, setDepositTxStatus] = useState<
    "success" | "failure" | undefined
  >();
  const [depositTxError, setDepositTxError] = useState<string | undefined>();
  const [depositGasSui, setDepositGasSui] = useState<number | undefined>();
  /** Per-vault shares received (in human units), indexed by allocation order. */
  const [depositReceivedShares, setDepositReceivedShares] = useState<
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
      console.log("[onToolCall] fired", toolCall.toolName, toolCall.toolCallId);
      if (toolCall.toolName === "getSwapQuote") {
        void runSwapQuote(toolCall, coinMap, addToolResultRef);
        return;
      }
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

  async function runSwapQuote(
    toolCall: { toolCallId: string; input: unknown },
    map: typeof coinMap,
    ref: React.RefObject<AddResultFn | null>,
  ) {
    const addResult = ref.current;
    if (!addResult) {
      console.error("[runSwapQuote] addToolResult ref is null");
      return;
    }
    const input = toolCall.input as {
      fromSymbol: string;
      toSymbol: string;
      amount: number;
    };
    const { fromSymbol, toSymbol, amount } = input;
    const tokenIn = resolveSymbol(map, fromSymbol);
    const tokenOut = resolveSymbol(map, toSymbol);
    console.log(
      "[swap] resolve",
      fromSymbol,
      "→",
      tokenIn?.coin_type,
      "|",
      toSymbol,
      "→",
      tokenOut?.coin_type,
    );

    if (!tokenIn || !tokenOut) {
      await addResult({
        tool: "getSwapQuote",
        toolCallId: toolCall.toolCallId,
        output: {
          error: `Unknown token symbol${!tokenIn ? `: ${fromSymbol}` : `: ${toSymbol}`}. Try USDC, SUI, USDT, WAL, DEEP, or BUCK.`,
        },
      });
      console.log("[runSwapQuote] error result dispatched");
      return;
    }

    try {
      const amountIn = BigInt(
        Math.floor(amount * 10 ** tokenIn.decimals),
      ).toString();
      // Fetch the swap quote + oracle prices in parallel. SDK's getTokenPrices
      // returns USD prices per coin_type; we use those as the spot reference.
      const [fullQuote, prices] = await Promise.all([
        getQuote({
          tokenIn: tokenIn.coin_type,
          tokenOut: tokenOut.coin_type,
          amountIn,
        }),
        getTokenPrices([tokenIn.coin_type, tokenOut.coin_type]),
      ]);
      const priceIn = prices[tokenIn.coin_type] ?? 0;
      const priceOut = prices[tokenOut.coin_type] ?? 0;
      const impactPct = computePriceImpactPct(
        fullQuote,
        priceIn,
        priceOut,
        tokenIn.decimals,
        tokenOut.decimals,
      );

      quoteCache.set(toolCall.toolCallId, {
        quote: fullQuote,
        fromSymbol: fromSymbol.toUpperCase(),
        toSymbol: toSymbol.toUpperCase(),
        fromDecimals: tokenIn.decimals,
        toDecimals: tokenOut.decimals,
        fromIcon: tokenIn.icon_url,
        toIcon: tokenOut.icon_url,
        fromCoinType: tokenIn.coin_type,
        toCoinType: tokenOut.coin_type,
        fromVerified: tokenIn.verified,
        toVerified: tokenOut.verified,
        fromAmountHuman: amount,
        spotRate: priceOut > 0 ? priceIn / priceOut : 0,
        impactPct,
        fetchedAt: Date.now(),
      });

      const route = extractRoute(fullQuote);
      const expectedOutput =
        Number(fullQuote.returnAmountWithDecimal) / 10 ** tokenOut.decimals;

      const output = {
        quoteId: toolCall.toolCallId,
        fromAmount: amount,
        fromSymbol: fromSymbol.toUpperCase(),
        toSymbol: toSymbol.toUpperCase(),
        expectedOutput: Number(expectedOutput.toFixed(6)),
        priceImpactPct: Number(impactPct.toFixed(3)),
        hops: route.hopCount,
        dexes: route.dexes.map(dexLabel),
        warning: fullQuote.warning || null,
      };
      console.log("[runSwapQuote] dispatching addToolResult →", output);
      await addResult({
        tool: "getSwapQuote",
        toolCallId: toolCall.toolCallId,
        output,
      });
      console.log("[runSwapQuote] addToolResult done");
    } catch (e) {
      console.error("[runSwapQuote] quote failed", e);
      await addResult({
        tool: "getSwapQuote",
        toolCallId: toolCall.toolCallId,
        output: { error: `Quote failed: ${(e as Error).message}` },
      });
    }
  }

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
      const human = Number(res.totalBalance) / 10 ** coin.decimals;
      await addResult({
        tool: "getBalance",
        toolCallId: toolCall.toolCallId,
        output: {
          symbol: symbol.toUpperCase(),
          balance: Number(human.toFixed(6)),
          decimals: coin.decimals,
          coinType: coin.coin_type,
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
      type RawBal = { coinType: string; totalBalance: string };
      type OutBal = {
        symbol: string;
        balance: number;
        coinType: string;
        known: boolean;
      };
      const balances: OutBal[] = (all as RawBal[])
        .filter((b) => BigInt(b.totalBalance) > BigInt(0))
        .map((b) => {
          const canonType = canonicalCoinType(b.coinType);
          const known = byType.get(canonType);
          const decimals = known?.decimals ?? 9;
          const human = Number(b.totalBalance) / 10 ** decimals;
          return {
            symbol: known?.symbol ?? b.coinType.split("::").pop() ?? "?",
            balance: Number(human.toFixed(6)),
            // Use the canonical type so the icon lookup (also canonicalized
            // via the same coin map) hits.
            coinType: canonType,
            known: !!known,
          };
        })
        .sort((a, b) => {
          if (a.known !== b.known) return a.known ? -1 : 1;
          return b.balance - a.balance;
        });
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

  // ---- Vault tools ----------------------------------------------------

  async function runListVaults(
    toolCall: { toolCallId: string; input: unknown },
    ref: React.RefObject<AddResultFn | null>,
  ) {
    console.log("[runListVaults] start", toolCall.toolCallId, toolCall.input);
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
      console.log("[runListVaults] fetchVaults…");
      const all = await fetchVaults();
      console.log("[runListVaults] got", all.length, "vaults");
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
      console.log("[runListVaults] dispatching addResult, count=", top.length);
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
      console.log("[runListVaults] addResult done");
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
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    if (!acct) {
      await addResult({
        tool: "executePlan",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "Wallet not connected. The user needs to connect a wallet before I can build a transaction plan.",
        },
      });
      return;
    }

    type RawStep = {
      kind: "swap" | "split" | "merge" | "deposit";
      id: string;
      fromHandle?: string;
      fromHandles?: string[];
      fromSymbol?: string;
      fromAmount?: number;
      toSymbol?: string;
      slippagePct?: number;
      portionsBps?: number[];
      vaultId?: string;
    };
    const { steps } = toolCall.input as { steps: RawStep[] };

    try {
      // Pre-resolve vaults + deployment when any deposit step exists
      const hasDeposit = steps.some((s) => s.kind === "deposit");
      const vaults = hasDeposit
        ? (vaultList ?? (await fetchVaults()))
        : null;
      const deployment = hasDeposit ? await fetchDeployment() : null;

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
        if (!coin) {
          throw new Error(
            `Step ${step.id}: unknown token symbol '${step.fromSymbol}'.`,
          );
        }
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
          const splitOuts = tx.splitCoins(origin.arg, splitArgs);
          for (let i = 0; i < splitOuts.length; i++) {
            handles.set(`${step.id}.${i}`, {
              arg: splitOuts[i] as unknown as TransactionObjectArgument,
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
          tx.moveCall({
            target: `${deployment.packageId}::gateway::deposit_asset_v2`,
            typeArguments: [v.depositCoinType, receiptCoinType],
            arguments: [
              tx.object(v.objectId),
              tx.object(deployment.protocolConfigId),
              origin.arg,
              tx.pure.u64(0),
              tx.pure.option("address", null),
              tx.object.clock(),
            ],
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

      const blendedApyPct =
        depositSteps.length > 0
          ? depositSteps.reduce((s, d) => s + d.vault.apyPct, 0) /
            depositSteps.length
          : 0;
      const estimatedGasSui =
        0.012 +
        0.004 * depositSteps.length +
        0.006 * swapSteps.length;

      const cached: CachedActionPlan = {
        tx,
        steps: resolved,
        summary: {
          swapCount: swapSteps.length,
          splitCount: splitSteps.length,
          depositCount: depositSteps.length,
          vaults: depositSteps.map((d) => d.vault),
          blendedApyPct,
          estimatedGasSui,
        },
        fetchedAt: Date.now(),
      };
      actionPlanCache.set(toolCall.toolCallId, cached);

      // Minimal summary back to the model — keeps prompt tokens tight.
      const output = {
        planId: toolCall.toolCallId,
        stepCount: resolved.length,
        swapCount: swapSteps.length,
        splitCount: splitSteps.length,
        depositCount: depositSteps.length,
        deposits: depositSteps.map((d) => ({
          vaultName: d.vault.name,
          apyPct: Number(d.vault.apyPct.toFixed(3)),
          amount: Number(d.amountHuman.toFixed(6)),
          symbol: d.sourceSymbol,
          withdrawalPeriodDays: d.vault.withdrawalPeriodDays,
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
      await addResult({
        tool: "executePlan",
        toolCallId: toolCall.toolCallId,
        output: { error: `Plan build failed: ${(e as Error).message}` },
      });
    }
  }


  // Scroll handled by StickToBottom wrapper below

  async function handleConfirm(toolCallId: string) {
    setSignError(null);
    setTxError(undefined);
    setTxStatus(undefined);
    setGasUsedSui(undefined);
    setReceivedAmount(undefined);
    const cached = quoteCache.get(toolCallId);
    if (!cached) {
      setSignError("Quote expired. Ask again to re-price.");
      return;
    }
    if (!account) {
      setSignError("Connect a wallet first.");
      return;
    }
    setActiveQuoteId(toolCallId);
    setSigning(true);
    setConfirming(false);
    setExecuted(false);
    setTxDigest(undefined);
    try {
      const buildResult = await buildTx({
        quoteResponse: cached.quote,
        accountAddress: account.address,
        slippage: slippagePct / 100, // pct → fractional
        commission: {
          partner: PARTNER_ADDRESS,
          commissionBps: PARTNER_COMMISSION_BPS,
        },
      });
      // Bluefin7K can return either a standard Transaction or a BluefinXTx
      // (sponsor-routed). MVP only supports the standard path; cast and
      // surface a runtime error if a BluefinX route slips through.
      const tx = buildResult.tx as Transaction;
      const signed = await signAndExecute({ transaction: tx });
      // Wallet signed + submitted — but the tx isn't final on chain yet.
      setSigning(false);
      setConfirming(true);
      setTxDigest(signed.digest);

      // Poll the fullnode until the tx is included + executed. waitFor-
      // Transaction returns the effects/events/balanceChanges when ready
      // so we can parse the real outcome (success vs failure, gas used,
      // received amount) rather than just trusting the submit response.
      try {
        const finalized = await suiClient.waitForTransaction({
          digest: signed.digest,
          options: {
            showEffects: true,
            showBalanceChanges: true,
          },
          timeout: 30_000,
        });
        const status = finalized.effects?.status?.status;
        if (status === "success") {
          setTxStatus("success");
          // Gas — convert MIST → SUI. computationCost + storageCost - storageRebate.
          const gas = finalized.effects?.gasUsed;
          if (gas) {
            const mist =
              BigInt(gas.computationCost) +
              BigInt(gas.storageCost) -
              BigInt(gas.storageRebate);
            setGasUsedSui(Number(mist) / 1e9);
          }
          // Received amount — positive balance change of the destination
          // coin type for the signing address.
          const change = finalized.balanceChanges?.find((b) => {
            const owner = b.owner as { AddressOwner?: string };
            return (
              owner?.AddressOwner === account.address &&
              b.coinType === cached.toCoinType &&
              BigInt(b.amount) > BigInt(0)
            );
          });
          if (change) {
            setReceivedAmount(
              Number(BigInt(change.amount)) / 10 ** cached.toDecimals,
            );
          }
        } else {
          setTxStatus("failure");
          setTxError(
            finalized.effects?.status?.error ||
              "Transaction failed on chain.",
          );
        }
      } catch (waitErr) {
        // Wait failed (timeout, network) — tx still went out, mark as
        // unknown so the UI can show the digest but no confirmation.
        console.warn("[waitForTransaction] failed", waitErr);
        setTxStatus("failure");
        setTxError(
          `Couldn't confirm on chain: ${(waitErr as Error).message}. The tx may still be processing.`,
        );
      } finally {
        setConfirming(false);
        setExecuted(true);
      }
    } catch (e) {
      setSignError((e as Error).message || "Wallet rejected");
      setSigning(false);
      setConfirming(false);
    }
  }

  function handleCancel(toolCallId: string) {
    if (activeQuoteId === toolCallId) {
      setActiveQuoteId(null);
      setSigning(false);
      setConfirming(false);
      setExecuted(false);
      setTxDigest(undefined);
      setTxStatus(undefined);
      setTxError(undefined);
      setGasUsedSui(undefined);
      setReceivedAmount(undefined);
      setSignError(null);
    }
  }

  async function handleConfirmDeposit(toolCallId: string) {
    setSignError(null);
    setDepositTxError(undefined);
    setDepositTxStatus(undefined);
    setDepositGasSui(undefined);
    setDepositReceivedShares(undefined);
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
    setActiveDepositId(toolCallId);
    setDepositSigning(true);
    setDepositConfirming(false);
    setDepositExecuted(false);
    setDepositTxDigest(undefined);
    try {
      const signed = await signAndExecute({
        transaction: cached.tx as unknown as Transaction,
      });
      setDepositSigning(false);
      setDepositConfirming(true);
      setDepositTxDigest(signed.digest);

      try {
        const finalized = await suiClientRef.current.waitForTransaction({
          digest: signed.digest,
          options: { showEffects: true, showBalanceChanges: true },
          timeout: 30_000,
        });
        const status = finalized.effects?.status?.status;
        if (status === "success") {
          setDepositTxStatus("success");
          const gas = finalized.effects?.gasUsed;
          if (gas) {
            const mist =
              BigInt(gas.computationCost) +
              BigInt(gas.storageCost) -
              BigInt(gas.storageRebate);
            setDepositGasSui(Number(mist) / 1e9);
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
          setDepositReceivedShares(sharesPerDeposit);
        } else {
          setDepositTxStatus("failure");
          setDepositTxError(
            finalized.effects?.status?.error ||
              "Deposit failed on chain.",
          );
        }
      } catch (waitErr) {
        console.warn("[depositConfirm] waitForTransaction failed", waitErr);
        setDepositTxStatus("failure");
        setDepositTxError(
          `Couldn't confirm on chain: ${(waitErr as Error).message}. The tx may still be processing.`,
        );
      } finally {
        setDepositConfirming(false);
        setDepositExecuted(true);
      }
    } catch (e) {
      setSignError((e as Error).message || "Wallet rejected");
      setDepositSigning(false);
      setDepositConfirming(false);
    }
  }

  function handleCancelDeposit(toolCallId: string) {
    if (activeDepositId === toolCallId) {
      setActiveDepositId(null);
      setDepositSigning(false);
      setDepositConfirming(false);
      setDepositExecuted(false);
      setDepositTxDigest(undefined);
      setDepositTxStatus(undefined);
      setDepositTxError(undefined);
      setDepositGasSui(undefined);
      setDepositReceivedShares(undefined);
      setSignError(null);
    }
  }

  // Bump-on-refresh forces React to re-render so agent-message re-reads
  // the (mutated) quoteCache entry.
  const [, bumpRefresh] = useState(0);

  async function handleRefresh(toolCallId: string) {
    const cached = quoteCache.get(toolCallId);
    if (!cached) return;
    if (signing || executed) return;
    try {
      const amountIn = BigInt(
        Math.floor(cached.fromAmountHuman * 10 ** cached.fromDecimals),
      ).toString();
      const [fresh, prices] = await Promise.all([
        getQuote({
          tokenIn: cached.fromCoinType,
          tokenOut: cached.toCoinType,
          amountIn,
        }),
        getTokenPrices([cached.fromCoinType, cached.toCoinType]),
      ]);
      const priceIn = prices[cached.fromCoinType] ?? 0;
      const priceOut = prices[cached.toCoinType] ?? 0;
      const impactPct = computePriceImpactPct(
        fresh,
        priceIn,
        priceOut,
        cached.fromDecimals,
        cached.toDecimals,
      );
      quoteCache.set(toolCallId, {
        ...cached,
        quote: fresh,
        spotRate: priceOut > 0 ? priceIn / priceOut : 0,
        impactPct,
        fetchedAt: Date.now(),
      });
      bumpRefresh((v) => v + 1);
    } catch (e) {
      console.error("[refresh] failed", e);
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
    // New turn — release prior swap card from "active"
    setActiveQuoteId(null);
    setExecuted(false);
    setSigning(false);
    setTxDigest(undefined);
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

  // Definitive diagnostic of what the messages array currently holds
  if (typeof window !== "undefined" && messages.length > 0) {
    const last = messages[messages.length - 1];
    console.log(
      "[render] status=",
      status,
      "lastRole=",
      last.role,
      "parts=",
      last.parts.map((p) => {
        const anyP = p as { type: string; state?: string };
        return `${anyP.type}${anyP.state ? `:${anyP.state}` : ""}`;
      }),
    );
  }

  // Find the most recent getSwapQuote toolCallId across all messages.
  // Only that one renders a full LiveSwapCard; earlier ones collapse so
  // the conversation doesn't accumulate stale quote panels.
  const latestSwapQuoteToolCallId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      for (let j = msg.parts.length - 1; j >= 0; j--) {
        const part = msg.parts[j] as { type: string; toolCallId?: string };
        if (part.type === "tool-getSwapQuote" && part.toolCallId) {
          return part.toolCallId;
        }
      }
    }
    return null;
  })();

  const latestDepositToolCallId = (() => {
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
    <div
      className="flex w-full flex-col"
      style={{ height: "calc(100vh - 56px)" }}
    >
      <StickToBottom
        className="flex-1 overflow-y-auto"
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
                swapAction={{
                  activeQuoteId,
                  latestQuoteId: latestSwapQuoteToolCallId,
                  slippagePct,
                  signing,
                  confirming,
                  executed,
                  txDigest,
                  txStatus,
                  txError,
                  gasUsedSui,
                  receivedAmount,
                  walletConnected: !!account,
                  iconLookup,
                  onSlippageChange: setSlippagePct,
                  onConfirm: handleConfirm,
                  onCancel: handleCancel,
                  onRefresh: handleRefresh,
                }}
                depositAction={{
                  activeDepositId,
                  latestDepositId: latestDepositToolCallId,
                  signing: depositSigning,
                  confirming: depositConfirming,
                  executed: depositExecuted,
                  txDigest: depositTxDigest,
                  txStatus: depositTxStatus,
                  txError: depositTxError,
                  gasUsedSui: depositGasSui,
                  receivedShares: depositReceivedShares,
                  walletConnected: !!account,
                  iconLookup,
                  onConfirm: handleConfirmDeposit,
                  onCancel: handleCancelDeposit,
                }}
              />
            );
          })}

          {/* Thinking pill — shown after user submits but before first AI token arrives */}
          {status === "submitted" && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 self-start bg-cloud-gray px-4 py-2 text-body-sm text-subtle-gray"
              style={{ borderRadius: 9999 }}
            >
              <motion.span
                animate={{ scale: [1, 1.4, 1] }}
                transition={{
                  duration: 1.1,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="inline-block size-1.5 bg-cash-lime"
                style={{ borderRadius: 9999 }}
              />
              Sprout is thinking…
            </motion.div>
          )}

          {signError && (
            <div
              className="bg-destructive/15 px-4 py-3 text-body-sm text-destructive"
              style={{ borderRadius: 18 }}
            >
              {signError}
            </div>
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

      <div className="shrink-0 border-t border-ghost-border/60 bg-canvas-white">
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
    <section className="bg-canvas-white">
      <div
        className="mx-auto flex w-full max-w-4xl flex-col justify-center gap-8 px-6 py-12"
        style={{ minHeight: "calc(100vh - 56px - 80px)" }}
      >
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", visualDuration: 0.6, bounce: 0.15 }}
          className="display-tight font-semibold leading-[1.0] text-midnight-black"
          style={{ fontSize: "clamp(40px, 6vw, 72px)" }}
        >
          What do you want{" "}
          <span className="whitespace-nowrap">
            <span className="text-shimmer-lime">your money</span> to do?
          </span>
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            visualDuration: 0.6,
            bounce: 0.15,
            delay: 0.2,
          }}
          className="w-full max-w-2xl space-y-4"
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
    </section>
  );
}
