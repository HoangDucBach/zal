// GET /v1/stream end to end. The real src/api/stream.ts and lib/app.ts run behind a real @hono/node-server
// socket. Only the modules that need Ponder's runtime are replaced: config (env), read.ts (an in-memory `feed`
// table with the same ordering, filter and limit as the real queries) and the pg LISTEN client.
import { EventEmitter } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const ACCOUNT = "0x00000000000000000000000000000000000acc01";
const POOL = "0x0000000000000000000000000000000000000b00";

interface Row {
  subject: string;
  blockNumber: bigint;
  logIndex: number;
  name: string;
  transactionHash: string;
  timestamp: bigint;
  relationshipId: null;
  invoiceId: null;
  opId: null;
  budgetId: null;
}
const state = vi.hoisted(() => ({ feed: [] as unknown[], pgClients: [] as unknown[] }));
const feed = state.feed as Row[];

vi.mock("../src/api/config.ts", () => ({
  config: {
    databaseUrl: "postgres://unused",
    addresses: { pool: "0x0000000000000000000000000000000000000b00", vault: "0x0000000000000000000000000000000000000c00" },
  },
}));
vi.mock("../src/api/read.ts", () => {
  const after = (r: Row, c?: { blockNumber: bigint; logIndex: number }) =>
    c === undefined || r.blockNumber > c.blockNumber || (r.blockNumber === c.blockNumber && r.logIndex > c.logIndex);
  const sorted = (subjects: readonly string[]) =>
    (state.feed as Row[])
      .filter((r) => subjects.map((s) => s.toLowerCase()).includes(r.subject))
      .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  return {
    readAsOf: () => Promise.resolve({ block: 7, updatedAt: 1_700_000_000 }),
    readFeed: (subjects: readonly string[], cursor?: { blockNumber: bigint; logIndex: number }, limit = 1000) =>
      Promise.resolve(sorted(subjects).filter((r) => after(r, cursor)).slice(0, limit)),
    readLatestCursor: (subjects: readonly string[]) => {
      const last = sorted(subjects).at(-1);
      return Promise.resolve(last ?? { blockNumber: 0n, logIndex: -1 });
    },
  };
});
vi.mock("pg", async () => {
  const { EventEmitter: EE } = await import("node:events");
  class Client extends EE {
    constructor() {
      super();
      state.pgClients.push(this);
    }
    connect = () => Promise.resolve();
    query = () => Promise.resolve({ rows: [] });
    end = () => Promise.resolve();
  }
  return { default: { Client } };
});

const { createHarness } = await import("./api-harness.ts");
const { createApp } = await import("../lib/app.ts");
const { streamFeed } = await import("../src/api/stream.ts");

let server: ReturnType<typeof serve>;
let port: number;
let ip = 0;
let currentIp = "10.0.0.0";

beforeAll(async () => {
  const h = await createHarness();
  // Same wiring as src/api/index.ts, with the per-test client address standing in for the socket's.
  const app = createApp({
    config: { chainId: 31337, webOrigins: ["http://localhost:3100"], registry: POOL, sessionTtlSeconds: 3600, nonceTtlSeconds: 600 },
    appDb: h.db,
    asOf: () => Promise.resolve({ block: 7, updatedAt: 1_700_000_000 }),
    canvasRows: () => Promise.reject(new Error("not used")),
    feedPage: () => Promise.resolve([]),
    walletAccounts: () => Promise.resolve([]),
    dueSchedules: () => Promise.resolve([]),
    pool: () => Promise.resolve({}),
    lp: () => Promise.resolve({}),
    roleOf: () => Promise.resolve(0),
    inviteNonceUsed: () => Promise.resolve(false),
    verifyMessage: () => Promise.resolve(false),
    stream: streamFeed,
    clientIp: () => currentIp,
  });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
      port = info.port;
      resolve();
    });
  });
});
afterAll(() => server.close());
beforeEach(() => {
  feed.length = 0;
  currentIp = `10.0.0.${++ip}`;
});

const row = (blockNumber: number, logIndex: number, subject = ACCOUNT): Row => ({
  subject,
  blockNumber: BigInt(blockNumber),
  logIndex,
  name: "Evt",
  transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
  timestamp: 1n,
  relationshipId: null,
  invoiceId: null,
  opId: null,
  budgetId: null,
});
const notify = (notice: object) =>
  (state.pgClients.at(-1) as EventEmitter).emit("notification", { payload: JSON.stringify(notice) });

/** Opens a request and collects SSE events until `until` is true or `ms` passes. */
function open(method: "GET" | "HEAD", headers: Record<string, string> = {}, until: (events: Evt[]) => boolean = (e) => e.length > 0, ms = 1500) {
  type R = { status: number; events: Evt[]; close: () => void };
  return new Promise<R>((resolve, reject) => {
    const events: Evt[] = [];
    const req = http.request({ host: "127.0.0.1", port, path: `/v1/stream?account=${ACCOUNT}`, method, headers }, (res) => {
      let buf = "";
      const finish = () => resolve({ status: res.statusCode ?? 0, events, close: () => req.destroy() });
      const timer = setTimeout(finish, ms);
      if (res.statusCode !== 200 || method === "HEAD") {
        clearTimeout(timer);
        res.resume();
        finish();
        return;
      }
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let cut: number;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const get = (k: string) => block.split("\n").find((l) => l.startsWith(`${k}:`))?.slice(k.length + 1).trim();
          const event = get("event");
          if (event !== undefined) events.push({ event, id: get("id"), data: JSON.parse(get("data") ?? "null") as never });
        }
        if (until(events)) {
          clearTimeout(timer);
          finish();
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}
interface Evt {
  event: string;
  id: string | undefined;
  data: { cursor?: string };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("stream slots", () => {
  test("control: ten GET streams that disconnect give their slots back", async () => {
    for (let i = 0; i < 10; i++) (await open("GET")).close();
    await sleep(200);
    const next = await open("GET");
    next.close();
    expect(next.status).toBe(200);
  });

  test("S1 ten HEAD requests do not use up a client's stream slots", async () => {
    const heads: number[] = [];
    for (let i = 0; i < 10; i++) heads.push((await open("HEAD")).status);
    // Past one 15 s heartbeat, which is what is meant to end a stream whose abort was missed.
    await sleep(17_000);
    const next = await open("GET");
    next.close();
    expect({ heads, getAfterwards: next.status }).toEqual({ heads: Array(10).fill(200), getAfterwards: 200 });
  }, 30_000);
});

describe("resume", () => {
  test("control: a resume replays exactly the events after Last-Event-ID, in order, across batches", async () => {
    for (let b = 1; b <= 700; b++) feed.push(row(b, 0), row(b, 0, POOL), row(b, 1));
    const s = await open("GET", { "Last-Event-ID": "100-0" }, (e) => e.filter((x) => x.event === "feed").length >= 1201, 5000);
    s.close();
    const ids = s.events.filter((e) => e.event === "feed").map((e) => e.id);
    const expected = ["100-1", ...Array.from({ length: 600 }, (_, i) => [`${i + 101}-0`, `${i + 101}-1`]).flat()];
    expect(ids).toEqual(expected);
  });

  test("S2 a Last-Event-ID ahead of the indexed head (the chain or index was reset) gets a reset, and later events still arrive", async () => {
    feed.push(row(5, 0));
    const s = await open("GET", { "Last-Event-ID": "900-3" }, (e) => e.some((x) => x.event === "ready"));
    feed.push(row(6, 0));
    notify({ kind: "feed", subject: ACCOUNT, cursor: "6-0" });
    await sleep(300);
    s.close();
    expect({
      first: s.events.map((e) => `${e.event}:${e.data.cursor ?? e.id ?? ""}`),
    }).toEqual({ first: ["reset:5-0", "ready:5-0", "feed:6-0"] });
  });
});

describe("global stream cap", () => {
  // Last: should HEAD leak slots again, they would stay taken for the life of the process.
  test("S3 HEAD requests from 100 addresses do not shut every other client out of the stream", async () => {
    for (let i = 0; i < 1000; i++) {
      currentIp = `10.1.${Math.floor(i / 10)}.1`;
      await open("HEAD");
    }
    await sleep(300);
    currentIp = "192.0.2.77";
    const victim = await open("GET");
    victim.close();
    expect(victim.status).toBe(200);
  }, 60_000);
});
