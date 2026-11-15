// The keeper against a fake chain and indexer: what it sends, what it skips, and how it recovers.

import type { DueSchedule, KeeperDeps } from "../lib/keeper.ts";

import { describe, expect, test } from "vitest";

import { createHttp } from "../lib/http.ts";
import { createDueFetcher } from "../lib/indexer.ts";
import { createKeeper, RunRejected } from "../lib/keeper.ts";

const ACCOUNT = "0x00000000000000000000000000000000000000a1";
const KEEPER = "0x00000000000000000000000000000000000000c3";
const HASH = `0x${"33".repeat(32)}` as const;

/** A chain where `runSchedule` behaves like the contract: due at `nextAt`, advanced by `interval`, refused when broke. */
function fakeWorld(schedules: { id: bigint; nextAt: number; interval: number; remaining: number }[]) {
  const state = { time: 1_000, wallMs: 1_000_000, broke: new Set<bigint>(), indexerDown: false, sendDelayMs: 0, revertOnSend: false };
  const sent: bigint[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const find = (id: bigint) => schedules.find((s) => s.id === id);
  const check = (id: bigint, time: number) => {
    const s = find(id);
    if (s === undefined || s.remaining === 0) throw new RunRejected("ScheduleNotActive");
    if (time < s.nextAt) throw new RunRejected("ScheduleNotDue");
    if (state.broke.has(id)) throw new RunRejected("ERC20InsufficientBalance");
  };
  const logs: Record<string, unknown>[] = [];
  const deps: KeeperDeps = {
    fetchDue: (before) =>
      state.indexerDown
        ? Promise.reject(new Error("GET /v1/schedules/due answered 503"))
        : Promise.resolve(
            schedules
              .filter((s) => s.remaining > 0 && s.nextAt <= before)
              .map((s): DueSchedule => ({ account: ACCOUNT, id: s.id, nextAt: s.nextAt })),
          ),
    chainTime: () => Promise.resolve(state.time),
    simulateRun: (s, time) => Promise.resolve().then(() => check(s.id, time)),
    sendRun: async (s) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, state.sendDelayMs));
      inFlight--;
      sent.push(s.id);
      if (state.revertOnSend) return { hash: HASH, success: false };
      try {
        check(s.id, state.time);
      } catch {
        return { hash: HASH, success: false };
      }
      const row = find(s.id)!;
      row.remaining--;
      row.nextAt += row.interval;
      return { hash: HASH, success: true };
    },
    now: () => state.wallMs,
    log: (e) => logs.push(e),
  };
  const keeper = createKeeper(deps, { backoffBaseMs: 10_000, backoffMaxMs: 40_000, historySize: 10 });
  return { keeper, state, sent, logs, maxInFlight: () => maxInFlight, schedules };
}

describe("the keeper", () => {
  test("runs each due schedule once, and leaves one that is not due", async () => {
    const w = fakeWorld([
      { id: 1n, nextAt: 900, interval: 600, remaining: 3 },
      { id: 2n, nextAt: 950, interval: 0, remaining: 1 },
      { id: 3n, nextAt: 2_000, interval: 60, remaining: 3 },
    ]);
    await w.keeper.tick();
    await w.keeper.tick();
    expect(w.sent).toEqual([1n, 2n]);
    expect(w.keeper.snapshot().counts).toMatchObject({ ran: 2, failed: 0 });
    w.state.time = 2_000;
    await w.keeper.tick();
    expect(w.sent).toEqual([1n, 2n, 1n, 3n]);
  });

  test("does not run again from a due row the indexer has not updated yet", async () => {
    const w = fakeWorld([{ id: 1n, nextAt: 900, interval: 60, remaining: 3 }]);
    const stale = { ...w.schedules[0]! };
    await w.keeper.tick();
    w.schedules.splice(0, 1, stale);
    await w.keeper.tick();
    expect(w.sent).toEqual([1n]);
    expect(w.keeper.snapshot().counts.failed).toBe(0);
  });

  test("skips a run the simulation refuses, and backs off exponentially until it succeeds", async () => {
    const w = fakeWorld([{ id: 1n, nextAt: 900, interval: 60, remaining: 3 }]);
    w.state.broke.add(1n);
    await w.keeper.tick();
    expect(w.sent).toEqual([]);
    expect(w.keeper.snapshot().failures[0]).toMatchObject({ reason: "ERC20InsufficientBalance", attempt: 1, retryAt: 1_010_000 });

    w.state.wallMs += 5_000;
    await w.keeper.tick();
    expect(w.keeper.snapshot().counts).toMatchObject({ failed: 1, backedOff: 1 });

    w.state.wallMs += 5_000;
    await w.keeper.tick();
    expect(w.keeper.snapshot().failures[0]).toMatchObject({ attempt: 2, retryAt: w.state.wallMs + 20_000 });

    w.state.broke.delete(1n);
    w.state.wallMs += 20_000;
    await w.keeper.tick();
    expect(w.sent).toEqual([1n]);
    expect(w.keeper.snapshot().counts).toMatchObject({ ran: 1, backingOff: 0 });
  });

  test("caps the backoff", async () => {
    const w = fakeWorld([{ id: 1n, nextAt: 900, interval: 60, remaining: 3 }]);
    w.state.broke.add(1n);
    for (let i = 0; i < 6; i++) {
      await w.keeper.tick();
      w.state.wallMs += 60_000;
    }
    const last = w.keeper.snapshot().failures[0]!;
    expect(last.attempt).toBe(6);
    expect(last.retryAt - last.at).toBe(40_000);
  });

  test("treats a run that the simulation allowed but the chain reverted as a failure", async () => {
    const w = fakeWorld([{ id: 1n, nextAt: 900, interval: 60, remaining: 3 }]);
    w.state.revertOnSend = true;
    await w.keeper.tick();
    expect(w.keeper.snapshot().failures[0]).toMatchObject({ reason: "reverted on-chain", hash: HASH });
  });

  test("never has two sends in flight, even when ticks overlap", async () => {
    const w = fakeWorld([
      { id: 1n, nextAt: 900, interval: 60, remaining: 3 },
      { id: 2n, nextAt: 900, interval: 60, remaining: 3 },
      { id: 3n, nextAt: 900, interval: 60, remaining: 3 },
    ]);
    w.state.sendDelayMs = 5;
    await Promise.all([w.keeper.tick(), w.keeper.tick(), w.keeper.tick()]);
    expect(w.maxInFlight()).toBe(1);
    expect(w.sent).toEqual([1n, 2n, 3n]);
    expect(w.keeper.snapshot().counts.ticks).toBe(1);
  });

  test("survives an indexer outage and runs once the indexer is back", async () => {
    const w = fakeWorld([{ id: 1n, nextAt: 900, interval: 60, remaining: 3 }]);
    w.state.indexerDown = true;
    await w.keeper.tick();
    expect(w.keeper.snapshot().lastTick).toMatchObject({ error: "GET /v1/schedules/due answered 503" });
    w.state.indexerDown = false;
    await w.keeper.tick();
    expect(w.sent).toEqual([1n]);
    expect(w.keeper.snapshot().counts).toMatchObject({ ticks: 2, tickErrors: 1, ran: 1 });
  });
});

describe("the indexer client", () => {
  test("asks for due schedules at the chain time and parses base-unit ids", async () => {
    const urls: string[] = [];
    const fetchFn = (url: string) => {
      urls.push(url);
      return Promise.resolve(
        Response.json({ asOf: {}, chainId: 31337, schedules: [{ account: ACCOUNT, id: "7", nextAt: 900, kind: "transfer" }] }),
      );
    };
    const due = await createDueFetcher("http://indexer:42069", 31337, 50, fetchFn as typeof fetch)(1_000);
    expect(urls).toEqual(["http://indexer:42069/v1/schedules/due?chainId=31337&before=1000&limit=50"]);
    expect(due).toEqual([{ account: ACCOUNT, id: 7n, nextAt: 900 }]);
  });

  test("refuses another chain's list and an error status", async () => {
    const answer = (body: unknown, status = 200) => (() => Promise.resolve(Response.json(body, { status }))) as typeof fetch;
    await expect(createDueFetcher("http://i", 31337, 50, answer({ chainId: 1, schedules: [] }))(1)).rejects.toThrow(/chain 1/);
    await expect(createDueFetcher("http://i", 31337, 50, answer({}, 503))(1)).rejects.toThrow(/503/);
  });
});

describe("health and status", () => {
  test("health is ok while ticks finish, answers CORS for the web, and status lists outcomes", async () => {
    const w = fakeWorld([{ id: 1n, nextAt: 900, interval: 60, remaining: 3 }]);
    await w.keeper.tick();
    const app = createHttp({
      keeper: w.keeper,
      address: KEEPER,
      gasBalance: () => Promise.resolve(10n ** 18n),
      tickMs: 10_000,
      webOrigins: ["http://localhost:3100"],
      now: () => w.state.wallMs,
    });
    const health = await app.request("/health", { headers: { Origin: "http://localhost:3100" } });
    expect(health.status).toBe(200);
    expect(health.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3100");
    expect(await health.json()).toMatchObject({ ok: true, keeper: KEEPER, gasBalanceWei: "1000000000000000000", counts: { ran: 1 } });
    const other = await app.request("/health", { headers: { Origin: "http://evil.example" } });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();

    expect(await (await app.request("/status")).json()).toMatchObject({ runs: [{ id: "1", hash: HASH }], failures: [] });

    w.state.wallMs += 10 * 60_000;
    expect((await app.request("/health")).status).toBe(503);
  });
});
