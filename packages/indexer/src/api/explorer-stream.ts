// GET /v1/explorer/stream: `event: block` with a BlockSummary for each newly indexed block. It shares the feed
// stream's LISTEN connection and slot caps (stream.ts); the block handler NOTIFYs with the explorer subject. A wake
// only prompts a read of ex_block after the stream's cursor, so a lost notice delays a block but never drops it.

import type { Context } from "hono";

import { asc, desc, gt } from "ponder";
import { db } from "ponder:api";
import schema from "ponder:schema";
import { streamSSE, type SSEMessage } from "hono/streaming";

import { toWire } from "../../lib/canvas.ts";
import { EXPLORER_SUBJECT } from "../../lib/feed-channel.ts";
import { ensureListener, reserveSlot, subscribe } from "./stream.ts";

const HEARTBEAT_MS = 15_000;
/** A write still pending after this long (a stalled client) ends the stream and frees its slot. */
const WRITE_TIMEOUT_MS = 10_000;
/** Most blocks sent per read, and the furthest back a Last-Event-ID resume replays. */
const BATCH = 100;

const headNumber = async (): Promise<bigint> => {
  const [row] = await db.select({ number: schema.exBlock.number }).from(schema.exBlock).orderBy(desc(schema.exBlock.number)).limit(1);
  return row?.number ?? -1n;
};

export async function streamExplorer(c: Context, client: string): Promise<Response> {
  const release = reserveSlot(client);
  const resume = /^\d{1,20}$/.exec((c.req.header("Last-Event-ID") ?? c.req.query("lastEventId") ?? "").trim())?.[0];
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
      const head = await headNumber();
      // A resume within the last BATCH blocks replays them; an id past the head or older starts at the head.
      const resumeAt = resume === undefined ? undefined : BigInt(resume);
      let cursor = resumeAt !== undefined && resumeAt <= head && head - resumeAt <= BigInt(BATCH) ? resumeAt : head;
      if (stream.aborted) return;

      let queue: Promise<void> = Promise.resolve();
      const drain = () => {
        queue = queue
          .then(async () => {
            if (stream.aborted) return;
            const b = schema.exBlock;
            const rows = await db.select().from(b).where(gt(b.number, cursor)).orderBy(asc(b.number)).limit(BATCH);
            for (const row of rows) {
              await send({
                id: row.number.toString(),
                event: "block",
                data: JSON.stringify(
                  toWire({ number: row.number, hash: row.hash, timestamp: Number(row.timestamp), txCount: row.txCount, gasUsed: row.gasUsed }),
                ),
              });
              cursor = row.number;
            }
            if (rows.length === BATCH) drain();
          })
          .catch((error: unknown) => {
            if (!stream.aborted) console.error("explorer stream", error);
          });
      };

      unsubscribe = subscribe([EXPLORER_SUBJECT], drain);
      heartbeat = setInterval(() => {
        queue = queue.then(() => send(": ping\n\n")).catch(() => undefined);
        drain();
      }, HEARTBEAT_MS);
      drain();
      await done;
    } finally {
      clearInterval(heartbeat);
      unsubscribe();
      release();
      stream.abort();
    }
  });
}
