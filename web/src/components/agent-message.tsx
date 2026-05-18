"use client";

import { motion } from "motion/react";
import type { UIMessage } from "ai";
import { ThinkingTrail } from "@/components/parts/thinking-trail";
import { ToolCallRow } from "@/components/parts/tool-call-row";
import { LiveSwapCard } from "@/components/parts/live-swap-card";
import { quoteCache } from "@/lib/ai/quote-cache";

type IconLookup = (coinType: string) => string | undefined;

type SwapActionState = {
  /** The active getSwapQuote toolCallId to show actions on (may be null) */
  activeQuoteId: string | null;
  slippagePct: number;
  signing: boolean;
  executed: boolean;
  txDigest?: string;
  walletConnected: boolean;
  iconLookup: IconLookup;
  onSlippageChange: (pct: number) => void;
  onConfirm: (toolCallId: string) => void;
  onCancel: (toolCallId: string) => void;
  onRefresh: (toolCallId: string) => Promise<void>;
};

type Props = {
  message: UIMessage;
  isStreaming: boolean;
  swapAction: SwapActionState;
};

export function AgentMessage({ message, isStreaming, swapAction }: Props) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
        className="flex justify-end"
      >
        <div
          className="max-w-[80%] bg-cloud-gray px-5 py-3 text-body text-midnight-black"
          style={{ borderRadius: 24 }}
        >
          {message.parts
            .filter((p) => p.type === "text")
            .map((p, i) => (
              <span key={i}>{(p as { text: string }).text}</span>
            ))}
        </div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-3">
      {message.parts.map((part, i) => {
        const key = `${message.id}-${i}`;

        if (part.type === "reasoning") {
          // AI SDK reasoning part shape: { type: 'reasoning', text: string, state? }
          const text = (part as { text?: string }).text ?? "";
          // Streaming heuristic: the message is the last one and overall stream is active
          return (
            <ThinkingTrail
              key={key}
              text={text}
              streaming={isStreaming}
            />
          );
        }

        if (part.type === "text") {
          const text = (part as { text: string }).text;
          if (!text.trim()) return null;
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="text-body text-midnight-black"
            >
              {text}
            </motion.div>
          );
        }

        if (part.type === "tool-getSwapQuote") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            input?: { fromSymbol?: string; toSymbol?: string; amount?: number };
            output?: {
              error?: string;
              fromSymbol?: string;
              toSymbol?: string;
              expectedOutput?: number;
            };
            errorText?: string;
          };
          if (typeof window !== "undefined") {
            // Helpful diagnostic — strip once stable
            console.log(
              `[render tool-getSwapQuote] state=${p.state} id=${p.toolCallId} hasOutput=${!!p.output}`,
            );
          }

          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Quote failed: ${p.errorText ?? "unknown error"}`}
                status="output-error"
              />
            );
          }

          if (p.state !== "output-available") {
            const lbl =
              p.input?.fromSymbol && p.input?.toSymbol
                ? `Pricing ${p.input.fromSymbol} → ${p.input.toSymbol}…`
                : "Pricing route…";
            return <ToolCallRow key={key} label={lbl} status={p.state} />;
          }

          // output-available — render the live card from cached full quote
          const cached = quoteCache.get(p.toolCallId);
          if (!cached) {
            // Output came back but cache miss (e.g. page reload before sign)
            if (p.output?.error) {
              return (
                <ToolCallRow
                  key={key}
                  label={p.output.error}
                  status="output-error"
                />
              );
            }
            return (
              <ToolCallRow
                key={key}
                label="Quote expired — ask me again to re-price"
                status="output-error"
              />
            );
          }

          const isActive = swapAction.activeQuoteId === p.toolCallId;
          return (
            <LiveSwapCard
              key={key}
              cached={cached}
              slippagePct={swapAction.slippagePct}
              onSlippageChange={swapAction.onSlippageChange}
              onConfirm={() => swapAction.onConfirm(p.toolCallId)}
              onCancel={() => swapAction.onCancel(p.toolCallId)}
              onRefresh={() => swapAction.onRefresh(p.toolCallId)}
              iconLookup={swapAction.iconLookup}
              signing={isActive && swapAction.signing}
              executed={isActive && swapAction.executed}
              txDigest={isActive ? swapAction.txDigest : undefined}
              walletConnected={swapAction.walletConnected}
            />
          );
        }

        if (part.type === "tool-executeSwap") {
          const p = part as unknown as {
            toolCallId: string;
            state: string;
            output?: { digest?: string };
          };
          if (p.state === "output-available" && p.output?.digest) {
            return (
              <ToolCallRow
                key={key}
                label={`Submitted ${p.output.digest.slice(0, 6)}…${p.output.digest.slice(-4)}`}
                status="output-available"
              />
            );
          }
          return null;
        }

        return null;
      })}
    </div>
  );
}
