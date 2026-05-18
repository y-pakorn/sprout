"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { StickToBottom } from "use-stick-to-bottom";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import type { Transaction } from "@mysten/sui/transactions";
import { ChatInput } from "@/components/chat-input";
import { ExamplePrompts } from "@/components/example-prompts";
import { AgentMessage } from "@/components/agent-message";
import { useCoinMap, resolveSymbol } from "@/lib/client-coins";
import { quoteCache } from "@/lib/ai/quote-cache";
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

export function Conversation() {
  const account = useCurrentAccount();
  const coinMap = useCoinMap();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  // Active swap-action state (one swap card may be live at a time)
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null);
  const [slippagePct, setSlippagePct] = useState(1);
  const [signing, setSigning] = useState(false);
  const [executed, setExecuted] = useState(false);
  const [txDigest, setTxDigest] = useState<string | undefined>();
  const [signError, setSignError] = useState<string | null>(null);

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

  const { messages, sendMessage, addToolResult, status, error } = useChat({
    transport,
    sendAutomaticallyWhen: ({ messages: msgs }) => {
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return false;
      const hasOutput = last.parts.some(
        (p) =>
          p.type === "tool-getSwapQuote" &&
          (p as { state?: string }).state === "output-available",
      );
      const hasText = last.parts.some(
        (p) => p.type === "text" && (p as { text?: string }).text?.trim(),
      );
      return hasOutput && !hasText;
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
      if (toolCall.toolName !== "getSwapQuote") return;
      void runSwapQuote(toolCall, coinMap, addToolResultRef);
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

  // Scroll handled by StickToBottom wrapper below

  async function handleConfirm(toolCallId: string) {
    setSignError(null);
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
      const result = await signAndExecute({
        transaction: tx,
      });
      setTxDigest(result.digest);
      setExecuted(true);
    } catch (e) {
      setSignError((e as Error).message || "Wallet rejected");
    } finally {
      setSigning(false);
    }
  }

  function handleCancel(toolCallId: string) {
    if (activeQuoteId === toolCallId) {
      setActiveQuoteId(null);
      setSigning(false);
      setExecuted(false);
      setTxDigest(undefined);
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
      byType.set(v.coin_type, v.icon_url);
    }
    return (coinType: string) => byType.get(coinType);
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
        <StickToBottom.Content className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8 pb-6">
          {messages.map((m, i) => (
            <AgentMessage
              key={m.id}
              message={m}
              isStreaming={isStreaming && i === lastAssistantIdx}
              swapAction={{
                activeQuoteId,
                slippagePct,
                signing,
                executed,
                txDigest,
                walletConnected: !!account,
                iconLookup,
                onSlippageChange: setSlippagePct,
                onConfirm: handleConfirm,
                onCancel: handleCancel,
                onRefresh: handleRefresh,
              }}
            />
          ))}

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
