"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUp } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useEventFeed } from "@/lib/use-event-feed";
import { useVaults } from "@/lib/client-vaults";
import { useCoinMap, canonicalCoinType } from "@/lib/client-coins";
import {
  buildCoinIndex,
  deriveEventDisplay,
  type FeedEvent,
  type VaultInfo,
} from "@/lib/sui-events";
import { FeedEventCard } from "@/components/parts/feed-event-card";
import { Skeleton } from "@/components/ui/skeleton";
import { SPRING_BOUNCY } from "@/lib/motion";

/** Calendar-relative bucket for a timestamp (module fn — keeps Date out of render). */
function timeBucket(ms: number): string {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  if (ms >= startOfToday) return "Today";
  if (ms >= startOfToday - 86_400_000) return "Yesterday";
  return "Earlier";
}

type Row =
  | { type: "header"; id: string; label: string }
  | { type: "event"; id: string; event: FeedEvent };

export function FeedList() {
  const {
    events,
    status,
    error,
    hasMore,
    loadOlder,
    pendingCount,
    flushPending,
    setAtTop,
    freshIds,
  } = useEventFeed();
  const account = useCurrentAccount();
  const selfAddr = account ? canonicalCoinType(account.address) : null;

  const coinMap = useCoinMap();
  const coinIndex = useMemo(() => buildCoinIndex(coinMap), [coinMap]);

  const vaults = useVaults();
  const vaultIndex = useMemo(() => {
    const m = new Map<string, VaultInfo>();
    for (const v of vaults ?? []) {
      m.set(canonicalCoinType(v.objectId), {
        name: v.name,
        logoUrl: v.logoUrl,
        depositSymbol: v.depositSymbol,
        depositDecimals: v.depositDecimals,
        receiptCoinPriceUsd: v.receiptCoinPriceUsd,
        apyPct: v.apyPct,
      });
    }
    return m;
  }, [vaults]);

  // Flatten events into rows with time-group headers.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let last: string | null = null;
    for (const ev of events) {
      const bucket = timeBucket(ev.timestampMs);
      if (bucket !== last) {
        out.push({ type: "header", id: `header:${bucket}`, label: bucket });
        last = bucket;
      }
      out.push({ type: "event", id: ev.id, event: ev });
    }
    return out;
  }, [events]);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.type === "header" ? 37 : 84),
    overscan: 6,
    getItemKey: (i) => rows[i]?.id ?? i,
  });

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (hasMore && last.index >= rows.length - 6) loadOlder();
  }, [virtualItems, rows.length, hasMore, loadOlder]);

  const onScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    setAtTop(el.scrollTop < 24);
  }, [setAtTop]);

  const jumpToTop = useCallback(() => {
    flushPending();
    parentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [flushPending]);

  // ---- non-list states ----
  if (status === "loading" && events.length === 0) {
    return (
      <div className="w-full">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-hairline px-5 py-3.5"
          >
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24 rounded-card" />
              <Skeleton className="h-4 w-32 rounded-card" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (status === "error" && events.length === 0) {
    return (
      <div className="flex w-full flex-col items-center gap-3 px-5 pt-16 text-center">
        <p className="text-body-sm text-muted-ash">
          Couldn’t load the feed.{error ? ` ${error}` : ""}
        </p>
        <button
          type="button"
          onClick={loadOlder}
          className="rounded-button surface-panel px-4 py-2 text-body-sm font-medium text-midnight-ink shadow-button"
        >
          Retry
        </button>
      </div>
    );
  }

  if (status === "ready" && events.length === 0) {
    return (
      <div className="w-full px-5 pt-16 text-center">
        <p className="text-body-sm text-muted-ash">No activity yet.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Live header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-5 py-3.5">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-deliver-green/60" />
          <span className="relative inline-flex size-2 rounded-full bg-deliver-green" />
        </span>
        <span className="text-body-sm font-medium text-midnight-ink">
          Live activity
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={parentRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto"
        >
          <div className="w-full pb-24">
            <div
              className="relative"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualItems.map((vi) => {
                const row = rows[vi.index];
                if (!row) return null;
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    className="absolute inset-x-0 top-0"
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    {row.type === "header" ? (
                      <div className="border-b border-hairline bg-whisper-gray/40 px-5 py-2 text-caption font-medium uppercase tracking-wider text-muted-ash">
                        {row.label}
                      </div>
                    ) : (
                      <FeedEventCard
                        event={row.event}
                        display={deriveEventDisplay(
                          row.event,
                          row.event.vaultId
                            ? vaultIndex.get(
                                canonicalCoinType(row.event.vaultId)
                              )
                            : undefined,
                          coinIndex
                        )}
                        isSelf={
                          !!selfAddr &&
                          canonicalCoinType(row.event.owner) === selfAddr
                        }
                        fresh={freshIds.has(row.event.id)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {hasMore && (
              <p className="pt-1 text-center text-caption text-muted-ash">
                Loading older activity…
              </p>
            )}
          </div>
        </div>

        <AnimatePresence>
          {pendingCount > 0 && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: -8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.9 }}
              transition={SPRING_BOUNCY}
              onClick={jumpToTop}
              className="absolute left-1/2 top-3 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full surface-card px-3 py-1.5 text-caption font-medium text-midnight-ink shadow-header"
            >
              <ArrowUp className="size-3.5" strokeWidth={2.4} />
              {pendingCount} new
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
