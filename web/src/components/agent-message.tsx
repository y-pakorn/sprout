"use client";

import { motion } from "motion/react";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingTrail } from "@/components/parts/thinking-trail";
import { ToolCallRow } from "@/components/parts/tool-call-row";
import { LiveSwapCard } from "@/components/parts/live-swap-card";
import { BalanceCard } from "@/components/parts/balance-card";
import { WalletCard, type WalletBalance } from "@/components/parts/wallet-card";
import {
  MessageFooter,
  type MessageMeta,
} from "@/components/parts/message-footer";
import { quoteCache } from "@/lib/ai/quote-cache";

type IconLookup = (coinType: string) => string | undefined;

type SwapActionState = {
  /** The active getSwapQuote toolCallId to show actions on (may be null) */
  activeQuoteId: string | null;
  /** The most-recent getSwapQuote toolCallId across the whole conversation.
   *  Older quotes that aren't the active one collapse to a "superseded" pill. */
  latestQuoteId: string | null;
  slippagePct: number;
  signing: boolean;
  confirming: boolean;
  executed: boolean;
  txDigest?: string;
  txStatus?: "success" | "failure";
  txError?: string;
  gasUsedSui?: number;
  receivedAmount?: number;
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
  /** True only for the last assistant message — controls regenerate visibility. */
  canRegenerate?: boolean;
  onRegenerate?: () => void;
};

export function AgentMessage({
  message,
  isStreaming,
  swapAction,
  canRegenerate = false,
  onRegenerate,
}: Props) {
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
          className="max-w-[80%] bg-cloud-gray px-3.5 py-2 text-body-sm text-midnight-black"
          style={{ borderRadius: 16 }}
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
    <div className="space-y-2">
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
              className="prose-sprout text-body text-midnight-black"
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Inline-only: no h1-h6, no images, no raw html. Lists, bold,
                  // italic, code, links stay. Keep paragraphs as plain spans
                  // so consecutive text parts don't gain extra block margin.
                  p: ({ children }) => <p className="m-0">{children}</p>,
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-midnight-black underline underline-offset-2 decoration-cash-lime decoration-2"
                    >
                      {children}
                    </a>
                  ),
                  code: ({ children }) => (
                    <code className="rounded-md bg-cloud-gray px-1.5 py-0.5 font-mono text-[0.85em]">
                      {children}
                    </code>
                  ),
                  ul: ({ children }) => (
                    <ul className="my-2 list-disc pl-5">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="my-2 list-decimal pl-5">{children}</ol>
                  ),
                  li: ({ children }) => <li className="my-0.5">{children}</li>,
                  // Markdown tables — system prompt discourages them, but
                  // style cleanly as a fallback so they don't look broken.
                  table: ({ children }) => (
                    <div
                      className="my-3 overflow-hidden bg-cloud-gray"
                      style={{ borderRadius: 18 }}
                    >
                      <table className="w-full border-collapse text-body-sm">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-cloud-gray text-caption font-medium uppercase tracking-wide text-subtle-gray">
                      {children}
                    </thead>
                  ),
                  tbody: ({ children }) => (
                    <tbody className="bg-canvas-white">{children}</tbody>
                  ),
                  tr: ({ children }) => (
                    <tr className="border-b border-ghost-border/60 last:border-b-0">
                      {children}
                    </tr>
                  ),
                  th: ({ children }) => (
                    <th className="px-3 py-2 text-left font-medium">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3 py-2">{children}</td>
                  ),
                }}
              >
                {text}
              </ReactMarkdown>
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
          const isLatest = swapAction.latestQuoteId === p.toolCallId;
          // If a newer quote has been requested and this one isn't
          // currently mid-sign/executed, collapse to a one-line summary
          // so the conversation doesn't accumulate stale swap panels.
          if (!isLatest && !isActive) {
            return (
              <ToolCallRow
                key={key}
                label={`Earlier quote · ${cached.fromAmountHuman} ${cached.fromSymbol} → ${cached.toSymbol} · superseded`}
                status="output-available"
              />
            );
          }
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
              confirming={isActive && swapAction.confirming}
              executed={isActive && swapAction.executed}
              txDigest={isActive ? swapAction.txDigest : undefined}
              txStatus={isActive ? swapAction.txStatus : undefined}
              txError={isActive ? swapAction.txError : undefined}
              gasUsedSui={isActive ? swapAction.gasUsedSui : undefined}
              receivedAmount={isActive ? swapAction.receivedAmount : undefined}
              walletConnected={swapAction.walletConnected}
            />
          );
        }

        if (part.type === "tool-getBalance") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            input?: { symbol?: string };
            output?: {
              error?: string;
              symbol?: string;
              balance?: number;
              coinType?: string;
            };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Balance read failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            const sym = p.input?.symbol?.toUpperCase();
            return (
              <ToolCallRow
                key={key}
                label={sym ? `Reading ${sym} balance…` : "Reading balance…"}
                status={p.state}
              />
            );
          }
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
            <BalanceCard
              key={key}
              symbol={p.output?.symbol ?? p.input?.symbol?.toUpperCase() ?? "?"}
              balance={p.output?.balance ?? 0}
              iconUrl={
                p.output?.coinType
                  ? swapAction.iconLookup(p.output.coinType)
                  : undefined
              }
            />
          );
        }

        if (part.type === "tool-getBalances") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            output?: {
              error?: string;
              balances?: WalletBalance[];
            };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Wallet read failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label="Reading wallet balances…"
                status={p.state}
              />
            );
          }
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
            <WalletCard
              key={key}
              balances={p.output?.balances ?? []}
              iconLookup={swapAction.iconLookup}
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

      {!isStreaming && (
        <MessageFooter
          meta={(message as { metadata?: MessageMeta }).metadata}
          canRegenerate={canRegenerate}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  );
}
