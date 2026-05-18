"use client";

import type { QuoteResponse } from "@bluefin-exchange/bluefin7k-aggregator-sdk";

export type CachedQuote = {
  quote: QuoteResponse;
  fromSymbol: string;
  toSymbol: string;
  fromDecimals: number;
  toDecimals: number;
  fromIcon?: string;
  toIcon?: string;
  fromCoinType: string;
  toCoinType: string;
  /** Both verified in the 7K coin index (used for the risk panel) */
  fromVerified: boolean;
  toVerified: boolean;
  /** Original human-readable amount the user requested */
  fromAmountHuman: number;
  /** Reference rate (toUnits per fromUnit, human) from a 1-unit quote.
   *  Used to compute the true price impact. May be 0 if unavailable. */
  spotRate: number;
  /** Precomputed price impact percent (0.5 = 0.5%). Derived from the
   *  actual rate of this quote vs spotRate above. Single source of truth
   *  for the UI's "Price impact" display. */
  impactPct: number;
  fetchedAt: number;
};

const cache = new Map<string, CachedQuote>();

export const quoteCache = {
  set(toolCallId: string, entry: CachedQuote) {
    cache.set(toolCallId, entry);
  },
  get(toolCallId: string): CachedQuote | undefined {
    return cache.get(toolCallId);
  },
  has(toolCallId: string): boolean {
    return cache.has(toolCallId);
  },
  delete(toolCallId: string) {
    cache.delete(toolCallId);
  },
};
