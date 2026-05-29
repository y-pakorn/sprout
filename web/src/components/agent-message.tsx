"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingTrail } from "@/components/parts/thinking-trail";
import { ToolCallRow } from "@/components/parts/tool-call-row";
import {
  ExplainerTrail,
  type ExplainerItem,
} from "@/components/parts/explainer-trail";
import { SuinsCard } from "@/components/parts/suins-card";
import { LivePlanCard } from "@/components/parts/live-plan-card";
import { BalanceCard } from "@/components/parts/balance-card";
import { WalletCard, type WalletBalance } from "@/components/parts/wallet-card";
import { VaultBalanceCard } from "@/components/parts/vault-balance-card";
import { VaultInfoDialog } from "@/components/parts/vault-info-dialog";
import { TxHistoryCard } from "@/components/parts/tx-history-card";
import { AccountTransactionsCard } from "@/components/parts/account-transactions-card";
import { TransactionDetailCard } from "@/components/parts/transaction-detail-card";
import { CoinListCard } from "@/components/parts/coin-list-card";
import { CoinMetadataCard } from "@/components/parts/coin-metadata-card";
import { CoinHoldersCard } from "@/components/parts/coin-holders-card";
import type { VaultBalance } from "@/lib/vault-balance";
import { AssetIcon } from "@/components/asset-icon";
import {
  MessageFooter,
  type MessageMeta,
} from "@/components/parts/message-footer";
import {
  actionPlanCache,
  gaslessSendCache,
  paymentLinkCache,
  vaultsListCache,
  txHistoryCache,
  accountTxCache,
  txDetailCache,
  coinListCache,
  coinMetadataCache,
  coinHoldersCache,
} from "@/lib/ai/action-plan-cache";
import { GaslessSendCard } from "@/components/parts/gasless-send-card";
import { PaymentLinkCard } from "@/components/parts/payment-link-card";
import { DcaActionCard } from "@/components/parts/dca-action-card";
import { DcaOrdersCard } from "@/components/parts/dca-orders-card";
import { dcaActionCache, dcaOrdersCache } from "@/lib/ai/dca-cache";
import type { SuiVault } from "@/lib/vaults";
import { cn } from "@/lib/utils";

type IconLookup = (coinType: string) => string | undefined;

/**
 * Boil a raw executePlan failure (Zod validation dump, plan-builder error,
 * RPC error) down to a single short header. The model retries on its own —
 * the user just needs to see that *this* attempt didn't land.
 */
function summarizePlanError(raw: string | undefined): string {
  if (!raw) return "Plan couldn't be built";
  const text = String(raw);
  if (/Type validation failed|Invalid input for tool/i.test(text)) {
    return "Plan format invalid — agent will retry";
  }
  // Plan-builder errors include a "FIX:" hint aimed at the model. Strip it
  // and keep only the first sentence for the user.
  const beforeFix = text.split(/\s*FIX:/i)[0];
  const firstSentence = (beforeFix.split(/\.\s/)[0] ?? text).trim();
  const clean = firstSentence.replace(/^Plan build failed:\s*/i, "");
  if (clean.length === 0) return "Plan build failed";
  if (clean.length <= 80) return `Plan build failed — ${clean.toLowerCase()}`;
  return "Plan build failed";
}

export type PlanActionState = {
  activePlanId: string | null;
  latestPlanId: string | null;
  /** Slippage cap shared by every swap step in any plan with swaps. */
  slippagePct: number;
  /** "Sprout pays gas" (Enoki sponsorship) toggle — default on. */
  sponsorGas: boolean;
  /** True when the executed plan's gas was actually paid by the sponsor. */
  sponsored: boolean;
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
  /** Toggle sponsorship; triggers a silent rebuild to release/restore the
   *  SUI gas reserve. */
  onSponsorGasChange: (next: boolean) => void;
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

/**
 * Some models (e.g. poolside/laguna) leak their chat-template role/stop
 * delimiters into the visible text — a stray `</assistant>`, `<|im_end|>`,
 * `</s>`, etc. Strip those template tokens so they never render as content.
 */
const MODEL_TOKEN_RE =
  /<\/?\s*(?:assistant|user|system|tool)\s*>|<\|[^|>]*\|>|<\/?s>/gi;
function stripModelTokens(text: string): string {
  return text.replace(MODEL_TOKEN_RE, "").trim();
}

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
        <div className="max-w-[80%] break-words [overflow-wrap:anywhere] bg-surface-charcoal px-3.5 py-2 text-body-sm text-canvas-white rounded-card">
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
          const text = stripModelTokens((part as { text?: string }).text ?? "");
          // Streaming heuristic: the message is the last one and overall stream is active
          return (
            <ThinkingTrail key={key} text={text} streaming={isStreaming} />
          );
        }

        if (part.type === "text") {
          const text = stripModelTokens((part as { text: string }).text);
          if (!text) return null;
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="prose-sprout surface-card min-w-0 max-w-[640px] break-words [overflow-wrap:anywhere] px-3.5 py-2.5 text-body-sm text-midnight-ink rounded-card"
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
                    <div className="my-3 overflow-hidden bg-whisper-gray ring-1 ring-hairline rounded-card">
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
                  strong: ({ children }) => (
                    <strong className="font-semibold font-alt text-midnight-ink">
                      {children}
                    </strong>
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
              vaultPosition?: import("@/components/parts/wallet-card").VaultPosition;
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
                      p.output.vaultPosition.depositCoinType
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
                label={`Submitted ${p.output.digest.slice(
                  0,
                  6
                )}…${p.output.digest.slice(-4)}`}
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
                label={summarizePlanError(p.errorText)}
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
                label={summarizePlanError(p.output.error)}
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
          const isActivePlan = planAction.activePlanId === p.toolCallId;
          const isLatestPlan = planAction.latestPlanId === p.toolCallId;
          if (!isLatestPlan && !isActivePlan) {
            return (
              <ToolCallRow
                key={key}
                label={`Earlier plan · ${formatPlanSummary(
                  cached.summary
                )} · superseded`}
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
              sponsorGas={planAction.sponsorGas}
              onSponsorGasChange={planAction.onSponsorGasChange}
              sponsored={isActivePlan && planAction.sponsored}
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

        if (part.type === "tool-sendStablecoin") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            output?: { error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Gasless send failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label="Preparing gasless transfer…"
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
          const cached = gaslessSendCache.get(p.toolCallId);
          if (!cached) {
            return (
              <ToolCallRow
                key={key}
                label="Transfer expired — ask again to rebuild"
                status="output-error"
              />
            );
          }
          const isActive = planAction.activePlanId === p.toolCallId;
          return (
            <GaslessSendCard
              key={key}
              cached={cached}
              iconLookup={planAction.iconLookup}
              onConfirm={() => planAction.onConfirm(p.toolCallId)}
              onCancel={() => planAction.onCancel(p.toolCallId)}
              signing={isActive && planAction.signing}
              confirming={isActive && planAction.confirming}
              executed={isActive && planAction.executed}
              txDigest={isActive ? planAction.txDigest : undefined}
              txStatus={isActive ? planAction.txStatus : undefined}
              txError={isActive ? planAction.txError : undefined}
              walletConnected={planAction.walletConnected}
            />
          );
        }

        if (part.type === "tool-createPaymentLink") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            output?: { error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Payment link failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label="Creating payment link…"
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
          const cached = paymentLinkCache.get(p.toolCallId);
          if (!cached) {
            return (
              <ToolCallRow
                key={key}
                label="Link expired — ask again to rebuild"
                status="output-error"
              />
            );
          }
          return (
            <PaymentLinkCard
              key={key}
              cached={cached}
              iconLookup={planAction.iconLookup}
            />
          );
        }

        if (
          part.type === "tool-placeDcaOrder" ||
          part.type === "tool-cancelDcaOrder"
        ) {
          const isPlace = part.type === "tool-placeDcaOrder";
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            output?: { error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`${isPlace ? "DCA order" : "DCA cancel"} failed: ${
                  p.errorText ?? "unknown"
                }`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label={isPlace ? "Building DCA order…" : "Preparing cancellation…"}
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
          const cached = dcaActionCache.get(p.toolCallId);
          if (!cached) {
            return (
              <ToolCallRow
                key={key}
                label="DCA action expired — ask again to rebuild"
                status="output-error"
              />
            );
          }
          const isActive = planAction.activePlanId === p.toolCallId;
          return (
            <DcaActionCard
              key={key}
              cached={cached}
              iconLookup={planAction.iconLookup}
              onConfirm={() => planAction.onConfirm(p.toolCallId)}
              onCancel={() => planAction.onCancel(p.toolCallId)}
              signing={isActive && planAction.signing}
              confirming={isActive && planAction.confirming}
              executed={isActive && planAction.executed}
              txDigest={isActive ? planAction.txDigest : undefined}
              txStatus={isActive ? planAction.txStatus : undefined}
              txError={isActive ? planAction.txError : undefined}
              walletConnected={planAction.walletConnected}
              sponsorGas={planAction.sponsorGas}
              onSponsorGasChange={planAction.onSponsorGasChange}
              sponsored={isActive && planAction.sponsored}
            />
          );
        }

        if (part.type === "tool-getDcaOrders") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            output?: { error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`DCA orders read failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label="Reading DCA orders…"
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
          const cached = dcaOrdersCache.get(p.toolCallId);
          if (!cached || (cached.orders.length === 0 && cached.history.length === 0)) {
            return (
              <ToolCallRow
                key={key}
                label="No DCA orders found"
                status="output-available"
              />
            );
          }
          return (
            <DcaOrdersCard
              key={key}
              cached={cached}
              iconLookup={planAction.iconLookup}
            />
          );
        }

        if (part.type === "tool-explainConcept") {
          // Collapse a consecutive run of explainer lookups into one subtle
          // reference pill (the agent quotes each explanation inline, so this
          // is just a "what I referenced" acknowledgement). Only the run
          // leader renders; later members in the run return null.
          const prev = message.parts[i - 1];
          if (prev?.type === "tool-explainConcept") return null;

          const run: ExplainerItem[] = [];
          for (
            let j = i;
            j < message.parts.length &&
            message.parts[j].type === "tool-explainConcept";
            j++
          ) {
            const ep = message.parts[j] as unknown as {
              toolCallId: string;
              state: ExplainerItem["state"];
              input?: { key?: string };
              output?: { key?: string };
            };
            run.push({
              id: ep.toolCallId,
              conceptKey: ep.output?.key ?? ep.input?.key ?? "concept",
              state: ep.state,
            });
          }
          return <ExplainerTrail key={key} items={run} />;
        }

        if (part.type === "tool-resolveSuiName") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            input?: { query?: string };
            output?: { address?: string; name?: string; error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Name lookup failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label={`Resolving ${p.input?.query ?? "name"}…`}
                status={p.state}
              />
            );
          }
          if (p.output?.error || !p.output?.address) {
            return (
              <ToolCallRow
                key={key}
                label={p.output?.error ?? "No result"}
                status="output-error"
              />
            );
          }
          return (
            <SuinsCard
              key={key}
              name={p.output.name}
              address={p.output.address}
            />
          );
        }

        if (part.type === "tool-getAccountActivity") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            input?: { address?: string };
            output?: {
              error?: string;
              address?: string;
              count?: number;
              hasNextPage?: boolean;
            };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Tx history failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label="Reading recent activity…"
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
          // Rich rows (with icon URLs) come from the client cache; the agent's
          // output is a pruned, URL-free summary.
          const cached = txHistoryCache.get(p.toolCallId);
          const items = cached?.items ?? [];
          if (items.length === 0) {
            return (
              <ToolCallRow
                key={key}
                label="No recent activity found"
                status="output-available"
              />
            );
          }
          return (
            <TxHistoryCard
              key={key}
              items={items}
              address={cached?.address ?? p.output?.address ?? ""}
              hasNextPage={cached?.hasNextPage}
            />
          );
        }

        if (part.type === "tool-getAccountTransactions") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            input?: { address?: string };
            output?: {
              error?: string;
              address?: string;
              count?: number;
              hasNextPage?: boolean;
            };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Transactions failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label="Reading transactions…"
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
          const cached = accountTxCache.get(p.toolCallId);
          const items = cached?.items ?? [];
          if (items.length === 0) {
            return (
              <ToolCallRow
                key={key}
                label="No transactions found"
                status="output-available"
              />
            );
          }
          return (
            <AccountTransactionsCard
              key={key}
              items={items}
              address={cached?.address ?? p.output?.address ?? ""}
              hasNextPage={cached?.hasNextPage}
            />
          );
        }

        if (part.type === "tool-getTransactionDetail") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            output?: { error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Transaction lookup failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label="Reading transaction…"
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
          const detail = txDetailCache.get(p.toolCallId);
          if (!detail) {
            return (
              <ToolCallRow
                key={key}
                label="Transaction detail unavailable"
                status="output-available"
              />
            );
          }
          return <TransactionDetailCard key={key} detail={detail} />;
        }

        if (part.type === "tool-searchToken") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            input?: { query?: string };
            output?: { error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Token lookup failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            const q = p.input?.query;
            return (
              <ToolCallRow
                key={key}
                label={q ? `Looking up "${q}"…` : "Looking up token…"}
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
          const cached = coinListCache.get(p.toolCallId);
          const items = cached?.items ?? [];
          if (items.length === 0) {
            return (
              <ToolCallRow
                key={key}
                label={`No token found for "${p.input?.query ?? ""}"`}
                status="output-available"
              />
            );
          }
          return <CoinListCard key={key} items={items} sortBy="SEARCH" />;
        }

        if (part.type === "tool-getCoins") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            output?: { error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Coin list failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow key={key} label="Listing coins…" status={p.state} />
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
          const cached = coinListCache.get(p.toolCallId);
          const items = cached?.items ?? [];
          if (items.length === 0) {
            return (
              <ToolCallRow
                key={key}
                label="No coins found"
                status="output-available"
              />
            );
          }
          return (
            <CoinListCard
              key={key}
              items={items}
              sortBy={cached?.sortBy ?? "MARKET_CAP"}
            />
          );
        }

        if (part.type === "tool-getCoinMetadata") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            output?: { error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Coin lookup failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow key={key} label="Reading coin…" status={p.state} />
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
          const meta = coinMetadataCache.get(p.toolCallId);
          if (!meta) {
            return (
              <ToolCallRow
                key={key}
                label="Coin metadata unavailable"
                status="output-available"
              />
            );
          }
          return <CoinMetadataCard key={key} meta={meta} />;
        }

        if (part.type === "tool-getHoldersByCoinType") {
          const p = part as unknown as {
            toolCallId: string;
            state:
              | "input-streaming"
              | "input-available"
              | "output-available"
              | "output-error";
            output?: { error?: string };
            errorText?: string;
          };
          if (p.state === "output-error") {
            return (
              <ToolCallRow
                key={key}
                label={`Holders lookup failed: ${p.errorText ?? "unknown"}`}
                status="output-error"
              />
            );
          }
          if (p.state !== "output-available") {
            return (
              <ToolCallRow
                key={key}
                label="Reading holders…"
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
          const cached = coinHoldersCache.get(p.toolCallId);
          const items = cached?.items ?? [];
          if (items.length === 0) {
            return (
              <ToolCallRow
                key={key}
                label="No holders found"
                status="output-available"
              />
            );
          }
          return (
            <CoinHoldersCard
              key={key}
              items={items}
              symbol={cached?.symbol ?? "?"}
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
      className="surface-card p-2 rounded-card max-w-[640px]"
    >
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <span className="text-caption font-medium uppercase tracking-wider text-muted-ash">
          {filteredSymbol ? `${filteredSymbol} vaults` : "Top vaults by APY"}
        </span>
        <span className="text-caption text-muted-ash">
          {vaults.length} option{vaults.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {vaults.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => setOpenVaultId(v.id)}
              className={cn(
                "rounded-card",
                "group relative flex w-full cursor-pointer items-center gap-2.5 overflow-hidden px-3 py-2 text-left",
                "bg-whisper-gray",
                "transition-[background-color,box-shadow,transform] duration-200 ease-out",
                "hover:bg-light-taupe",
                "active:translate-y-px",
                "focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-midnight-ink)]"
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
                  <span className="inline-flex shrink-0 items-center bg-midnight-ink/[0.06] px-1.5 py-0 text-[10px] font-medium uppercase tracking-wider text-muted-ash rounded-[6px]">
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
  sendCount: number;
}): string {
  const parts: string[] = [];
  if (summary.swapCount > 0) {
    parts.push(
      `${summary.swapCount} swap${summary.swapCount === 1 ? "" : "s"}`
    );
  }
  if (summary.depositCount > 0) {
    parts.push(
      `${summary.depositCount} deposit${summary.depositCount === 1 ? "" : "s"}`
    );
  }
  if (summary.redeemCount > 0) {
    parts.push(
      `${summary.redeemCount} redeem${summary.redeemCount === 1 ? "" : "s"}`
    );
  }
  if (summary.cancelCount > 0) {
    parts.push(
      `${summary.cancelCount} cancel${summary.cancelCount === 1 ? "" : "s"}`
    );
  }
  if (summary.sendCount > 0) {
    parts.push(
      `${summary.sendCount} send${summary.sendCount === 1 ? "" : "s"}`
    );
  }
  return parts.length > 0 ? parts.join(" + ") : "empty plan";
}
