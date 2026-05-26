"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingTrail } from "@/components/parts/thinking-trail";
import { ToolCallRow } from "@/components/parts/tool-call-row";
import { LivePlanCard } from "@/components/parts/live-plan-card";
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
import {
  actionPlanCache,
  vaultsListCache,
} from "@/lib/ai/action-plan-cache";
import type { SuiVault } from "@/lib/vaults";
import { cn } from "@/lib/utils";

type IconLookup = (coinType: string) => string | undefined;

export type PlanActionState = {
  activePlanId: string | null;
  latestPlanId: string | null;
  /** Slippage cap shared by every swap step in any plan with swaps. */
  slippagePct: number;
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
  /** Re-build the plan with the current slippage. Used by the slippage pills
   *  and the 5s auto-refresh widget on plans that contain swap steps. */
  onSlippageChange: (pct: number) => void;
  onRefresh: (toolCallId: string) => Promise<void>;
};

type Props = {
  message: UIMessage;
  isStreaming: boolean;
  planAction: PlanActionState;
  /** True only for the last assistant message — controls regenerate visibility. */
  canRegenerate?: boolean;
  onRegenerate?: () => void;
};

export function AgentMessage({
  message,
  isStreaming,
  planAction,
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
          className="max-w-[80%] bg-surface-charcoal px-3.5 py-2 text-body-sm text-canvas-white rounded-card"
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
              className="prose-sprout text-body text-midnight-ink"
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
                      className="font-medium text-midnight-ink underline underline-offset-2 decoration-midnight-ink decoration-2"
                    >
                      {children}
                    </a>
                  ),
                  code: ({ children }) => (
                    <code className="rounded-md bg-whisper-gray px-1.5 py-0.5 font-mono text-[0.85em] text-midnight-ink">
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
                      className="my-3 overflow-hidden bg-whisper-gray ring-1 ring-hairline rounded-card"
                    >
                      <table className="w-full border-collapse text-body-sm">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-whisper-gray text-caption font-medium uppercase tracking-wide text-muted-ash">
                      {children}
                    </thead>
                  ),
                  tbody: ({ children }) => (
                    <tbody className="bg-canvas-white">{children}</tbody>
                  ),
                  tr: ({ children }) => (
                    <tr className="border-b border-hairline last:border-b-0">
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
                  ? planAction.iconLookup(p.output.coinType)
                  : undefined
              }
              priceUsd={p.output?.priceUsd}
              valueUsd={p.output?.valueUsd}
              vaultPosition={p.output?.vaultPosition}
              depositIconUrl={
                p.output?.vaultPosition?.depositCoinType
                  ? planAction.iconLookup(
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
              iconLookup={planAction.iconLookup}
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
              iconLookup={planAction.iconLookup}
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
              iconLookup={planAction.iconLookup}
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
          const isActivePlan =
            planAction.activePlanId === p.toolCallId;
          const isLatestPlan =
            planAction.latestPlanId === p.toolCallId;
          if (!isLatestPlan && !isActivePlan) {
            return (
              <ToolCallRow
                key={key}
                label={`Earlier plan · ${formatPlanSummary(cached.summary)} · superseded`}
                status="output-available"
              />
            );
          }
          return (
            <LivePlanCard
              key={key}
              cached={cached}
              iconLookup={planAction.iconLookup}
              slippagePct={planAction.slippagePct}
              onSlippageChange={planAction.onSlippageChange}
              onRefresh={() => planAction.onRefresh(p.toolCallId)}
              onConfirm={() => planAction.onConfirm(p.toolCallId)}
              onCancel={() => planAction.onCancel(p.toolCallId)}
              signing={isActivePlan && planAction.signing}
              confirming={isActivePlan && planAction.confirming}
              executed={isActivePlan && planAction.executed}
              txDigest={isActivePlan ? planAction.txDigest : undefined}
              txStatus={isActivePlan ? planAction.txStatus : undefined}
              txError={isActivePlan ? planAction.txError : undefined}
              gasUsedSui={isActivePlan ? planAction.gasUsedSui : undefined}
              receivedShares={
                isActivePlan ? planAction.receivedShares : undefined
              }
              walletConnected={planAction.walletConnected}
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
      className="surface-card p-2 rounded-card max-w-[520px]"
    >
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
          {filteredSymbol ? `${filteredSymbol} vaults` : "Top vaults by APY"}
        </span>
        <span className="text-caption text-muted-ash">
          {vaults.length} option{vaults.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="space-y-1">
        {vaults.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => setOpenVaultId(v.id)}
              className={cn("rounded-card", 
                "group relative flex w-full cursor-pointer items-center gap-2.5 overflow-hidden px-3 py-2 text-left",
                "bg-whisper-gray",
                "transition-[background-color,box-shadow,transform] duration-200 ease-out",
                "hover:bg-light-taupe",
                "active:translate-y-px",
                "focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-midnight-ink)]",
              )}
            >
              <AssetIcon
                src={v.logoUrl ?? iconLookup(v.depositCoinType)}
                label={v.depositSymbol}
                size={28}
              />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-body-sm font-medium text-midnight-ink">
                    {v.name}
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center bg-midnight-ink/[0.06] px-1.5 py-0 text-[10px] font-medium uppercase tracking-wider text-muted-ash rounded-[6px]"
                  >
                    {v.depositSymbol}
                  </span>
                </div>
                <span className="truncate text-caption text-muted-ash">
                  {v.category}
                  {v.withdrawalPeriodDays
                    ? ` · ${v.withdrawalPeriodDays}d lockup`
                    : ""}
                </span>
              </div>
              <div className="flex flex-col items-end leading-tight">
                <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
                  {v.apyPct.toFixed(2)}%
                </span>
                <span className="text-caption text-muted-ash tabular-nums">
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

/**
 * One-line summary of a plan's shape for the superseded pill copy.
 * Drops zero-count step kinds and pluralizes naturally so a solo swap
 * reads "1 swap" and a redeem-only plan reads "1 redeem".
 */
function formatPlanSummary(summary: {
  swapCount: number;
  depositCount: number;
  redeemCount: number;
  cancelCount: number;
}): string {
  const parts: string[] = [];
  if (summary.swapCount > 0) {
    parts.push(`${summary.swapCount} swap${summary.swapCount === 1 ? "" : "s"}`);
  }
  if (summary.depositCount > 0) {
    parts.push(
      `${summary.depositCount} deposit${summary.depositCount === 1 ? "" : "s"}`,
    );
  }
  if (summary.redeemCount > 0) {
    parts.push(
      `${summary.redeemCount} redeem${summary.redeemCount === 1 ? "" : "s"}`,
    );
  }
  if (summary.cancelCount > 0) {
    parts.push(
      `${summary.cancelCount} cancel${summary.cancelCount === 1 ? "" : "s"}`,
    );
  }
  return parts.length > 0 ? parts.join(" + ") : "empty plan";
}
