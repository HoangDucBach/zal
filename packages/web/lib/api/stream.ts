// GET /v1/stream: what each Server-Sent Event means for the cached reads. Pure, so the mapping is
// tested without a browser; hooks/use-live-updates.ts owns the EventSource.

import type { QueryKey } from "@tanstack/react-query";

import { getAddress, type Address } from "viem";

import {
  streamFeedSchema,
  streamLayoutSchema,
  streamReadySchema,
  type StreamFeed,
} from "./wire";

import { queryKeys } from "@/lib/query/keys";

export type StreamEvent =
  /** The stream is live from `cursor` on. `asOfBlock` is the API's indexed head then, when it could read it. */
  | {
      readonly type: "ready";
      readonly cursor: string;
      readonly asOfBlock: number | undefined;
    }
  /** A contract event about the account, the pool or the vault, now indexed. */
  | { readonly type: "feed"; readonly id: string; readonly feed: StreamFeed }
  /** A member saved the account's layout. */
  | {
      readonly type: "layout";
      readonly account: Address;
      readonly revision: number;
    }
  /** The resume point was too far back: refetch everything. */
  | { readonly type: "reset" };

const json = (data: string): unknown => {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
};

/** One SSE message to a StreamEvent, or undefined for anything this client does not know. */
export function parseStreamEvent(
  type: string,
  data: string,
  id: string,
): StreamEvent | undefined {
  switch (type) {
    case "ready": {
      const body = streamReadySchema.safeParse(json(data));

      return body.success
        ? {
            type: "ready",
            cursor: body.data.cursor,
            asOfBlock: body.data.asOf?.block,
          }
        : { type: "ready", cursor: "", asOfBlock: undefined };
    }
    case "feed": {
      const feed = streamFeedSchema.safeParse(json(data));

      return feed.success ? { type: "feed", id, feed: feed.data } : undefined;
    }
    case "layout": {
      const layout = streamLayoutSchema.safeParse(json(data));

      return layout.success
        ? {
            type: "layout",
            account: getAddress(layout.data.account),
            revision: layout.data.revision,
          }
        : undefined;
    }
    case "reset":
      return { type: "reset" };
    default:
      return undefined;
  }
}

/**
 * The queries one event makes stale. A feed event can change any chain read the canvas shows (balances, the pool,
 * the counterparty's account), and invalidation refetches only the reads on screen, so it covers the chain. A
 * layout event changes only the canvas snapshot, which carries the layout.
 *
 * `ready` starts the stream at the API's head: an event indexed between the page's snapshot and `ready` is never
 * sent, so the page catches up unless `seenBlock`, the oldest block its snapshots were read at, is already there.
 */
export function keysForStreamEvent(
  chainId: number,
  event: StreamEvent,
  seenBlock?: number,
): readonly QueryKey[] {
  switch (event.type) {
    case "ready":
      return seenBlock !== undefined &&
        event.asOfBlock !== undefined &&
        seenBlock >= event.asOfBlock
        ? []
        : [queryKeys.chain(chainId)];
    case "feed":
    case "reset":
      return [queryKeys.chain(chainId)];
    case "layout":
      return [queryKeys.canvases(chainId)];
  }
}

/** How live updates reach this page: the API stream, or the chain polling fallback while it is down. */
export type LiveStatus = "off" | "connecting" | "streaming" | "polling";
