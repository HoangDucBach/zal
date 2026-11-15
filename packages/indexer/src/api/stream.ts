// GET /v1/stream: Server-Sent Events from the `feed` table. One Postgres connection LISTENs for the whole
// process and wakes the streams whose subjects changed; each stream then reads committed rows after its own
// cursor. A heartbeat both keeps proxies from closing the stream and re-reads, so a missed wake-up only delays.

import type { Context } from "hono";
import type { Address } from "viem";

import { streamSSE, type SSEMessage } from "hono/streaming";
import pg from "pg";

import {
  decodeNotice,
  FEED_CHANNEL,
  formatCursor,
  parseCursor,
  type FeedCursor,
  type FeedNotice,
} from "../../lib/feed-channel.ts";
import { ApiError } from "../../lib/errors.ts";
import { config } from "./config.ts";
import { readAsOf, readFeed, readLatestCursor } from "./read.ts";

const HEARTBEAT_MS = 15_000;
/**
 * Hono swallows write errors, and a write nobody reads (a stalled client, a response whose body was dropped) never
 * settles. A write still pending after this long ends the stream, and so frees its slot.
 */
const WRITE_TIMEOUT_MS = 10_000;
const MAX_STREAMS = 1_000;
const MAX_STREAMS_PER_CLIENT = 10;
const BATCH = 500;
/** A resume further back than this starts over with a `reset` event: the client refetches state instead. */
const MAX_REPLAY = 2_000;

type Wake = (notice: FeedNotice) => void;
const listeners = new Map<string, Set<Wake>>();
const perClient = new Map<string, number>();
let streams = 0;
let connecting: Promise<void> | undefined;

/** Connects the shared LISTEN client once, and again after it drops. Streams still heartbeat meanwhile. */
export function ensureListener(): Promise<void> {
  connecting ??= (async () => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    const reconnect = () => {
      connecting = undefined;
      client.removeAllListeners();
      client.end().catch(() => undefined);
      setTimeout(() => void ensureListener().catch(() => undefined), 1_000);
    };
    client.on("error", reconnect);
    client.on("end", reconnect);
    client.on("notification", (msg) => {
      const notice = msg.payload === undefined ? undefined : decodeNotice(msg.payload);
      if (notice === undefined) return;
      for (const wake of listeners.get(notice.subject) ?? []) wake(notice);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${FEED_CHANNEL}`);
    } catch (error) {
      client.removeAllListeners();
      client.end().catch(() => undefined);
      connecting = undefined;
      throw error;
    }
  })();
  return connecting;
}

export function subscribe(subjects: readonly string[], wake: Wake): () => void {
  for (const s of subjects) {
    const set = listeners.get(s) ?? new Set();
    set.add(wake);
    listeners.set(s, set);
  }
  return () => {
    for (const s of subjects) {
      const set = listeners.get(s);
      set?.delete(wake);
      if (set?.size === 0) listeners.delete(s);
    }
  };
}

/** Takes a stream slot now, before any await, so a burst cannot overshoot the caps. Returns its release. */
export function reserveSlot(client: string): () => void {
  const held = perClient.get(client) ?? 0;
  if (streams >= MAX_STREAMS) throw new ApiError("unavailable", "Too many open streams");
  if (held >= MAX_STREAMS_PER_CLIENT) throw new ApiError("rate_limited", "Too many open streams from this client");
  streams += 1;
  perClient.set(client, held + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    streams -= 1;
    const left = (perClient.get(client) ?? 1) - 1;
    if (left === 0) perClient.delete(client);
    else perClient.set(client, left);
  };
}

/** Rows after `cursor`, never ending inside one log's group of subjects, so no event goes out half-filled. */
async function nextBatch(subjects: readonly Address[], cursor: FeedCursor) {
  const rows = await readFeed(subjects, cursor, BATCH);
  if (rows.length < BATCH) return { rows, more: false };
  const last = rows.at(-1);
  const complete = last === undefined ? rows : rows.filter((r) => formatCursor(r) !== formatCursor(last));
  return { rows: complete.length === 0 ? rows : complete, more: true };
}

export async function streamFeed(c: Context, account: Address, client: string): Promise<Response> {
  const release = reserveSlot(client);
  // The account, plus the pool and vault, whose changes every canvas shows.
  const subjects = [account, config.addresses.pool, config.addresses.vault];
  const resumeFrom = parseCursor(c.req.header("Last-Event-ID") ?? c.req.query("lastEventId"));
  try {
    await ensureListener();
  } catch (error) {
    release();
    throw error;
  }

  return streamSSE(c, async (stream) => {
    let closed!: () => void;
    const done = new Promise<void>((resolve) => (closed = resolve));
    stream.onAbort(closed);
    if (c.req.raw.signal.aborted) closed();
    const send = (message: SSEMessage | string): Promise<void> => {
      const timer = setTimeout(closed, WRITE_TIMEOUT_MS);
      const write = typeof message === "string" ? stream.write(message) : stream.writeSSE(message);
      return Promise.race([write, done]).then(() => clearTimeout(timer));
    };
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe = () => undefined as void;

    try {
      const latest: FeedCursor = await readLatestCursor(subjects);
      let cursor = latest;
      let reset = false;
      if (resumeFrom !== undefined) {
        // An id past the head was issued before the chain or the index was reset; rows after it may never come.
        const ahead =
          resumeFrom.blockNumber > latest.blockNumber ||
          (resumeFrom.blockNumber === latest.blockNumber && resumeFrom.logIndex > latest.logIndex);
        reset = ahead || (await readFeed(subjects, resumeFrom, MAX_REPLAY + 1)).length > MAX_REPLAY;
        if (!reset) cursor = resumeFrom;
      }
      const asOf = await readAsOf().catch(() => undefined);
      if (stream.aborted) return;

      // Writes run one at a time, in order. A failed read is logged and retried by the next wake or heartbeat.
      let queue: Promise<void> = Promise.resolve();
      const enqueue = (work: () => Promise<void>) => {
        queue = queue.then(work).catch((error: unknown) => {
          if (!stream.aborted) console.error("stream", account, error);
        });
      };
      const drain = () =>
        enqueue(async () => {
          if (stream.aborted) return;
          const { rows, more } = await nextBatch(subjects, cursor);
          const groups = new Map<string, typeof rows>();
          for (const row of rows) {
            const id = formatCursor(row);
            groups.set(id, [...(groups.get(id) ?? []), row]);
          }
          for (const [id, group] of groups) {
            const head = group[0];
            if (head === undefined) continue;
            await send({
              id,
              event: "feed",
              data: JSON.stringify({
                subjects: group.map((r) => r.subject),
                name: head.name,
                key: `${head.transactionHash}:${head.logIndex}`,
                blockNumber: head.blockNumber.toString(),
                logIndex: head.logIndex,
                transactionHash: head.transactionHash,
                timestamp: Number(head.timestamp),
                relationshipId: head.relationshipId?.toString() ?? null,
                invoiceId: head.invoiceId?.toString() ?? null,
                opId: head.opId?.toString() ?? null,
                budgetId: head.budgetId?.toString() ?? null,
                scheduleId: head.scheduleId?.toString() ?? null,
              }),
            });
            cursor = head;
          }
          if (more) drain();
        });

      if (reset) enqueue(() => send({ event: "reset", data: JSON.stringify({ cursor: formatCursor(cursor), asOf }) }));
      enqueue(() => send({ event: "ready", data: JSON.stringify({ cursor: formatCursor(cursor), asOf }) }));
      unsubscribe = subscribe(subjects, (notice) => {
        if (notice.kind !== "layout") {
          drain();
          return;
        }
        enqueue(() => send({ event: "layout", data: JSON.stringify({ account: notice.subject, revision: notice.revision }) }));
      });
      heartbeat = setInterval(() => {
        enqueue(() => send(": ping\n\n"));
        drain();
      }, HEARTBEAT_MS);
      drain();
      await done;
    } finally {
      clearInterval(heartbeat);
      unsubscribe();
      release();
      // Cancels the response body, so writes still pending settle instead of holding the stream.
      stream.abort();
    }
  });
}
