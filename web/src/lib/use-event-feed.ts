"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EVENT_DEFS,
  byNewest,
  fetchFeedPage,
  normalizeEvent,
  type CursorMap,
  type FeedEvent,
} from "@/lib/sui-events";

const PAGE_SIZE = 50;
const POLL_MS = 5000;
const FRESH_MS = 2600;

export type FeedStatus = "loading" | "ready" | "error";

export type UseEventFeed = {
  events: FeedEvent[];
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
 * Live, paginated, merged feed of on-chain vault events.
 *
 * - Pages OLDER via per-type `before` cursors (independent streams, merged +
 *   re-sorted newest-first — the server returns ascending, never trusted).
 * - Polls the newest page every 5s; new events are prepended when the user is
 *   at the top, or buffered behind a count when they're scrolled down.
 */
export function useEventFeed(): UseEventFeed {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());

  const cursorsRef = useRef<CursorMap>(
    Object.fromEntries(EVENT_DEFS.map((d) => [d.key, null]))
  );
  const hasMoreRef = useRef<Record<string, boolean>>(
    Object.fromEntries(EVENT_DEFS.map((d) => [d.key, true]))
  );
  const idSetRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<FeedEvent[]>([]);
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
    [flushPending]
  );

  /** Fetch the next older page for every stream that still has more. */
  const loadOlder = useCallback(() => {
    if (loadingRef.current) return;
    const activeDefs = EVENT_DEFS.filter((d) => hasMoreRef.current[d.key]);
    if (activeDefs.length === 0) return;

    loadingRef.current = true;
    const firstLoad = idSetRef.current.size === 0;
    if (firstLoad) setStatus("loading");

    fetchFeedPage({
      before: cursorsRef.current,
      limit: PAGE_SIZE,
      defs: activeDefs,
    })
      .then((page) => {
        const fresh: FeedEvent[] = [];
        for (const d of activeDefs) {
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
        if (fresh.length) {
          setEvents((prev) => [...prev, ...fresh].sort(byNewest));
        }
        setHasMore(Object.values(hasMoreRef.current).some(Boolean));
        setStatus("ready");
        setError(null);
      })
      .catch((e: Error) => {
        if (firstLoad) setStatus("error");
        setError(e.message);
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

  // Live polling of the newest page.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      const before: CursorMap = Object.fromEntries(
        EVENT_DEFS.map((d) => [d.key, null])
      );
      fetchFeedPage({ before, limit: PAGE_SIZE, defs: EVENT_DEFS })
        .then((page) => {
          const incoming: FeedEvent[] = [];
          for (const d of EVENT_DEFS) {
            for (const node of page[d.key].nodes) {
              const ev = normalizeEvent(node, d);
              if (!ev || idSetRef.current.has(ev.id)) continue;
              idSetRef.current.add(ev.id);
              incoming.push(ev);
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
        })
        .catch(() => {
          /* transient poll error — next tick retries */
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
