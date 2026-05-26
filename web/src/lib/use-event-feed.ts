"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EVENT_DEFS,
  byNewest,
  fetchFeedPage,
  normalizeEvent,
  type CursorMap,
  type FeedItem,
} from "@/lib/sui-events";
import { fetchDexActivity } from "@/lib/dex-activity";

const PAGE_SIZE = 50;
const DEX_PAGE_SIZE = 25;
const POLL_MS = 15000;
const FRESH_MS = 2600;

export type FeedStatus = "loading" | "ready" | "error";

export type UseEventFeed = {
  events: FeedItem[];
  status: FeedStatus;
  error: string | null;
  hasMore: boolean;
  loadOlder: () => void;
  /** New events that arrived while the user was scrolled away from the top. */
  pendingCount: number;
  /** Reveal buffered new events at the top. */
  flushPending: () => void;
  /** Tell the hook whether the list is scrolled to the top. */
  setAtTop: (atTop: boolean) => void;
  /** Ids of events that just arrived live (for a brief highlight). */
  freshIds: Set<string>;
};

/**
 * Live, paginated, merged feed of on-chain activity — two interleaved sources:
 *
 *  1. Our vault events (Sui GraphQL, per-type `before` cursors).
 *  2. The global Sui DEX swap firehose (Suiscan, page-indexed via our signed
 *     /api/dex-activity proxy).
 *
 * Both streams page OLDER together on `loadOlder`, and the newest page of each
 * is polled every 15s. New items are merged + re-sorted newest-first and either
 * prepended (at top) or buffered behind a count (scrolled down). A failure in
 * one source never takes down the other.
 */
export function useEventFeed(): UseEventFeed {
  const [events, setEvents] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());

  const cursorsRef = useRef<CursorMap>(
    Object.fromEntries(EVENT_DEFS.map((d) => [d.key, null])),
  );
  const hasMoreRef = useRef<Record<string, boolean>>(
    Object.fromEntries(EVENT_DEFS.map((d) => [d.key, true])),
  );
  // DEX is page-indexed: dexPageRef is the next page `loadOlder` will request.
  const dexPageRef = useRef(0);
  const dexHasMoreRef = useRef(true);

  const idSetRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<FeedItem[]>([]);
  const atTopRef = useRef(true);
  const loadingRef = useRef(false);
  const startedRef = useRef(false);

  const markFresh = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setFreshIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setTimeout(() => {
      setFreshIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, FRESH_MS);
  }, []);

  const flushPending = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    const buffered = pendingRef.current;
    pendingRef.current = [];
    setPendingCount(0);
    setEvents((prev) => [...buffered, ...prev].sort(byNewest));
    markFresh(buffered.map((e) => e.id));
  }, [markFresh]);

  const setAtTop = useCallback(
    (atTop: boolean) => {
      atTopRef.current = atTop;
      if (atTop) flushPending();
    },
    [flushPending],
  );

  /** Fetch the next older page from every source that still has more. */
  const loadOlder = useCallback(() => {
    if (loadingRef.current) return;
    const vaultDefs = EVENT_DEFS.filter((d) => hasMoreRef.current[d.key]);
    const dexActive = dexHasMoreRef.current;
    if (vaultDefs.length === 0 && !dexActive) return;

    loadingRef.current = true;
    const firstLoad = idSetRef.current.size === 0;
    if (firstLoad) setStatus("loading");
    const dexPage = dexPageRef.current;

    Promise.allSettled([
      vaultDefs.length
        ? fetchFeedPage({
            before: cursorsRef.current,
            limit: PAGE_SIZE,
            defs: vaultDefs,
          })
        : Promise.resolve(null),
      dexActive
        ? fetchDexActivity({ page: dexPage, size: DEX_PAGE_SIZE })
        : Promise.resolve(null),
    ])
      .then(([vaultRes, dexRes]) => {
        const fresh: FeedItem[] = [];
        let anyOk = false;
        let lastErr: string | null = null;

        if (vaultRes.status === "fulfilled" && vaultRes.value) {
          anyOk = true;
          const page = vaultRes.value;
          for (const d of vaultDefs) {
            const conn = page[d.key];
            cursorsRef.current[d.key] = conn.startCursor;
            hasMoreRef.current[d.key] = conn.hasPreviousPage;
            for (const node of conn.nodes) {
              const ev = normalizeEvent(node, d);
              if (!ev || idSetRef.current.has(ev.id)) continue;
              idSetRef.current.add(ev.id);
              fresh.push(ev);
            }
          }
        } else if (vaultRes.status === "rejected") {
          lastErr = (vaultRes.reason as Error)?.message ?? "vault feed failed";
        }

        if (dexRes.status === "fulfilled" && dexRes.value) {
          anyOk = true;
          const { events: swaps, totalPages } = dexRes.value;
          for (const s of swaps) {
            if (idSetRef.current.has(s.id)) continue;
            idSetRef.current.add(s.id);
            fresh.push(s);
          }
          dexPageRef.current = dexPage + 1;
          dexHasMoreRef.current = dexPage + 1 < totalPages;
        } else if (dexRes.status === "rejected") {
          lastErr = (dexRes.reason as Error)?.message ?? "dex feed failed";
        }

        if (fresh.length) {
          setEvents((prev) => [...prev, ...fresh].sort(byNewest));
        }
        setHasMore(
          Object.values(hasMoreRef.current).some(Boolean) ||
            dexHasMoreRef.current,
        );
        if (anyOk) {
          setStatus("ready");
          setError(null);
        } else if (firstLoad) {
          setStatus("error");
          setError(lastErr);
        }
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, []);

  // Initial load on mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    loadOlder();
  }, [loadOlder]);

  // Live polling of the newest page of both sources.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      const before: CursorMap = Object.fromEntries(
        EVENT_DEFS.map((d) => [d.key, null]),
      );
      Promise.allSettled([
        fetchFeedPage({ before, limit: PAGE_SIZE, defs: EVENT_DEFS }),
        fetchDexActivity({ page: 0, size: DEX_PAGE_SIZE }),
      ]).then(([vaultRes, dexRes]) => {
        const incoming: FeedItem[] = [];
        if (vaultRes.status === "fulfilled") {
          for (const d of EVENT_DEFS) {
            for (const node of vaultRes.value[d.key].nodes) {
              const ev = normalizeEvent(node, d);
              if (!ev || idSetRef.current.has(ev.id)) continue;
              idSetRef.current.add(ev.id);
              incoming.push(ev);
            }
          }
        }
        if (dexRes.status === "fulfilled") {
          for (const s of dexRes.value.events) {
            if (idSetRef.current.has(s.id)) continue;
            idSetRef.current.add(s.id);
            incoming.push(s);
          }
        }
        if (incoming.length === 0) return;
        if (atTopRef.current) {
          setEvents((prev) => [...incoming, ...prev].sort(byNewest));
          markFresh(incoming.map((e) => e.id));
        } else {
          pendingRef.current = [...incoming, ...pendingRef.current];
          setPendingCount(pendingRef.current.length);
        }
      });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [markFresh]);

  return {
    events,
    status,
    error,
    hasMore,
    loadOlder,
    pendingCount,
    flushPending,
    setAtTop,
    freshIds,
  };
}
