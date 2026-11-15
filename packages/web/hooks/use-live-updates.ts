"use client";

// Real time in live mode (ADR 0012): one EventSource on GET /v1/stream for the visitor's account. Each event
// invalidates the reads it makes stale. While the stream is down, chain polling (ADR 0008) takes over, and the
// status says so. The sandbox keeps watching its in-browser chain.

import type { Address } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type { CanvasSnapshot } from "@/hooks/contracts/canvas";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { useZalEvents } from "@/hooks/contracts/events";
import { streamUrl } from "@/lib/api/client";
import {
  keysForStreamEvent,
  parseStreamEvent,
  type LiveStatus,
} from "@/lib/api/stream";
import { queryKeys } from "@/lib/query/keys";

/** How long a stream may stay unanswered before polling takes over. */
const PAUSE_AFTER_MS = 4_000;
const MAX_BACKOFF_MS = 30_000;
/** One transaction emits several events; their invalidations are sent together. */
const BATCH_MS = 150;

let status: LiveStatus = "off";
const listeners = new Set<() => void>();

function setStatus(next: LiveStatus): void {
  if (next === status) return;
  status = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

/** The page's live-update source, for the quiet "live updates paused" state. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => "off",
  );
}

/**
 * Keeps every read on the page current. Live mode with an API streams `account`'s events; when the stream is
 * down, or there is no API, it polls the chain. The sandbox always watches its own chain.
 */
export function useLiveUpdates(
  network: ZalNetwork | undefined,
  account: Address | undefined,
): void {
  const queryClient = useQueryClient();
  const url =
    network?.kind === "live" && account !== undefined
      ? streamUrl(account)
      : undefined;
  const live = useLiveStatus();
  const polling = url === undefined || live === "polling";

  useZalEvents(polling ? network : undefined);

  useEffect(() => {
    if (network === undefined || url === undefined) {
      setStatus("off");

      return;
    }
    const chainId = network.chain.id;
    let source: EventSource | undefined;
    let lastEventId: string | undefined;
    let attempts = 0;
    let stopped = false;
    let pauseTimer: number | undefined;
    let retryTimer: number | undefined;
    let flushTimer: number | undefined;
    const stale = new Map<string, QueryKey>();

    const flush = () => {
      flushTimer = undefined;
      for (const queryKey of stale.values())
        void queryClient.invalidateQueries({ queryKey });
      stale.clear();
    };
    const invalidate = (keys: readonly QueryKey[]) => {
      for (const key of keys) stale.set(JSON.stringify(key), key);
      flushTimer ??= window.setTimeout(flush, BATCH_MS);
    };
    /**
     * The oldest block the page's canvas snapshots were read at, or undefined when one is unknown: still loading,
     * or read from the chain while the API was down.
     */
    const seenBlock = () => {
      let oldest: number | undefined;

      for (const [, snapshot] of queryClient.getQueriesData<CanvasSnapshot>({
        queryKey: queryKeys.canvases(chainId),
      })) {
        if (snapshot?.asOfBlock === undefined) return undefined;
        oldest = Math.min(oldest ?? snapshot.asOfBlock, snapshot.asOfBlock);
      }

      return oldest;
    };
    const armPause = () => {
      if (pauseTimer !== undefined) return;
      pauseTimer = window.setTimeout(() => {
        pauseTimer = undefined;
        setStatus("polling");
      }, PAUSE_AFTER_MS);
    };
    const handle = (type: string) => (message: MessageEvent<string>) => {
      const event = parseStreamEvent(type, message.data, message.lastEventId);

      if (event === undefined) return;
      if (event.type === "feed") lastEventId = event.id;
      if (event.type === "ready") {
        window.clearTimeout(pauseTimer);
        pauseTimer = undefined;
        attempts = 0;
        setStatus("streaming");
      }
      invalidate(keysForStreamEvent(chainId, event, seenBlock()));
    };

    const connect = () => {
      if (stopped) return;
      setStatus(status === "polling" ? "polling" : "connecting");
      armPause();
      // A new EventSource cannot set Last-Event-ID itself, so the resume point goes in the query.
      source = new EventSource(
        lastEventId === undefined
          ? url
          : `${url}&lastEventId=${encodeURIComponent(lastEventId)}`,
      );
      for (const type of ["ready", "feed", "layout", "reset"])
        source.addEventListener(type, handle(type) as EventListener);
      source.onerror = () => {
        armPause();
        // CONNECTING means the browser retries by itself; CLOSED (an HTTP error) needs a new EventSource.
        if (source?.readyState !== EventSource.CLOSED) return;
        source.close();
        const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempts);

        attempts += 1;
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      stopped = true;
      source?.close();
      window.clearTimeout(pauseTimer);
      window.clearTimeout(retryTimer);
      window.clearTimeout(flushTimer);
      setStatus("off");
    };
  }, [network, url, queryClient]);
}
