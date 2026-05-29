"use client";

import { MetaAg, EProvider, type MetaQuote } from "@7kprotocol/sdk-ts";
import { Protocol } from "@flowx-finance/sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { GRPC_URLS, DEFAULT_NETWORK } from "@/lib/sui";

// gRPC for general reads + FlowX; JSON-RPC for Cetus (its SDK calls legacy
// JSON-RPC-only methods on Pyth-priced / DeepBookV3 routes and throws on gRPC).
const grpcClient = new SuiGrpcClient({
  network: DEFAULT_NETWORK,
  baseUrl: GRPC_URLS[DEFAULT_NETWORK],
});
const jsonRpcClient = new SuiJsonRpcClient({
  network: DEFAULT_NETWORK,
  url: getJsonRpcFullnodeUrl(DEFAULT_NETWORK),
});

/**
 * 7K Meta Aggregator — quotes across Bluefin7K / Cetus / FlowX (OKX excluded:
 * it builds tx on-the-fly and can't compose into our PTB) and builds the
 * winning route into the shared plan transaction.
 *
 * `partner` is intentionally omitted → no commission (7K's `settle::settle`
 * runs at 0 bps). Note: the `pool::split_fees` aborts seen on some routes are
 * a *venue* pool's own fee logic (e.g. magma/bluemove), not our commission —
 * `metaQuote` handles them by ranking successfully-simulated quotes first.
 */
/**
 * DEX venues the Bluefin7K provider routes through. Exported so the UI can
 * report the real coverage count (see HeroStatStrip) without hardcoding —
 * keep this list as the single source of truth for both routing and display.
 */
export const DEX_SOURCES = [
  "bluefin",
  "bluefinx",
  "turbos",
  "suiswap",
  "cetus",
  "aftermath",
  "flowx",
  "flowx_v3",
  "kriya",
  "kriya_v3",
  "deepbook_v3",
  "obric",
  "stsui",
  "steamm",
  "sevenk_v1",
  "fullsail",
  "ferra_dlmm",
  "ferra_clmm",
  "haedal_pmm",
  "momentum",
] as const;

export const metaAg = new MetaAg({
  client: jsonRpcClient,
  providers: {
    [EProvider.BLUEFIN7K]: {
      sources: [...DEX_SOURCES],
    },
    [EProvider.CETUS]: {},
    [EProvider.FLOWX]: {
      excludeSources: [Protocol.MAGMA_ALMM, Protocol.MAGMA_FINANCE],
    },
  },
} as any);

export type AggQuote = MetaQuote;

const PROVIDER_LABELS: Record<string, string> = {
  bluefin7k: "Bluefin7K",
  cetus: "Cetus",
  flowx: "FlowX",
  okx: "OKX",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** Output amount of a quote (prefer simulated when available). */
export function quoteOut(q: MetaQuote): number {
  return Number(q.simulatedAmountOut ?? q.amountOut);
}

export type RouteHop = {
  /** DEX slug for this hop (e.g. "cetus", "bluefin"). */
  dex: string;
  /** Coin types swapped at this hop, when the provider exposes them. */
  tokenIn?: string;
  tokenOut?: string;
};

export type RouteSplit = {
  /** Fraction of the input routed through this path (0..1). */
  sharePct: number;
  /** Ordered hops along this path (venue + the tokens swapped there). */
  hops: RouteHop[];
};

/**
 * Best-effort per-provider route extraction so the plan card can show what's
 * INSIDE the chosen aggregator's route: split %, and for each hop the venue
 * plus which token swaps to which. Falls back to a single empty entry when the
 * provider's quote shape is unknown.
 */
export function extractRoute(q: MetaQuote): {
  dexes: string[];
  hops: number;
  splits: RouteSplit[];
} {
  const splits: RouteSplit[] = [];
  const dexSet = new Set<string>();
  let maxHops = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = q.quote as any;
  const push = (sharePct: number, hops: RouteHop[]) => {
    hops.forEach((h) => dexSet.add(h.dex));
    maxHops = Math.max(maxHops, hops.length || 1);
    splits.push({ sharePct, hops });
  };
  try {
    if (q.provider === EProvider.BLUEFIN7K) {
      const rs: any[] = raw?.routes ?? [];
      const totalIn = rs.reduce(
        (s, r) => s + (Number(r.tokenInAmount) || 0),
        0
      );
      for (const r of rs) {
        const hops: RouteHop[] = (r.hops ?? [])
          .filter((h: any) => h?.pool?.type)
          .map((h: any) => ({
            dex: h.pool.type,
            tokenIn: h.tokenIn,
            tokenOut: h.tokenOut,
          }));
        push(
          totalIn > 0
            ? (Number(r.tokenInAmount) || 0) / totalIn
            : 1 / rs.length,
          hops
        );
      }
    } else if (q.provider === EProvider.FLOWX) {
      const paths: any[][] = raw?.rawQuote?.paths ?? [];
      const totalIn = paths.reduce(
        (s, p) => s + (Number(p?.[0]?.amountIn) || 0),
        0
      );
      for (const path of paths) {
        const hops: RouteHop[] = path
          .filter((h) => h?.source)
          .map((h) => ({
            dex: h.source,
            tokenIn: h.tokenIn,
            tokenOut: h.tokenOut,
          }));
        push(
          totalIn > 0
            ? (Number(path?.[0]?.amountIn) || 0) / totalIn
            : 1 / paths.length,
          hops
        );
      }
    } else if (q.provider === EProvider.CETUS) {
      const rs: any[] = raw?.routes ?? raw?.paths ?? [];
      const totalIn = rs.reduce((s, r) => s + (Number(r.amountIn) || 0), 0);
      for (const r of rs) {
        const path: any[] = r.path ?? r.pools ?? r.hops ?? [];
        const hops: RouteHop[] = path
          .filter((p) => p?.provider ?? p?.dexName ?? p?.type)
          .map((p) => ({
            dex: p.provider ?? p.dexName ?? p.type,
            tokenIn: p.from ?? p.tokenIn ?? p.coinA,
            tokenOut: p.target ?? p.tokenOut ?? p.coinB,
          }));
        push(
          totalIn > 0 ? (Number(r.amountIn) || 0) / totalIn : 1 / rs.length,
          hops
        );
      }
    }
  } catch {
    /* fall through to provider fallback */
  }
  if (splits.length === 0 || dexSet.size === 0) {
    return {
      dexes: [q.provider],
      hops: 1,
      splits: [{ sharePct: 1, hops: [] }],
    };
  }
  return { dexes: Array.from(dexSet), hops: maxHops, splits };
}

/**
 * Quote across all composable aggregators, simulated for accuracy, sorted
 * best-output-first. Excludes OKX (non-composable). Empty array = no route.
 */
export async function metaQuote(args: {
  coinTypeIn: string;
  coinTypeOut: string;
  amountIn: string;
  sender: string;
}): Promise<MetaQuote[]> {
  const quotes = await metaAg.quote(
    {
      coinTypeIn: args.coinTypeIn,
      coinTypeOut: args.coinTypeOut,
      amountIn: args.amountIn,
      signer: args.sender,
    },
    { sender: args.sender }
  );
  return quotes
    .filter((q) => q.provider !== EProvider.OKX)
    .sort((a, b) => {
      // Prefer quotes that simulated successfully. A quote with no
      // `simulatedAmountOut` only has the aggregator's optimistic off-chain
      // `amountOut`, which can be non-executable — e.g. a route through a pool
      // whose `pool::split_fees` aborts, or (the common case) a SUI-input route
      // whose standalone gas-selection simulation fails when the wallet holds a
      // single SUI coin (input + gas contend for the same object). Ranking on
      // `amountOut` alone would let such a route win and then abort on signing.
      // Un-simulated quotes stay as a last-resort fallback (sorted after).
      const aSim = a.simulatedAmountOut != null;
      const bSim = b.simulatedAmountOut != null;
      if (aSim !== bSim) return aSim ? -1 : 1;
      return quoteOut(b) - quoteOut(a);
    });
}
