"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingTrail } from "@/components/parts/thinking-trail";
import { ToolCallRow } from "@/components/parts/tool-call-row";
import { LiveSwapCard } from "@/components/parts/live-swap-card";
import { LiveVaultCard } from "@/components/parts/live-vault-card";
import { BalanceCard } from "@/components/parts/balance-card";
import { WalletCard, type WalletBalance } from "@/components/parts/wallet-card";
import { VaultBalanceCard } from "@/components/parts/vault-balance-card";
import { VaultInfoDialog } from "@/components/parts/vault-info-dialog";
import type { VaultBalance } from "@/lib/vault-balance";
import { AssetIcon } from "@/components/asset-icon";
import {
  MessageFooter,
  type MessageMeta,
} from "@/components/parts/message-footer";
import { quoteCache } from "@/lib/ai/quote-cache";
import {
  actionPlanCache,
  vaultsListCache,
} from "@/lib/ai/action-plan-cache";
import type { SuiVault } from "@/lib/vaults";

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

export type DepositActionState = {
  activeDepositId: string | null;
  latestDepositId: string | null;
  signing: boolean;
  confirming: boolean;
  executed: boolean;
  txDigest?: string;
  txStatus?: "success" | "failure";
  txError?: string;
  gasUsedSui?: number;
  /** Per-allocation shares received (human units), indexed by order */
  receivedShares?: number[];
  walletConnected: boolean;
  iconLookup: IconLookup;
  onConfirm: (toolCallId: string) => void;
  onCancel: (toolCallId: string) => void;
};

type Props = {
  message: UIMessage;
  isStreaming: boolean;
  swapAction: SwapActionState;
  depositAction: DepositActionState;
  /** True only for the last assistant message — controls regenerate visibility. */
  canRegenerate?: boolean;
  onRegenerate?: () => void;
};

export function AgentMessage({
  message,
  isStreaming,
  swapAction,
  depositAction,
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
              priceUsd?: number;
              valueUsd?: number;
              vaultPosition?: import(
                "@/components/parts/wallet-card"
              ).VaultPosition;
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
              priceUsd={p.output?.priceUsd}
              valueUsd={p.output?.valueUsd}
              vaultPosition={p.output?.vaultPosition}
              depositIconUrl={
                p.output?.vaultPosition?.depositCoinType
                  ? swapAction.iconLookup(
                      p.output.vaultPosition.depositCoinType,
                    )
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

        if (part.type === "tool-getVaultBalance") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            output?: { error?: string; data?: VaultBalance };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Vault balance read failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label="Loading vault balance…"
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
          if (!p.output?.data) return null;
          return (
            <VaultBalanceCard
              key={key}
              data={p.output.data}
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

        if (part.type === "tool-listVaults") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            input?: { depositSymbol?: string };
            output?: {
              error?: string;
              count?: number;
              vaults?: Array<{
                id: string;
                name: string;
                apyPct: number;
                depositSymbol: string;
                withdrawalPeriodDays?: number;
              }>;
            };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Vault list failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            const sym = p.input?.depositSymbol?.toUpperCase();
            return (
              <ToolCallRow
                key={key}
                label={sym ? `Finding ${sym} vaults…` : "Listing vaults…"}
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
          const list = vaultsListCache.get(p.toolCallId);
          const vaults = list?.vaults ?? [];
          if (vaults.length === 0) {
            return (
              <ToolCallRow
                key={key}
                label={
                  list?.filteredSymbol
                    ? `No ${list.filteredSymbol} vaults available`
                    : "No vaults available"
                }
                status="output-available"
              />
            );
          }
          return (
            <VaultListCard
              key={key}
              vaults={vaults}
              filteredSymbol={list?.filteredSymbol}
              iconLookup={swapAction.iconLookup}
            />
          );
        }

        if (part.type === "tool-executePlan") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            input?: { steps?: Array<{ kind?: string }> };
            output?: { error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Plan build failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            const n = p.input?.steps?.length;
            return (
              <ToolCallRow
                key={key}
                label={
                  n
                    ? `Building plan · ${n} step${n === 1 ? "" : "s"}…`
                    : "Building plan…"
                }
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
          const cached = actionPlanCache.get(p.toolCallId);
          if (!cached) {
            return (
              <ToolCallRow
                key={key}
                label="Plan expired — ask again to rebuild"
                status="output-error"
              />
            );
          }
          const isActiveDep =
            depositAction.activeDepositId === p.toolCallId;
          const isLatestDep =
            depositAction.latestDepositId === p.toolCallId;
          if (!isLatestDep && !isActiveDep) {
            const depCount = cached.summary.depositCount;
            const swCount = cached.summary.swapCount;
            return (
              <ToolCallRow
                key={key}
                label={`Earlier plan · ${swCount} swap${swCount === 1 ? "" : "s"} + ${depCount} deposit${depCount === 1 ? "" : "s"} · superseded`}
                status="output-available"
              />
            );
          }
          return (
            <LiveVaultCard
              key={key}
              cached={cached}
              iconLookup={depositAction.iconLookup}
              onConfirm={() => depositAction.onConfirm(p.toolCallId)}
              onCancel={() => depositAction.onCancel(p.toolCallId)}
              signing={isActiveDep && depositAction.signing}
              confirming={isActiveDep && depositAction.confirming}
              executed={isActiveDep && depositAction.executed}
              txDigest={isActiveDep ? depositAction.txDigest : undefined}
              txStatus={isActiveDep ? depositAction.txStatus : undefined}
              txError={isActiveDep ? depositAction.txError : undefined}
              gasUsedSui={isActiveDep ? depositAction.gasUsedSui : undefined}
              receivedShares={
                isActiveDep ? depositAction.receivedShares : undefined
              }
              walletConnected={depositAction.walletConnected}
            />
          );
        }

        if (part.type === "tool-explainConcept") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            input?: { key?: string };
            output?: { key?: string; text?: string; error?: string };
          };
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label={`Looking up ${p.input?.key ?? "concept"}…`}
                status={p.state}
              />
            );
          }
          // The agent quotes the glossary text inline in its own message, so
          // we just render a tiny acknowledgement chip to keep the trail
          // clean instead of duplicating the explanation.
          return (
            <ToolCallRow
              key={key}
              label={`Explainer: ${p.output?.key ?? "concept"}`}
              status="output-available"
            />
          );
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

/**
 * Compact list of Ember vaults rendered after listVaults resolves. Each row
 * links to the vault info dialog (deep details + charts).
 */
function VaultListCard({
  vaults,
  filteredSymbol,
  iconLookup,
}: {
  vaults: SuiVault[];
  filteredSymbol?: string;
  iconLookup: IconLookup;
}) {
  const [openVaultId, setOpenVaultId] = useState<string | null>(null);
  const openVault = openVaultId
    ? vaults.find((v) => v.id === openVaultId) ?? null
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className="bg-cloud-gray p-2"
      style={{ borderRadius: 18, maxWidth: 520 }}
    >
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <span className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
          {filteredSymbol ? `${filteredSymbol} vaults` : "Top vaults by APY"}
        </span>
        <span className="text-caption text-subtle-gray">
          {vaults.length} option{vaults.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="space-y-1">
        {vaults.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => setOpenVaultId(v.id)}
              className="flex w-full items-center gap-2.5 bg-canvas-white px-3 py-2 text-left transition-colors hover:bg-cash-lime/10"
              style={{ borderRadius: 14 }}
            >
              <AssetIcon
                src={v.logoUrl ?? iconLookup(v.depositCoinType)}
                label={v.depositSymbol}
                size={28}
              />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-body-sm font-semibold text-midnight-black">
                    {v.name}
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center bg-cloud-gray px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-midnight-black"
                    style={{ borderRadius: 9999 }}
                  >
                    {v.depositSymbol}
                  </span>
                </div>
                <span className="truncate text-caption text-subtle-gray">
                  {v.category}
                  {v.withdrawalPeriodDays
                    ? ` · ${v.withdrawalPeriodDays}d lockup`
                    : ""}
                </span>
              </div>
              <div className="flex flex-col items-end leading-tight">
                <span className="text-body-sm font-semibold tabular-nums text-midnight-black">
                  {v.apyPct.toFixed(2)}%
                </span>
                <span className="text-caption text-subtle-gray tabular-nums">
                  {v.tvlUsd >= 1_000_000
                    ? `$${(v.tvlUsd / 1_000_000).toFixed(1)}M`
                    : v.tvlUsd >= 1_000
                      ? `$${(v.tvlUsd / 1_000).toFixed(1)}K`
                      : `$${v.tvlUsd.toFixed(0)}`}{" "}
                  TVL
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <VaultInfoDialog
        vault={openVault}
        open={!!openVaultId}
        onOpenChange={(o) => !o && setOpenVaultId(null)}
        iconLookup={iconLookup}
      />
    </motion.div>
  );
}
