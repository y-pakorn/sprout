"use client";

import { useEffect, useState } from "react";
import { useCurrentClient, useCurrentNetwork } from "@mysten/dapp-kit-react";
import type { SuiGrpcClient } from "@mysten/sui/grpc";

export type SuiNetworkStatus = {
  network: string;
  epoch: number | null;
  /** Latest checkpoint height — climbs ~3–4× per second on mainnet. */
  checkpoint: number | null;
  /** True once we have a first value to show. */
  ready: boolean;
  /** True when we have no data and the live source has errored. */
  failed: boolean;
};

/**
 * Live mainnet status for the hero badge. Primary source is the gRPC
 * `SubscriptionService.SubscribeCheckpoints` server-stream — the checkpoint
 * height arrives in real time (sub-second) so the badge number genuinely
 * ticks. We seed instantly with one `getServiceInfo` unary (fast first paint,
 * and it carries the epoch), then let the stream drive updates. If the stream
 * can't run (fullnode/CORS doesn't allow browser grpc-web streaming, or the
 * client lacks the service) we fall back to polling `getServiceInfo` every 3s.
 * Shapes verified against the installed SDK (ledger/subscription proto types).
 */
export function useSuiNetworkStatus(): SuiNetworkStatus {
  const client = useCurrentClient();
  const network = useCurrentNetwork() as string;
  const [state, setState] = useState<{
    checkpoint: number | null;
    epoch: number | null;
    ready: boolean;
    failed: boolean;
  }>({ checkpoint: null, epoch: null, ready: false, failed: false });

  useEffect(() => {
    // The dapp-kit client type only surfaces `.core`; the concrete gRPC client
    // also exposes `.ledgerService` / `.subscriptionService` (same cast the
    // plan builder uses for `.nameService`).
    const grpc = client as unknown as SuiGrpcClient;
    let cancelled = false;
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const apply = (checkpoint: number | null, epoch: number | null) => {
      if (cancelled) return;
      setState((prev) => ({
        checkpoint: checkpoint ?? prev.checkpoint,
        epoch: epoch ?? prev.epoch,
        ready: true,
        failed: false,
      }));
    };

    const readServiceInfo = () =>
      grpc.ledgerService
        .getServiceInfo({})
        .then(({ response }) =>
          apply(
            response.checkpointHeight != null
              ? Number(response.checkpointHeight)
              : null,
            response.epoch != null ? Number(response.epoch) : null,
          ),
        )
        .catch(() => {
          if (!cancelled)
            setState((p) => ({ ...p, failed: p.checkpoint == null }));
        });

    const startPollFallback = () => {
      if (cancelled || pollTimer) return;
      pollTimer = setInterval(readServiceInfo, 3000);
    };

    // 1) Seed immediately (fast number + epoch for the title).
    void readServiceInfo();

    // 2) Real-time checkpoint stream.
    try {
      const call = grpc.subscriptionService.subscribeCheckpoints(
        { readMask: { paths: ["sequence_number"] } },
        { abort: controller.signal },
      );
      call.responses.onMessage((res) => {
        const cp = res.checkpoint?.sequenceNumber;
        if (cp != null) apply(Number(cp), null);
      });
      // Stream ended or errored (not via our abort) → resume with polling.
      call.then(
        () => startPollFallback(),
        () => startPollFallback(),
      );
    } catch {
      startPollFallback();
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [client, network]);

  return {
    network,
    epoch: state.epoch,
    checkpoint: state.checkpoint,
    ready: state.ready,
    failed: state.failed && !state.ready,
  };
}
