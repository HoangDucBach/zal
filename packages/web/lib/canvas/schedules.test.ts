import type { PendingOp, Schedule } from "./types";

import { describe, expect, test } from "vitest";

import { buildCanvasGraph, nodeId } from "./graph";
import {
  committed,
  durationText,
  isDue,
  scheduleTerms,
  scheduleViews,
} from "./schedules";
import { CLUB, ME, VAULT, account, rel, state } from "./test-fixtures";

import { chainClock } from "@/hooks/use-schedules";

const transfer = (over: Partial<Schedule> = {}): Schedule => ({
  id: 1n,
  kind: "transfer",
  recipient: CLUB,
  amount: 100n,
  nextAt: 1_000,
  interval: 60,
  remaining: 3,
  active: true,
  ...over,
});

const createOp = (over: Partial<PendingOp> = {}): PendingOp => ({
  opId: 5n,
  call: {
    fn: "createSchedule",
    kind: "transfer",
    recipient: CLUB,
    amount: 100n,
    start: 2_000,
    interval: 3_600,
    runs: 4,
  },
  amount: 400n,
  confirmations: 1,
  required: 2,
  executed: false,
  stale: false,
  confirmedByMe: true,
  ...over,
});

describe("scheduleTerms: the chain's timing rules before the wallet prompt (ZR-SCH-02)", () => {
  const base = {
    kind: "transfer" as const,
    recipient: CLUB,
    amount: 100n,
    interval: 60,
    runs: 3,
    startIn: 60,
  };

  test("a recurring transfer prices the op at amount × runs", () => {
    expect(scheduleTerms(base, 1_000)).toEqual({
      ok: true,
      call: {
        fn: "createSchedule",
        kind: "transfer",
        recipient: CLUB,
        amount: 100n,
        start: 1_060,
        interval: 60,
        runs: 3,
      },
      policyAmount: 300n,
    });
  });

  test("a single run is sent with interval 0, as the contract's `once` needs", () => {
    const terms = scheduleTerms({ ...base, runs: 1, interval: 5 }, 0);

    expect(terms.ok && terms.call.interval).toBe(0);
  });

  test.each([
    [{ startIn: 59 }, "Start ≥ 1 min from now"],
    [{ interval: 59 }, "Every ≥ 1 min"],
    [{ runs: 0 }, "Runs 1–1,000"],
    [{ runs: 1_001 }, "Runs 1–1,000"],
    [{ amount: 0n }, "Amount > 0"],
  ])("%o is refused: %s", (over, reason) => {
    expect(scheduleTerms({ ...base, ...over }, 0)).toEqual({
      ok: false,
      reason,
    });
  });

  test("a pay-at schedule runs once for the face value", () => {
    expect(
      scheduleTerms(
        { kind: "payInvoice", invoiceId: 9n, faceValue: 500n, startIn: 120 },
        10,
      ),
    ).toMatchObject({
      ok: true,
      call: { kind: "payInvoice", invoiceId: 9n, start: 130, runs: 1 },
      policyAmount: 500n,
    });
  });
});

describe("scheduleViews: on-chain schedules and pending ops", () => {
  test("status comes from the chain: active, ended after the last run, cancelled with runs left", () => {
    const views = scheduleViews(
      account({
        schedules: [
          transfer(),
          transfer({ id: 2n, active: false, remaining: 0 }),
          transfer({ id: 3n, active: false, remaining: 2 }),
        ],
      }),
    );

    expect(views.map((v) => [v.nodeId, v.status])).toEqual([
      ["schedule-1", "active"],
      ["schedule-2", "ended"],
      ["schedule-3", "cancelled"],
    ]);
    expect(views.map(committed)).toEqual([300n, 0n, 0n]);
  });

  test("a createSchedule op waiting for signatures is a pending view; executed or stale ops are not", () => {
    const views = scheduleViews(
      account({
        ops: [
          createOp(),
          createOp({ opId: 6n, executed: true }),
          createOp({ opId: 7n, stale: true }),
        ],
      }),
    );

    expect(views).toEqual([
      expect.objectContaining({
        nodeId: "schedule-op-5",
        status: "pending",
        nextAt: 2_000,
        remaining: 4,
        amount: 100n,
      }),
    ]);
  });

  test("due once the clock reaches nextAt, and only while active", () => {
    const [view] = scheduleViews(account({ schedules: [transfer()] }));

    expect(view !== undefined && isDue(view, 999)).toBe(false);
    expect(view !== undefined && isDue(view, 1_000)).toBe(true);
  });

  test("durations read in the largest whole unit", () => {
    expect([60, 3_600, 86_400, 90].map(durationText)).toEqual([
      "1 min",
      "1 h",
      "1 d",
      "90 s",
    ]);
  });
});

describe("schedules on the canvas", () => {
  test("a transfer to a counterparty sits on its row with a money edge; a pending one is a ghost", () => {
    const s = state({
      relationships: [
        rel({ id: 1n, buyer: CLUB, seller: ME, status: "active" }),
      ],
      account: account({ schedules: [transfer()], ops: [createOp()] }),
    });
    const graph = buildCanvasGraph(s, { vault: VAULT });
    const node = (id: string) => graph.nodes.find((n) => n.id === id);

    expect(node(nodeId.schedule(1n))?.data.commitment).toBe("solid");
    expect(node(nodeId.pendingSchedule(5n))?.data.commitment).toBe("ghost");
    expect(node(nodeId.schedule(1n))?.position.y).toBe(
      node(nodeId.counterparty(1n))?.position.y,
    );
    expect(
      graph.edges.find((e) => e.source === nodeId.schedule(1n)),
    ).toMatchObject({
      target: nodeId.counterparty(1n),
      label: "every 1 min",
      flow: "money",
      ghost: false,
    });
  });

  test("a transfer to an address with no node here hangs off the Account", () => {
    const s = state({ account: account({ schedules: [transfer()] }) });
    const graph = buildCanvasGraph(s, { vault: VAULT });

    expect(
      graph.edges.find((e) => e.target === nodeId.schedule(1n))?.source,
    ).toBe(nodeId.account);
  });
});

describe("chainClock", () => {
  test("adds the time since the read, and never runs behind the wall clock", () => {
    expect(chainClock(5_000, 1_000_000, 1_010_000)).toBe(5_010);
    expect(chainClock(100, 1_000_000, 1_010_000)).toBe(1_010);
  });
});
