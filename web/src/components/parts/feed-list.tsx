"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUp } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useEventFeed } from "@/lib/use-event-feed";
import { useVaults } from "@/lib/client-vaults";
import { canonicalCoinType } from "@/lib/client-coins";
import { FeedEventCard } from "@/components/parts/feed-event-card";
import { Skeleton } from "@/components/ui/skeleton";
import { SPRING_BOUNCY } from "@/lib/motion";

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
  } = useEventFeed();
  const account = useCurrentAccount();
  const selfAddr = account ? canonicalCoinType(account.address) : null;

  const vaults = useVaults();
  const vaultIndex = useMemo(() => {
    const m = new Map<string, { name: string; logoUrl?: string }>();
    for (const v of vaults ?? []) {
      m.set(canonicalCoinType(v.objectId), {
        name: v.name,
        logoUrl: v.logoUrl,
      });
    }
    return m;
  }, [vaults]);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 92,
    overscan: 6,
    getItemKey: (i) => events[i]?.id ?? i,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Infinite scroll: pull older pages as the tail comes into view.
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (hasMore && last.index >= events.length - 5) loadOlder();
  }, [virtualItems, events.length, hasMore, loadOlder]);

  // Track whether the user is at the top (controls live prepend vs buffer).
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
      <div className="mx-auto w-full max-w-xl px-4 pt-4">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] w-full rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  if (status === "error" && events.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 px-4 pt-16 text-center">
        <p className="text-body-sm text-muted-ash">
          Couldn’t load the feed.
          {error ? ` ${error}` : ""}
        </p>
        <button
          type="button"
          onClick={loadOlder}
          className="rounded-button surface-card px-4 py-2 text-body-sm font-medium text-midnight-ink shadow-button transition-colors hover:text-midnight-ink"
        >
          Retry
        </button>
      </div>
    );
  }

  if (status === "ready" && events.length === 0) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-16 text-center">
        <p className="text-body-sm text-muted-ash">No activity yet.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div
        ref={parentRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-xl px-4 pt-4 pb-24">
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((vi) => {
              const event = events[vi.index];
              if (!event) return null;
              const vault = event.vaultId
                ? vaultIndex.get(canonicalCoinType(event.vaultId))
                : undefined;
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  className="absolute inset-x-0 top-0 pb-3"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <FeedEventCard
                    event={event}
                    isSelf={
                      !!selfAddr &&
                      canonicalCoinType(event.owner) === selfAddr
                    }
                    vaultName={vault?.name}
                    vaultLogoUrl={vault?.logoUrl}
                  />
                </div>
              );
            })}
          </div>
          {hasMore && (
            <p className="pt-2 text-center text-caption text-muted-ash">
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
  );
}
