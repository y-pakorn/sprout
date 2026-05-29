"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useStickToBottom } from "use-stick-to-bottom";
import {
  useCurrentAccount,
  useCurrentClient,
  useCurrentNetwork,
  useDAppKit,
} from "@mysten/dapp-kit-react";

type SuiClientLike = ReturnType<typeof useCurrentClient>;
import type { Transaction } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { buildGaslessSend, isGaslessStablecoin } from "@/lib/gasless";
import { lookupSuins } from "@/lib/suins";
import {
  encodePaymentLink,
  paymentLinkUrl,
  type PaymentLinkData,
} from "@/lib/payment-link";
import { fetchAllBalances, fetchBalance } from "@/lib/grpc-balances";
import { ChatInput } from "@/components/chat-input";
import { ExamplePrompts } from "@/components/example-prompts";
import { AgentMessage } from "@/components/agent-message";
import { ErrorBanner } from "@/components/parts/error-banner";
import { CinematicShell } from "@/components/parts/cinematic-shell";
import { LiquidBlob } from "@/components/parts/liquid-blob";
import { HeroStatStrip } from "@/components/parts/hero-stat-strip";
import { LiveMainnetBadge } from "@/components/parts/live-mainnet-badge";
import { SPRING_BOUNCY } from "@/lib/motion";
import { subscribeAskSprout, takePendingAsk } from "@/lib/ask-sprout";
import {
  useCoinMap,
  resolveSymbol,
  canonicalCoinType,
} from "@/lib/client-coins";
import { useVaults, fetchVaults } from "@/lib/client-vaults";
import { signedFetch } from "@/lib/api-client";
import { useRegisterChatReset } from "@/components/chat-reset";
import type { SuiVault } from "@/lib/vaults";
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
  type CachedActionPlan,
  type PlanRisk,
  type ResolvedSwapStep,
  type ResolvedSplitStep,
  type ResolvedDepositStep,
  type ResolvedRedeemStep,
  type ResolvedCancelRedeemStep,
  type ResolvedSendStep,
} from "@/lib/ai/action-plan-cache";
import { adaptPlanSteps, type ExecutePlanStep } from "@/lib/ai/plan-steps";
import { pruneForModel } from "@/lib/ai/prune-output";
import type { TxActivity, TxCoin } from "@/lib/tx-history";
import type { AccountTx, AccountTxView } from "@/lib/account-transactions";
import type {
  TransactionDetail,
  TransactionDetailView,
} from "@/lib/transaction-detail";
import {
  isCoinType,
  type CoinListItem,
  type CoinMetadata,
  type CoinHolder,
} from "@/lib/blockberry-coins";
import { getGlossary, type GlossaryKey } from "@/lib/ai/vault-glossary";
import { defaultModelId } from "@/lib/ai/pricing";
import { getTokenPrices } from "@/lib/bluefin7k";
import { providerLabel } from "@/lib/seven-k";
import { buildPlanTransaction } from "@/lib/ai/build-plan-transaction";
import {
  executeSponsored,
  SponsorshipUnavailableError,
} from "@/lib/enoki-sponsor";
import type { SuiNetwork } from "@/lib/sui";
import { floorToDecimals } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VaultPosition } from "@/components/parts/wallet-card";
import {
  loadVaultReceiptIndex,
  type VaultReceiptEntry,
} from "@/lib/vault-receipt-index";

// Re-export for legacy local type references. `VaultPosition` import above
// keeps the prop-shape contract with downstream cards stable.
type VaultPositionInfo = VaultReceiptEntry;

export function Conversation({
  embedded = false,
  surface,
}: { embedded?: boolean; surface?: "rail" | "sheet" } = {}) {
  const account = useCurrentAccount();
  const coinMap = useCoinMap();
  const suiClient = useCurrentClient();
  const currentNetwork = useCurrentNetwork() as SuiNetwork;
  const dAppKit = useDAppKit();
  const signAndExecute = (args: { transaction: Transaction }) =>
    dAppKit.signAndExecuteTransaction(args);
  const signTransaction = (args: { transaction: string }) =>
    dAppKit.signTransaction(args);

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
  // "Sprout pays gas" (Enoki sponsorship). Default ON — the builder releases
  // the SUI gas reserve and the wallet signs only. The ref mirror lets silent
  // rebuilds (toggle / refresh) read the live value from a stale closure.
  const [sponsorGas, setSponsorGas] = useState(true);
  const sponsorGasRef = useRef(sponsorGas);
  sponsorGasRef.current = sponsorGas;
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
  /** True when the executed plan's gas was actually paid by the Enoki sponsor
   *  (vs. the wallet — e.g. when sponsorship fell back). Drives the receipt. */
  const [planSponsored, setPlanSponsored] = useState(false);
  /** Set when "Sprout pays gas" was on but Enoki refused — we fell back to
   *  wallet-paid gas. Surfaced as a non-blocking notice (not a silent failure). */
  const [sponsorFallbackReason, setSponsorFallbackReason] = useState<
    string | undefined
  >();
  /** Per-vault shares received (in human units), indexed by allocation order. */
  const [planReceivedShares, setPlanReceivedShares] = useState<
    number[] | undefined
  >();

  // Vaults list (cached client-side, fetched once on mount)
  const vaults = useVaults();
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;

  // User-selected chat model (picked in the input). A ref mirrors it so the
  // stable transport closure injects the LATEST choice into each request.
  const [selectedModel, setSelectedModel] = useState(defaultModelId());
  const modelRef = useRef(selectedModel);
  modelRef.current = selectedModel;

  // The connected wallet address travels in the request body (not the system
  // prompt) so the server can inject it per-turn without breaking prompt
  // caching. Kept in a ref because the transport is memoized once.
  const walletRef = useRef(account?.address);
  walletRef.current = account?.address;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: signedFetch,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...body,
            messages,
            model: modelRef.current,
            walletAddress: walletRef.current ?? null,
          },
        }),
      }),
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

  const {
    messages,
    sendMessage,
    setMessages,
    addToolResult,
    regenerate,
    status,
    error,
    stop,
  } = useChat({
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
      // Find every tool part and the index of the last one. When the model
      // emits PARALLEL tool calls in a single step, we must wait for ALL of
      // them to resolve before re-submitting — otherwise we'd send the model
      // an incomplete tool-result set (an orphaned tool_use) and the request
      // errors. Only checking the positionally-last part would re-fire as
      // soon as the last one resolves, even if an earlier call is still
      // pending (parallel handlers finish out of order).
      let lastToolIdx = -1;
      let hasUnresolvedTool = false;
      for (let i = 0; i < last.parts.length; i++) {
        if (!last.parts[i].type.startsWith("tool-")) continue;
        lastToolIdx = i;
        const state = (last.parts[i] as { state?: string }).state;
        if (state !== "output-available" && state !== "output-error") {
          hasUnresolvedTool = true;
        }
      }
      if (lastToolIdx === -1) return false;
      if (hasUnresolvedTool) return false;
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
      if (toolCall.toolName === "sendStablecoin") {
        void runSendStablecoin(
          toolCall,
          coinMap,
          accountRef.current,
          suiClientRef.current,
          addToolResultRef
        );
        return;
      }
      if (toolCall.toolName === "createPaymentLink") {
        void runCreatePaymentLink(
          toolCall,
          coinMap,
          accountRef.current,
          suiClientRef.current,
          addToolResultRef
        );
        return;
      }
      if (toolCall.toolName === "explainConcept") {
        void runExplainConcept(toolCall, addToolResultRef);
        return;
      }
      if (toolCall.toolName === "resolveSuiName") {
        void runResolveSuiName(
          toolCall,
          suiClientRef.current,
          addToolResultRef
        );
        return;
      }
      if (toolCall.toolName === "getAccountActivity") {
        void runGetTxHistory(toolCall, accountRef.current, addToolResultRef);
        return;
      }
      if (toolCall.toolName === "getAccountTransactions") {
        void runGetAccountTransactions(
          toolCall,
          coinMap,
          accountRef.current,
          addToolResultRef
        );
        return;
      }
      if (toolCall.toolName === "getTransactionDetail") {
        void runGetTransactionDetail(toolCall, coinMap, addToolResultRef);
        return;
      }
      if (toolCall.toolName === "searchToken") {
        void runSearchToken(toolCall, coinMap, addToolResultRef);
        return;
      }
      if (toolCall.toolName === "getCoins") {
        void runGetCoins(toolCall, addToolResultRef);
        return;
      }
      if (toolCall.toolName === "getCoinMetadata") {
        void runGetCoinMetadata(toolCall, addToolResultRef);
        return;
      }
      if (toolCall.toolName === "getHoldersByCoinType") {
        void runGetCoinHolders(toolCall, addToolResultRef);
        return;
      }
    },
  });

  // Keep the ref pointed at the latest addToolResult
  addToolResultRef.current =
    addToolResult as unknown as typeof addToolResultRef.current;

  // Abort the in-flight generation when this chat unmounts (e.g. the user
  // navigates to another page). Tab close is handled server-side via
  // req.signal; this covers in-app SPA navigation, where the fetch would
  // otherwise keep the stream — and the model — running unread.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => void stopRef.current(), []);

  // "Ask Sprout" handoff from the feed. Both chat panes (desktop rail + the
  // always-mounted mobile sheet) subscribe, so we gate on the breakpoint and
  // atomically claim the question — exactly one pane (the visible one) sends.
  const sendRef = useRef(sendMessage);
  sendRef.current = sendMessage;
  useEffect(() => {
    if (!surface) return;
    return subscribeAskSprout(() => {
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;
      const mine = isDesktop ? surface === "rail" : surface === "sheet";
      if (!mine) return;
      const text = takePendingAsk();
      if (text) sendRef.current({ text });
    });
  }, [surface]);

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
    const { symbol, address } = toolCall.input as {
      symbol: string;
      address?: string;
    };
    const target = (address?.trim() || acct?.address || "").trim();
    if (!target) {
      await addResult({
        tool: "getBalance",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "No wallet connected and no address given. Ask the user to connect a wallet (button top-right) or name an address.",
        },
      });
      return;
    }
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
        target,
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
        // Prune image/URL fields + nulls — the card resolves icons via
        // iconLookup(coinType), so the agent never needs them.
        output: pruneForModel({
          symbol: symbol.toUpperCase(),
          balance: floorToDecimals(human),
          decimals,
          coinType: coin.coin_type,
          priceUsd,
          valueUsd,
          vaultPosition: vaultMatch?.position,
        }),
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
    const { address } = (toolCall.input ?? {}) as { address?: string };
    const target = (address?.trim() || acct?.address || "").trim();
    if (!target) {
      await addResult({
        tool: "getBalances",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "No wallet connected and no address given. Ask the user to connect a wallet (button top-right) or name an address.",
        },
      });
      return;
    }
    try {
      const all = await fetchAllBalances(client, target);
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
            balance: floorToDecimals(human),
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
        // Prune image/URL fields + nulls (icons come from iconLookup).
        output: pruneForModel({ balances }),
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
    const { address } = (toolCall.input ?? {}) as { address?: string };
    const target = (address?.trim() || acct?.address || "").trim();
    if (!target) {
      await addResult({
        tool: "getVaultBalance",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "No wallet connected and no address given. Ask the user to connect a wallet (button top-right) or name an address.",
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
        signedFetch(`/api/vault-balance/${target}`, { cache: "no-store" }),
        fetchAllBalances(client, target),
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
        // Prune image/URL fields + nulls; the card resolves logos via
        // iconLookup(depositCoinType) fallback.
        output: pruneForModel({ data }),
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
            // Risk signals for the agent's Guardian assessment.
            riskProfile: v.riskProfile?.slug,
            flags: v.flagSlugs.length ? v.flagSlugs : undefined,
            perfFeeBps: v.performanceFeeBps,
            mgmtFeeBps: v.managementFeeBps,
            rewardApyPct: Number(v.apyBreakdown.rewardApyPct.toFixed(2)),
            capacityPct:
              v.maxDepositsRaw && Number(v.maxDepositsRaw) > 0
                ? Math.round(
                    (Number(v.totalDepositsRaw) / Number(v.maxDepositsRaw)) *
                      100
                  )
                : undefined,
            depositors: v.activeDepositors,
            strategy: v.strategy,
            description: v.description?.slice(0, 220),
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

  async function runResolveSuiName(
    toolCall: { toolCallId: string; input: unknown },
    client: SuiClientLike,
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { query } = (toolCall.input ?? {}) as { query?: string };
    const q = (query ?? "").trim();
    if (!q) {
      await addResult({
        tool: "resolveSuiName",
        toolCallId: toolCall.toolCallId,
        output: { error: "Pass a SuiNS name (yoisha.sui) or a 0x address." },
      });
      return;
    }
    try {
      const res = await lookupSuins(q, client as unknown as SuiGrpcClient);
      await addResult({
        tool: "resolveSuiName",
        toolCallId: toolCall.toolCallId,
        output: res,
      });
    } catch (e) {
      await addResult({
        tool: "resolveSuiName",
        toolCallId: toolCall.toolCallId,
        output: { error: `Name lookup failed: ${(e as Error).message}` },
      });
    }
  }

  async function runGetTxHistory(
    toolCall: { toolCallId: string; input: unknown },
    acct: ReturnType<typeof useCurrentAccount>,
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { address, actionType, limit, cursor } = (toolCall.input ?? {}) as {
      address?: string;
      actionType?: "ALL" | "SEND" | "RECEIVE";
      limit?: number;
      cursor?: string;
    };
    const addr = (address?.trim() || acct?.address || "").trim();
    if (!addr) {
      await addResult({
        tool: "getAccountActivity",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "No wallet connected and no address given. Ask the user to connect a wallet (button top-right) or name an address.",
        },
      });
      return;
    }
    try {
      const params = new URLSearchParams({
        address: addr,
        actionType: actionType ?? "ALL",
        size: String(limit ?? 10),
      });
      if (cursor) params.set("nextCursor", cursor);
      const res = await signedFetch(`/api/tx-history?${params.toString()}`);
      const body = (await res.json()) as {
        error?: string;
        count?: number;
        hasNextPage?: boolean;
        nextCursor?: string;
        items?: TxActivity[];
      };
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `tx history failed: ${res.status}`);
      }
      const richItems = body.items ?? [];
      // Rich items (with icon URLs) stay client-side for the card; the agent
      // gets a compact, URL-free summary so its context isn't bloated.
      txHistoryCache.set(toolCall.toolCallId, {
        items: richItems,
        address: addr,
        hasNextPage: !!body.hasNextPage,
      });
      const modelItems = richItems.map((it) => {
        const o: Record<string, unknown> = {
          activity: it.activity,
          when: new Date(it.timestampMs).toISOString(),
          digest: it.digest,
        };
        if (it.coins.length) {
          o.coins = it.coins.map((c) => ({
            symbol: c.symbol,
            amount: c.amount,
          }));
        }
        if (it.protocol?.name) o.protocol = it.protocol.name;
        if (it.status && it.status !== "SUCCESS") o.status = it.status;
        if (it.gasFee > 0) o.gasFee = it.gasFee;
        return o;
      });
      await addResult({
        tool: "getAccountActivity",
        toolCallId: toolCall.toolCallId,
        output: {
          address: addr,
          count: richItems.length,
          hasNextPage: !!body.hasNextPage,
          nextCursor: body.nextCursor,
          items: modelItems,
        },
      });
    } catch (e) {
      await addResult({
        tool: "getAccountActivity",
        toolCallId: toolCall.toolCallId,
        output: { error: `Tx history failed: ${(e as Error).message}` },
      });
    }
  }

  async function runGetAccountTransactions(
    toolCall: { toolCallId: string; input: unknown },
    map: typeof coinMap,
    acct: ReturnType<typeof useCurrentAccount>,
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { address, participation, limit, cursor } = (toolCall.input ??
      {}) as {
      address?: string;
      participation?: "SENDER" | "RECEIVER";
      limit?: number;
      cursor?: string;
    };
    const addr = (address?.trim() || acct?.address || "").trim();
    if (!addr) {
      await addResult({
        tool: "getAccountTransactions",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "No wallet connected and no address given. Ask the user to connect a wallet (button top-right) or name an address.",
        },
      });
      return;
    }
    // Reverse-index coinType → {symbol, decimals, icon} to humanize the raw
    // signed balance changes the endpoint returns.
    const byType = new Map<
      string,
      { symbol: string; decimals: number; icon?: string }
    >();
    if (map) {
      for (const [symbol, info] of Object.entries(map)) {
        byType.set(canonicalCoinType(info.coin_type), {
          symbol,
          decimals: info.decimals,
          icon: info.icon_url,
        });
      }
    }
    const humanizeCoins = (changes: AccountTx["balanceChanges"]): TxCoin[] =>
      changes.map((c) => {
        const info = byType.get(canonicalCoinType(c.coinType));
        const decimals = info?.decimals ?? 9;
        let amount = 0;
        try {
          amount = Number(BigInt(c.rawAmount)) / 10 ** decimals;
        } catch {
          amount = Number(c.rawAmount) / 10 ** decimals;
        }
        return {
          symbol: info?.symbol ?? c.coinType.split("::").pop() ?? "?",
          amount,
          iconUrl: info?.icon,
        };
      });
    try {
      const params = new URLSearchParams({
        address: addr,
        participation: participation ?? "SENDER",
        size: String(limit ?? 10),
      });
      if (cursor) params.set("nextCursor", cursor);
      const res = await signedFetch(
        `/api/account-transactions?${params.toString()}`
      );
      const body = (await res.json()) as {
        error?: string;
        count?: number;
        hasNextPage?: boolean;
        nextCursor?: string;
        items?: AccountTx[];
      };
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `tx list failed: ${res.status}`);
      }
      const richItems: AccountTxView[] = (body.items ?? []).map((it) => {
        const { balanceChanges, ...rest } = it;
        return { ...rest, coins: humanizeCoins(balanceChanges) };
      });
      accountTxCache.set(toolCall.toolCallId, {
        items: richItems,
        address: addr,
        hasNextPage: !!body.hasNextPage,
      });
      const modelItems = richItems.map((it) => {
        const o: Record<string, unknown> = {
          txType: it.txType,
          when: new Date(it.timestampMs).toISOString(),
          digest: it.digest,
        };
        if (it.functions.length) o.functions = it.functions;
        if (it.protocol?.name) o.protocol = it.protocol.name;
        if (it.status && it.status !== "SUCCESS") o.status = it.status;
        if (it.feeSui > 0) o.feeSui = it.feeSui;
        if (it.txsCount) o.commands = it.txsCount;
        if (it.coins.length) {
          o.coins = it.coins.map((c) => ({
            symbol: c.symbol,
            amount: c.amount,
          }));
        }
        return o;
      });
      await addResult({
        tool: "getAccountTransactions",
        toolCallId: toolCall.toolCallId,
        output: {
          address: addr,
          count: richItems.length,
          hasNextPage: !!body.hasNextPage,
          nextCursor: body.nextCursor,
          items: modelItems,
        },
      });
    } catch (e) {
      await addResult({
        tool: "getAccountTransactions",
        toolCallId: toolCall.toolCallId,
        output: { error: `Transaction list failed: ${(e as Error).message}` },
      });
    }
  }

  async function runGetTransactionDetail(
    toolCall: { toolCallId: string; input: unknown },
    map: typeof coinMap,
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { digest } = (toolCall.input ?? {}) as { digest?: string };
    const d = (digest ?? "").trim();
    if (!d) {
      await addResult({
        tool: "getTransactionDetail",
        toolCallId: toolCall.toolCallId,
        output: { error: "No transaction digest given." },
      });
      return;
    }
    const byType = new Map<
      string,
      { symbol: string; decimals: number; icon?: string }
    >();
    if (map) {
      for (const [symbol, info] of Object.entries(map)) {
        byType.set(canonicalCoinType(info.coin_type), {
          symbol,
          decimals: info.decimals,
          icon: info.icon_url,
        });
      }
    }
    const humanize = (
      changes: TransactionDetail["netBalanceChanges"]
    ): TxCoin[] =>
      changes.map((c) => {
        const info = byType.get(canonicalCoinType(c.coinType));
        const decimals = info?.decimals ?? 9;
        let amount = 0;
        try {
          amount = Number(BigInt(c.rawAmount)) / 10 ** decimals;
        } catch {
          amount = Number(c.rawAmount) / 10 ** decimals;
        }
        return {
          symbol: info?.symbol ?? c.coinType.split("::").pop() ?? "?",
          amount,
          iconUrl: info?.icon,
        };
      });
    try {
      const res = await signedFetch(
        `/api/transaction-detail?digest=${encodeURIComponent(d)}`
      );
      const body = (await res.json()) as TransactionDetail & {
        error?: string;
      };
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `tx detail failed: ${res.status}`);
      }
      const { netBalanceChanges, ...rest } = body;
      const view: TransactionDetailView = {
        ...rest,
        netChange: humanize(netBalanceChanges),
      };
      txDetailCache.set(toolCall.toolCallId, view);
      // Pruned, URL-free summary for the agent (the card reads the cache).
      const output = pruneForModel({
        digest: view.digest,
        status: view.status,
        network: view.network,
        timestampMs: view.timestampMs,
        checkpoint: view.checkpoint,
        sender: view.sender,
        gasFeeSui: view.gasFeeSui,
        gasBudgetSui: view.gasBudgetSui,
        commandCount: view.commandCount,
        eventCount: view.eventCount,
        objectChangeCount: view.objectChangeCount,
        netChange: view.netChange.map((c) => ({
          symbol: c.symbol,
          amount: c.amount,
        })),
        activities: view.activities.map((a) => ({
          activity: a.activity,
          protocol: a.protocol?.name,
          coins: a.coins.map((c) => ({ symbol: c.symbol, amount: c.amount })),
        })),
      });
      await addResult({
        tool: "getTransactionDetail",
        toolCallId: toolCall.toolCallId,
        output,
      });
    } catch (e) {
      await addResult({
        tool: "getTransactionDetail",
        toolCallId: toolCall.toolCallId,
        output: { error: `Transaction detail failed: ${(e as Error).message}` },
      });
    }
  }

  async function runSearchToken(
    toolCall: { toolCallId: string; input: unknown },
    map: typeof coinMap,
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { query } = (toolCall.input ?? {}) as { query?: string };
    const q = (query ?? "").trim();
    if (!q) {
      await addResult({
        tool: "searchToken",
        toolCallId: toolCall.toolCallId,
        output: {
          error: "Empty query — pass a token symbol or name to look up.",
        },
      });
      return;
    }
    if (!map) {
      await addResult({
        tool: "searchToken",
        toolCallId: toolCall.toolCallId,
        output: {
          error: "Token registry not loaded yet — ask again in a moment.",
        },
      });
      return;
    }
    const qUpper = q.toUpperCase();
    const qLower = q.toLowerCase();
    // Rank registry entries: exact symbol → symbol prefix → symbol substring
    // → exact name → name substring. Lower score = closer match.
    const ranked: Array<{ item: CoinListItem; score: number }> = [];
    for (const [symbol, coin] of Object.entries(map)) {
      const symUpper = symbol.toUpperCase();
      const nameLower = coin.name.toLowerCase();
      let score = -1;
      if (symUpper === qUpper) score = 0;
      else if (symUpper.startsWith(qUpper)) score = 1;
      else if (symUpper.includes(qUpper)) score = 2;
      else if (nameLower === qLower) score = 3;
      else if (nameLower.includes(qLower)) score = 4;
      if (score < 0) continue;
      ranked.push({
        item: {
          coinType: coin.coin_type,
          name: coin.name,
          symbol,
          decimals: coin.decimals,
          imgUrl: coin.icon_url,
          isVerified: coin.verified,
          isBridged: false,
        },
        score,
      });
    }
    ranked.sort(
      (a, b) => a.score - b.score || a.item.symbol.localeCompare(b.item.symbol)
    );
    const items = ranked.slice(0, 6).map((r) => r.item);
    coinListCache.set(toolCall.toolCallId, { items, sortBy: "SEARCH" });
    await addResult({
      tool: "searchToken",
      toolCallId: toolCall.toolCallId,
      output: pruneForModel({
        query: q,
        count: items.length,
        matches: items.map((c) => ({
          symbol: c.symbol,
          name: c.name,
          coinType: c.coinType,
          verified: c.isVerified,
        })),
      }),
    });
  }

  async function runGetCoins(
    toolCall: { toolCallId: string; input: unknown },
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { sortBy, limit, page } = (toolCall.input ?? {}) as {
      sortBy?: string;
      limit?: number;
      page?: number;
    };
    try {
      const params = new URLSearchParams({
        sortBy: sortBy ?? "MARKET_CAP",
        size: String(limit ?? 10),
        page: String(page ?? 0),
      });
      const res = await signedFetch(`/api/coin-list?${params.toString()}`);
      const body = (await res.json()) as {
        error?: string;
        items?: CoinListItem[];
        page?: number;
        hasNextPage?: boolean;
      };
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `coin list failed: ${res.status}`);
      }
      const items = body.items ?? [];
      coinListCache.set(toolCall.toolCallId, {
        items,
        sortBy: sortBy ?? "MARKET_CAP",
      });
      // pruneForModel strips imgUrl + nulls; the card reads icons from cache.
      await addResult({
        tool: "getCoins",
        toolCallId: toolCall.toolCallId,
        output: pruneForModel({
          sortBy: sortBy ?? "MARKET_CAP",
          count: items.length,
          page: body.page ?? page ?? 0,
          hasNextPage: !!body.hasNextPage,
          coins: items,
        }),
      });
    } catch (e) {
      await addResult({
        tool: "getCoins",
        toolCallId: toolCall.toolCallId,
        output: { error: `Coin list failed: ${(e as Error).message}` },
      });
    }
  }

  async function runGetCoinMetadata(
    toolCall: { toolCallId: string; input: unknown },
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { coinType } = (toolCall.input ?? {}) as { coinType?: string };
    const ct = (coinType ?? "").trim();
    if (!isCoinType(ct)) {
      await addResult({
        tool: "getCoinMetadata",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "Invalid coinType. Expected 0x…::module::TYPE (e.g. 0x2::sui::SUI).",
        },
      });
      return;
    }
    try {
      const res = await signedFetch(
        `/api/coin-metadata?coinType=${encodeURIComponent(ct)}`
      );
      const body = (await res.json()) as CoinMetadata & { error?: string };
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `coin metadata failed: ${res.status}`);
      }
      coinMetadataCache.set(toolCall.toolCallId, body);
      await addResult({
        tool: "getCoinMetadata",
        toolCallId: toolCall.toolCallId,
        output: pruneForModel(body),
      });
    } catch (e) {
      await addResult({
        tool: "getCoinMetadata",
        toolCallId: toolCall.toolCallId,
        output: { error: `Coin metadata failed: ${(e as Error).message}` },
      });
    }
  }

  async function runGetCoinHolders(
    toolCall: { toolCallId: string; input: unknown },
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { coinType, limit, page } = (toolCall.input ?? {}) as {
      coinType?: string;
      limit?: number;
      page?: number;
    };
    const ct = (coinType ?? "").trim();
    if (!isCoinType(ct)) {
      await addResult({
        tool: "getHoldersByCoinType",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "Invalid coinType. Expected 0x…::module::TYPE (e.g. 0x2::sui::SUI).",
        },
      });
      return;
    }
    try {
      const params = new URLSearchParams({
        coinType: ct,
        size: String(limit ?? 10),
        page: String(page ?? 0),
      });
      const res = await signedFetch(`/api/coin-holders?${params.toString()}`);
      const body = (await res.json()) as {
        error?: string;
        items?: CoinHolder[];
        page?: number;
        hasNextPage?: boolean;
      };
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `coin holders failed: ${res.status}`);
      }
      const items = body.items ?? [];
      coinHoldersCache.set(toolCall.toolCallId, {
        items,
        symbol: items[0]?.symbol ?? "?",
        coinType: ct,
      });
      await addResult({
        tool: "getHoldersByCoinType",
        toolCallId: toolCall.toolCallId,
        output: pruneForModel({
          coinType: ct,
          symbol: items[0]?.symbol ?? "?",
          count: items.length,
          page: body.page ?? page ?? 0,
          hasNextPage: !!body.hasNextPage,
          holders: items,
        }),
      });
    } catch (e) {
      await addResult({
        tool: "getHoldersByCoinType",
        toolCallId: toolCall.toolCallId,
        output: { error: `Coin holders failed: ${(e as Error).message}` },
      });
    }
  }

  async function runSendStablecoin(
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
        tool: "sendStablecoin",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "Wallet not connected. The user needs to connect a wallet before I can send.",
        },
      });
      return;
    }
    const { symbol, amount, recipient } = toolCall.input as {
      symbol: string;
      amount: number;
      recipient: string;
    };
    try {
      const built = await buildGaslessSend({
        symbol,
        amountHuman: amount,
        recipient,
        sender: acct.address,
        coinMap: map,
        client: client as unknown as SuiGrpcClient,
      });
      gaslessSendCache.set(toolCall.toolCallId, {
        tx: built.tx,
        symbol: built.symbol,
        coinType: built.coinType,
        decimals: built.decimals,
        amountHuman: built.amountHuman,
        recipient: built.recipient,
        recipientName: built.recipientName,
        fetchedAt: Date.now(),
      });
      await addResult({
        tool: "sendStablecoin",
        toolCallId: toolCall.toolCallId,
        output: {
          status: "built_unsigned" as const,
          note: "Transfer constructed and shown in the card. NOT sent — the user must review and click Confirm & sign to send. Do not say it's done/sent; invite them to review and sign.",
          gasless: true,
          amount: Number(built.amountHuman.toFixed(6)),
          symbol: built.symbol,
          recipient: built.recipient,
          recipientName: built.recipientName,
        },
      });
    } catch (e) {
      await addResult({
        tool: "sendStablecoin",
        toolCallId: toolCall.toolCallId,
        output: {
          error: `Gasless send failed to build: ${(e as Error).message}`,
        },
      });
    }
  }

  async function runCreatePaymentLink(
    toolCall: { toolCallId: string; input: unknown },
    map: typeof coinMap,
    acct: ReturnType<typeof useCurrentAccount>,
    client: SuiClientLike,
    ref: React.RefObject<AddResultFn | null>
  ) {
    const addResult = ref.current;
    if (!addResult) return;
    const { symbol, amount, recipient, title, expiryHours } =
      toolCall.input as {
        symbol: string;
        amount?: number;
        recipient?: string;
        title?: string;
        expiryHours?: number;
      };

    // Recipient defaults to the connected wallet ("a link for me").
    const recipientInput = (recipient ?? "").trim() || acct?.address;
    if (!recipientInput) {
      await addResult({
        tool: "createPaymentLink",
        toolCallId: toolCall.toolCallId,
        output: {
          error:
            "No wallet connected and no recipient named. Ask the user to connect a wallet or name who should be paid.",
        },
      });
      return;
    }

    // Token is literal — never substitute. Unknown symbol → tell the agent to searchToken.
    const coin = resolveSymbol(map, symbol);
    if (!coin) {
      await addResult({
        tool: "createPaymentLink",
        toolCallId: toolCall.toolCallId,
        output: {
          error: `Unknown token '${symbol}'. Call searchToken to confirm the exact symbol, then retry — never substitute a different token.`,
        },
      });
      return;
    }

    try {
      // Validate the recipient now (gives the creator immediate feedback on a
      // bad name/address) and capture a preview address. The pay page resolves
      // the verbatim recipient again, live, before anyone pays.
      // Bidirectional: a SuiNS name forward-resolves; a raw 0x address
      // reverse-resolves to its primary name (when set) so the card can show
      // it instead of a bare address.
      const { address, name } = await lookupSuins(
        recipientInput,
        client as unknown as SuiGrpcClient
      );

      const data: PaymentLinkData = {
        version: 1,
        recipient: recipientInput,
        symbol: symbol.toUpperCase(),
        amount: amount != null && amount > 0 ? amount : undefined,
        title: title?.trim() ? title.trim().slice(0, 80) : undefined,
        expiryMs:
          expiryHours && expiryHours > 0
            ? Date.now() + expiryHours * 3_600_000
            : undefined,
        creator: acct?.address,
      };

      const blob = encodePaymentLink(data);
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const url = paymentLinkUrl(origin, blob);
      const gaslessEligible = isGaslessStablecoin(coin.coin_type);

      paymentLinkCache.set(toolCall.toolCallId, {
        data,
        blob,
        url,
        resolvedRecipient: address,
        recipientName: name,
        coinType: coin.coin_type,
        decimals: coin.decimals,
        gaslessEligible,
        fetchedAt: Date.now(),
      });

      // URL-free summary for the model (the card reads the cache for the link).
      await addResult({
        tool: "createPaymentLink",
        toolCallId: toolCall.toolCallId,
        output: {
          status: "built_unsigned" as const,
          note: "Payment link created. The URL + QR are rendered in the card below your reply — you do NOT have the URL here and must NEVER write, paste, guess, or placeholder one (no https://…, no localhost…, no markdown link, no '(replace with actual link)'). Reply in ONE short sentence pointing the user at the card to copy/scan/share. Nothing is on-chain; never say it's paid or sent.",
          symbol: data.symbol,
          amount: data.amount ?? null,
          openAmount: data.amount == null,
          recipient: address,
          recipientName: name ?? null,
          title: data.title ?? null,
          gasless: gaslessEligible,
        },
      });
    } catch (e) {
      await addResult({
        tool: "createPaymentLink",
        toolCallId: toolCall.toolCallId,
        output: {
          error: `Couldn't create payment link: ${(e as Error).message}`,
        },
      });
    }
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

    const { steps, risks } = toolCall.input as {
      steps: ExecutePlanStep[];
      risks?: PlanRisk[];
    };
    // Map the model-facing origin-union steps onto the builder's flat RawStep
    // shape. Pure + deterministic, so the silent slippage rebuild — which
    // re-runs this on the cached union steps — produces an identical plan.
    const rawSteps = adaptPlanSteps(steps);

    try {
      // On silent rebuilds, preserve the previously-computed real gas
      // (buildPlanTransaction skips the dryRun when estimateGas is false).
      const prev = silent
        ? actionPlanCache.get(toolCall.toolCallId)
        : undefined;

      const { tx, resolved, summary } = await buildPlanTransaction({
        steps: rawSteps,
        sender: acct.address,
        coinMap: map,
        vaultList,
        slippagePct: slippageRef.current,
        client: suiClientRef.current,
        estimateGas: !silent,
        prevGasSui: prev?.summary.estimatedGasSui,
        sponsorGas: sponsorGasRef.current,
      });

      const cached: CachedActionPlan = {
        tx,
        steps: resolved,
        originalInput: steps,
        // Preserve agent risks across silent slippage rebuilds (the rebuild
        // passes only `steps`, so `risks` would otherwise be lost).
        risks: risks ?? prev?.risks,
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
      const sendSteps = resolved.filter(
        (s): s is ResolvedSendStep => s.kind === "send"
      );

      // Minimal summary back to the model — keeps prompt tokens tight.
      // `status` is first + explicit: the PTB is only CONSTRUCTED here, not
      // executed. The user must review and sign in the card. Without this the
      // model reads a successful "executePlan" result as "done/executed".
      const output = {
        status: "built_unsigned" as const,
        note: "PTB constructed and shown in the card. NOT executed — the user must review and click Confirm & sign to execute. Do not say it's done/sent/executed; invite them to review and sign.",
        planId: toolCall.toolCallId,
        stepCount: resolved.length,
        swapCount: swapSteps.length,
        splitCount: splitSteps.length,
        depositCount: depositSteps.length,
        redeemCount: redeemSteps.length,
        cancelCount: cancelSteps.length,
        sendCount: sendSteps.length,
        sends: sendSteps.map((s) => ({
          amount: Number(s.amountHuman.toFixed(6)),
          symbol: s.symbol,
          recipient: s.recipient,
          recipientName: s.recipientName,
        })),
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

  function handleSponsorGasChange(next: boolean) {
    setSponsorGas(next);
    sponsorGasRef.current = next;
    // Rebuild so the SUI gas reserve is released/restored. Unlike slippage,
    // this matters whenever the plan draws SUI from balance, so always refresh.
    if (!latestPlanToolCallId) return;
    if (!actionPlanCache.get(latestPlanToolCallId)) return;
    void handlePlanRefresh(latestPlanToolCallId);
  }

  async function handleConfirmPlan(toolCallId: string) {
    // Gasless stablecoin transfers live in a separate cache + execution path
    // (they can't be composite PTBs). Route them before the plan lookup.
    if (gaslessSendCache.get(toolCallId)) {
      return handleConfirmGaslessSend(toolCallId);
    }
    setSignError(null);
    setPlanTxError(undefined);
    setPlanTxStatus(undefined);
    setPlanGasSui(undefined);
    setPlanReceivedShares(undefined);
    setPlanSponsored(false);
    setSponsorFallbackReason(undefined);
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
      // Sign + execute the plan. When "Sprout pays gas" is on, route through
      // Enoki (build kind bytes → sponsor → wallet signs → execute). If
      // sponsorship fails for any reason, fall back to wallet-paid gas so the
      // plan still goes through. Both paths produce an on-chain digest.
      let digest: string;
      let sponsored = false;
      const planTx = cached.tx as unknown as Transaction;
      // Enoki won't sponsor a transfer to an address it can't vouch for, so
      // allow exactly this plan's send recipients (resolved 0x addresses).
      const sendRecipients = Array.from(
        new Set(
          cached.steps
            .filter((s): s is ResolvedSendStep => s.kind === "send")
            .map((s) => s.recipient)
            .filter(Boolean)
        )
      );
      const walletPay = async () => {
        const signed = await signAndExecute({ transaction: planTx });
        const signedTx =
          signed.$kind === "Transaction"
            ? signed.Transaction
            : signed.FailedTransaction;
        return signedTx.digest;
      };
      if (sponsorGasRef.current) {
        try {
          digest = await executeSponsored({
            tx: planTx,
            sender: acct.address,
            network: currentNetwork,
            suiClient: suiClientRef.current as unknown as SuiGrpcClient,
            signTransaction,
            allowedAddresses: sendRecipients,
          });
          sponsored = true;
        } catch (sponsorErr) {
          // Only fall back when Enoki couldn't sponsor BEFORE the wallet was
          // asked to sign. If the user rejected the sponsored signature (or
          // execution failed after signing), do NOT re-prompt — rethrow so it's
          // handled as a normal cancel/error.
          if (!(sponsorErr instanceof SponsorshipUnavailableError)) {
            throw sponsorErr;
          }
          // Not silent: log the real Enoki reason, then fall back to wallet gas.
          console.error(
            "[handleConfirmPlan] Enoki sponsorship unavailable — falling back to wallet-paid gas:",
            (sponsorErr as Error).message
          );
          setSponsorFallbackReason((sponsorErr as Error).message);
          digest = await walletPay();
        }
      } else {
        digest = await walletPay();
      }
      setPlanSponsored(sponsored);
      setPlanSigning(false);
      setPlanConfirming(true);
      setPlanTxDigest(digest);

      try {
        const finalized = await suiClientRef.current.core.waitForTransaction({
          digest,
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

  async function handleConfirmGaslessSend(toolCallId: string) {
    setSignError(null);
    setPlanTxError(undefined);
    setPlanTxStatus(undefined);
    setPlanGasSui(undefined);
    setPlanReceivedShares(undefined);
    const cached = gaslessSendCache.get(toolCallId);
    if (!cached) {
      setSignError("Transfer expired. Ask again to rebuild.");
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
      // dapp-kit serializes the tx via our gRPC client, which resolves a
      // qualifying gasless stablecoin transfer to gasPrice=0 / gasBudget=0.
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
          include: { effects: true },
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
            setPlanGasSui(Math.max(0, Number(mist) / 1e9));
          }
        } else {
          setPlanTxStatus("failure");
          const err = finTx.status.success ? null : finTx.status.error;
          setPlanTxError(
            (typeof err === "string"
              ? err
              : err
              ? JSON.stringify(err)
              : null) || "Transfer failed on chain."
          );
        }
      } catch (waitErr) {
        console.warn("[gaslessSend] waitForTransaction failed", waitErr);
        setPlanTxStatus("failure");
        setPlanTxError(
          `Couldn't confirm on chain: ${
            (waitErr as Error).message
          }. The transfer may still be processing.`
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

  // Clicking the navbar Sprout logo wipes this session back to the hero.
  useRegisterChatReset(() => {
    stop();
    setMessages([]);
    setDraft("");
    setSignError(null);
  });

  if (messages.length === 0) {
    if (embedded) {
      return (
        <EmbeddedEmpty
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
          ready={!!coinMap}
          model={selectedModel}
          onModelChange={setSelectedModel}
        />
      );
    }
    return (
      <IdleHero
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={submit}
        ready={!!coinMap}
        model={selectedModel}
        onModelChange={setSelectedModel}
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

  const body = (
    <div
      className={cn(
        "flex flex-col",
        // When embedded inside a flex-row rail (feed page aside), the
        // container has no explicit width — it must stretch to fill the
        // parent or the chat collapses to content width.
        embedded ? "h-full w-full min-w-0" : "h-dvh",
      )}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={stick.scrollRef}
          className={cn("min-h-0 flex-1 overflow-y-auto", !embedded && "pt-16")}
        >
          <div
            ref={stick.contentRef}
            className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-4 pb-3 sm:px-6"
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
                    sponsorGas,
                    sponsored: planSponsored,
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
                    onSponsorGasChange: handleSponsorGasChange,
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
                className="surface-card inline-flex items-center gap-2.5 self-start px-3.5 py-2 text-body-sm font-medium rounded-card"
                role="status"
                aria-label="Sprout is thinking"
              >
                <LiquidBlob size={20} />
                <span className="shimmer-text">Thinking…</span>
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

            {sponsorFallbackReason && (
              <div className="flex items-start justify-between gap-3 surface-card px-4 py-3 text-body-sm text-midnight-ink rounded-card ring-1 ring-engagement-gold/40">
                <span>
                  <span className="font-medium">
                    Sprout couldn&apos;t cover gas
                  </span>{" "}
                  — you paid the network fee from your wallet instead.{" "}
                  <span className="text-muted-ash">
                    {sponsorFallbackReason}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setSponsorFallbackReason(undefined)}
                  className="shrink-0 text-caption font-medium text-muted-ash transition-colors hover:text-midnight-ink"
                >
                  Dismiss
                </button>
              </div>
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
        <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6">
          <ChatInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => submit(draft)}
            disabled={isStreaming}
            placeholder={
              isStreaming ? "Sprout is thinking…" : "Tell me a swap or a goal…"
            }
            model={selectedModel}
            onModelChange={setSelectedModel}
          />
        </div>
      </div>
    </div>
  );

  return embedded ? body : <CinematicShell mode="dim">{body}</CinematicShell>;
}

function EmbeddedEmpty({
  draft,
  onDraftChange,
  onSubmit,
  ready,
  model,
  onModelChange,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onSubmit: (text: string) => void;
  ready: boolean;
  model?: string;
  onModelChange?: (id: string) => void;
}) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col items-center justify-center px-5">
      <div className="w-full max-w-2xl space-y-4">
        <div className="text-center">
          <h2 className="font-alt text-body-lg font-medium tracking-tight text-midnight-ink">
            Ask Sprout
          </h2>
          <p className="mt-1 text-body-sm text-muted-ash">
            Swap, deposit, or ask about any vault you see in the feed.
          </p>
        </div>
        <ChatInput
          value={draft}
          onChange={onDraftChange}
          onSubmit={() => onSubmit(draft)}
          disabled={!ready}
          placeholder={ready ? "Tell me a goal…" : "Loading tokens…"}
          model={model}
          onModelChange={onModelChange}
        />
        <ExamplePrompts onPick={onSubmit} />
      </div>
    </div>
  );
}

function IdleHero({
  draft,
  onDraftChange,
  onSubmit,
  ready,
  model,
  onModelChange,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onSubmit: (text: string) => void;
  ready: boolean;
  model?: string;
  onModelChange?: (id: string) => void;
}) {
  return (
    <CinematicShell mode="bright">
      {/* Foreground content. Vertically centered stack: headline + input
       *  + example chips, all in one column. */}
      <div className="relative z-20 mx-auto flex w-full max-w-3xl flex-col items-center justify-center px-4 min-h-screen sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ scale: 1.03 }}
          transition={{
            type: "spring",
            visualDuration: 0.6,
            bounce: 0.1,
            delay: 0.08,
          }}
          className="mb-5 inline-flex"
        >
          <LiveMainnetBadge />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            visualDuration: 0.7,
            bounce: 0.15,
            delay: 0.15,
          }}
          className="font-alt display-tight max-w-[1100px] text-center font-medium leading-[1.05] tracking-tight text-midnight-ink text-[clamp(40px,5.4vw,72px)]"
        >
          <span className="block">Plant a goal.</span>
          <span className="block">
            <span className="text-gradient-sprout font-semibold">Sprout</span>{" "}
            grows it on{" "}
            <span className="text-gradient-sui font-semibold">Sui</span>.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            visualDuration: 0.7,
            bounce: 0.1,
            delay: 0.3,
          }}
          className="mt-5 max-w-3xl text-center text-body text-pretty text-muted-ash"
        >
          Describe a goal in plain English — Sprout routes the swaps, pools, and
          deposits across Sui. Its{" "}
          <span className="font-alt font-medium text-midnight-ink">
            Adaptive Risk Guardian
          </span>{" "}
          flags every risk and lays each transaction out in plain terms, so you{" "}
          <span className="font-alt font-medium text-midnight-ink">
            understand before you sign
          </span>{" "}
          — never a blind confirm, never beyond your permission.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            visualDuration: 0.7,
            bounce: 0.15,
            delay: 0.4,
          }}
          className="mt-8 w-full max-w-2xl space-y-4"
        >
          <ChatInput
            value={draft}
            onChange={onDraftChange}
            onSubmit={() => onSubmit(draft)}
            autoFocus
            disabled={!ready}
            placeholder={ready ? "Tell me a goal…" : "Loading tokens…"}
            model={model}
            onModelChange={onModelChange}
          />
          <ExamplePrompts onPick={onSubmit} />
        </motion.div>

        <div className="mt-7">
          <HeroStatStrip />
        </div>
      </div>
    </CinematicShell>
  );
}
