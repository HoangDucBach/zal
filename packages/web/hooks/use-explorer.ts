"use client";

// Explorer reads (docs/plans/explorer.md): the /v1/explorer API through TanStack Query, the block stream over SSE,
// and the native balance from the live L1's RPC. Public: none of these needs a wallet.

import type { Address } from "viem";
import type { BlockSummary, ChartRange, Page } from "@/lib/api/explorer-wire";
import type { QueryResult } from "@/lib/query/types";

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useBalance } from "wagmi";

import { liveNetwork } from "@/config/chains";
import { apiUrl } from "@/lib/api/client";
import {
  explorerApi,
  explorerStreamUrl,
  parseBlockEvent,
} from "@/lib/api/explorer";
import { toAppError, type AppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";

/** Rows in each home panel. */
export const LATEST = 10;
/** Rows in each detail table page. */
export const PAGE_SIZE = 25;

const K = queryKeys.explorer;
const LIVE = queryKeys.explorerLive;

/** True when this build has an API to read; the explorer has no chain fallback. */
export const explorerEnabled = apiUrl !== undefined;

function useExplorerQuery<T>(
  queryKey: QueryKey,
  read: (signal: AbortSignal) => Promise<T>,
  { enabled = true, keepPrevious = false } = {},
): QueryResult<T> {
  return useQuery<T, AppError>({
    queryKey,
    enabled: explorerEnabled && enabled,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    // A 404 is an answer, not a blip: do not retry it.
    retry: (count, error) =>
      error.kind === "api" && error.status !== 404 && count < 1,
    queryFn: async ({ signal }) => {
      try {
        return await read(signal);
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
}

export const useExplorerStats = () =>
  useExplorerQuery([...LIVE, "stats"], (s) => explorerApi.stats(s));

export const useLatestBlocks = () =>
  useExplorerQuery([...LIVE, "blocks"], (s) =>
    explorerApi.blocks({ limit: LATEST }, s),
  );

export const useLatestTxs = () =>
  useExplorerQuery([...LIVE, "txs"], (s) =>
    explorerApi.txs({ limit: LATEST }, s),
  );

export const useExplorerCharts = (range: ChartRange) =>
  useExplorerQuery(
    [...K, "charts", range],
    (s) => explorerApi.charts(range, s),
    { keepPrevious: true },
  );

export const useExplorerBlock = (id: string) =>
  useExplorerQuery([...K, "block", id.toLowerCase()], (s) =>
    explorerApi.block(id, s),
  );

/** A block's txs after its first page: `before` is the block's `txsNext`, then each page's `next`. */
export const useBlockTxsPage = (block: number, before: string | undefined) =>
  useExplorerQuery(
    [...K, "blockTxs", block, before ?? "first"],
    (s) => explorerApi.txs({ block, before, limit: PAGE_SIZE }, s),
    { enabled: before !== undefined, keepPrevious: true },
  );

export const useExplorerTx = (hash: string) =>
  useExplorerQuery([...K, "tx", hash.toLowerCase()], (s) =>
    explorerApi.tx(hash, s),
  );

export const useExplorerAddress = (address: Address) =>
  useExplorerQuery([...K, "address", address.toLowerCase()], (s) =>
    explorerApi.address(address, s),
  );

export const useExplorerToken = (address: Address) =>
  useExplorerQuery([...K, "token", address.toLowerCase()], (s) =>
    explorerApi.token(address, s),
  );

export const useExplorerSearch = (q: string | undefined) =>
  useExplorerQuery(
    [...K, "search", q ?? ""],
    (s) => explorerApi.search(q ?? "", s),
    { enabled: q !== undefined && q !== "" },
  );

/** Lists that page with `?before=`. */
export type PagedList =
  | "addressTxs"
  | "addressTransfers"
  | "addressNfts"
  | "tokenHolders"
  | "tokenTransfers";

type PageItem<L extends PagedList> = Awaited<
  ReturnType<(typeof explorerApi)[L]>
>["items"][number];

/** One page of `list` for `owner`, at `before` (undefined for the first page). */
export function useExplorerPage<L extends PagedList>(
  list: L,
  owner: Address,
  before: string | undefined,
  enabled = true,
): QueryResult<Page<PageItem<L>>> {
  return useExplorerQuery(
    [...K, list, owner.toLowerCase(), before ?? "first"],
    (s) =>
      (
        explorerApi[list] as (
          a: Address,
          p: { before?: string; limit?: number },
          signal?: AbortSignal,
        ) => Promise<Page<PageItem<L>>>
      )(owner, { before, limit: PAGE_SIZE }, s),
    { enabled, keepPrevious: true },
  );
}

/**
 * Cursor pages as a stack: `before` is the cursor of the page on screen, `next(cursor)` moves on, `prev()` goes
 * back. The API pages only forwards, so the stack remembers the way back.
 */
export function useCursorStack() {
  const [stack, setStack] = useState<readonly string[]>([]);

  return {
    page: stack.length + 1,
    before: stack.at(-1),
    next: (cursor: string) => setStack((s) => [...s, cursor]),
    prev: () => setStack((s) => s.slice(0, -1)),
  };
}

/** The native gas token `holder` holds on the live L1, from its RPC (the API does not serve it). Off without one. */
export function useExplorerNativeBalance(holder: Address) {
  const chainId =
    liveNetwork.status === "ready" ? liveNetwork.chain.id : undefined;

  return useBalance({
    address: holder,
    chainId: chainId as never,
    query: { enabled: chainId !== undefined },
  });
}

export type StreamStatus = "off" | "connecting" | "live";

/** How long a burst of blocks waits before the home reads refetch together. */
const REFRESH_MS = 1_000;

/**
 * Keeps the home page live: each `block` event goes to the top of Latest blocks at once, then stats and Latest
 * txs refetch. EventSource reconnects by itself; a closed stream retries with backoff.
 */
export function useExplorerStream(): StreamStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>("off");

  useEffect(() => {
    const url = explorerStreamUrl();

    if (url === undefined) return;
    let source: EventSource | undefined;
    let retry: number | undefined;
    let refresh: number | undefined;
    let attempts = 0;
    let stopped = false;

    const onBlock = (message: MessageEvent<string>) => {
      const block = parseBlockEvent(message.data);

      if (block === undefined) return;
      queryClient.setQueryData<Page<BlockSummary>>(
        [...LIVE, "blocks"],
        (page) =>
          page === undefined
            ? page
            : {
                ...page,
                items: [
                  block,
                  ...page.items.filter((b) => b.number !== block.number),
                ].slice(0, LATEST),
              },
      );
      refresh ??= window.setTimeout(() => {
        refresh = undefined;
        void queryClient.invalidateQueries({ queryKey: [...LIVE, "stats"] });
        void queryClient.invalidateQueries({ queryKey: [...LIVE, "txs"] });
      }, REFRESH_MS);
    };

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      source = new EventSource(url);
      source.onopen = () => {
        attempts = 0;
        setStatus("live");
      };
      source.addEventListener("block", onBlock as EventListener);
      source.onerror = () => {
        if (source?.readyState !== EventSource.CLOSED) {
          setStatus("connecting");

          return;
        }
        source.close();
        setStatus("off");
        retry = window.setTimeout(
          connect,
          Math.min(30_000, 1_000 * 2 ** attempts),
        );
        attempts += 1;
      };
    };

    connect();

    return () => {
      stopped = true;
      source?.close();
      window.clearTimeout(retry);
      window.clearTimeout(refresh);
    };
  }, [queryClient]);

  return status;
}
