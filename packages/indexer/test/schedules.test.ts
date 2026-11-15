// Scheduled payments (ADR 0015): the canvas wire, the activity feed, and the keeper's due list.

import type { DueScheduleRow } from "../lib/app.ts";
import type { CanvasRows, FeedRow } from "../lib/canvas.ts";

import { encodeFunctionData, getAddress } from "viem";
import { describe, expect, test } from "vitest";

import { canvasAccountAbi } from "../abis/index.ts";
import { assembleCanvas, toActivity, toWire } from "../lib/canvas.ts";
import { deriveNotifications } from "../lib/notifications.ts";
import { CHAIN_ID, createHarness } from "./api-harness.ts";

const ACCOUNT = "0x00000000000000000000000000000000000000a1";
const PAYEE = "0x00000000000000000000000000000000000000b2";
const TX = `0x${"22".repeat(32)}` as const;

const transfer = { scheduleId: 1n, kind: 0, recipient: PAYEE, invoiceId: null, amount: 5_000_000n, nextAt: 1_060n, interval: 60, remaining: 3, active: true } as const;
const payInvoice = { scheduleId: 2n, kind: 1, recipient: null, invoiceId: 9n, amount: 7_000_000n, nextAt: 1_120n, interval: 0, remaining: 1, active: true } as const;

function canvasRows(overrides: Partial<CanvasRows>): CanvasRows {
  return {
    wallet: ACCOUNT,
    address: ACCOUNT,
    account: { address: ACCOUNT, threshold: 1, approvalLimit: 0n, policyNonce: 1n, endpointPublic: false, route: [] },
    members: [],
    budgets: [],
    charges: [],
    ops: [],
    confirmedByWallet: new Set(),
    schedules: [],
    relationships: [],
    invoices: [],
    advances: new Map(),
    obligors: new Map(),
    pool: { address: ACCOUNT, idleCash: 0n, totalAssets: 0n, advanceRateBps: 8000, annualFeeBps: 0 },
    balances: { accountUsdc: 0n, accountVaultShares: 0n, walletPoolShares: 0n, walletUsdc: 0n, walletPoolAllowance: 0n },
    views: { vaultAssets: 0n, lpAssets: 0n, lpMaxWithdraw: 0n },
    feed: [],
    transfers: [],
    routed: [],
    now: 1_000,
    ...overrides,
  };
}

const feedRow = (name: string, logIndex: number, scheduleId: bigint): FeedRow => ({
  name,
  blockNumber: 10n,
  logIndex,
  transactionHash: TX,
  timestamp: 1_000n,
  relationshipId: null,
  invoiceId: null,
  opId: null,
  budgetId: null,
  scheduleId,
  actor: null,
});

describe("schedules on the canvas", () => {
  test("each kind carries only its own target, in id order, as base-unit strings", () => {
    const wire = toWire(assembleCanvas(canvasRows({ schedules: [payInvoice, transfer] }))) as { account: { schedules: unknown[] } };
    expect(wire.account.schedules).toEqual([
      { id: "1", kind: "transfer", recipient: PAYEE, amount: "5000000", nextAt: 1060, interval: 60, remaining: 3, active: true },
      { id: "2", kind: "payInvoice", invoiceId: "9", amount: "7000000", nextAt: 1120, interval: 0, remaining: 1, active: true },
    ]);
  });

  test("a createSchedule op is a gated call the canvas can show", () => {
    const data = encodeFunctionData({
      abi: canvasAccountAbi,
      functionName: "createSchedule",
      args: [0, PAYEE, 0n, 5_000_000n, 1_060n, 60, 3],
    });
    const op = { opId: 4n, data, amount: 15_000_000n, policyNonce: 1n, required: 2, confirmations: 1, executed: false };
    expect(assembleCanvas(canvasRows({ ops: [op] })).account.ops[0]?.call).toEqual({
      fn: "createSchedule",
      kind: "transfer",
      recipient: getAddress(PAYEE),
      amount: 5_000_000n,
      start: 1_060,
      interval: 60,
      runs: 3,
    });
  });

  test("schedule events read as activity", () => {
    const titles = toActivity([
      feedRow("ScheduleCreated", 1, 1n),
      feedRow("ScheduleRan", 2, 1n),
      feedRow("ScheduleCancelled", 3, 2n),
    ]).map((a) => a.title);
    expect(titles).toEqual(["Schedule #1 created", "Schedule #1 ran", "Schedule #2 cancelled"]);
  });
});

describe("scheduleRan notifications", () => {
  test("each run is news for the paying account, naming what it paid and to whom", () => {
    const feed = [feedRow("ScheduleRan", 1, 1n), feedRow("ScheduleRan", 2, 2n), feedRow("ScheduleRan", 3, 99n)];
    const notes = deriveNotifications(assembleCanvas(canvasRows({ schedules: [transfer, payInvoice], feed })));
    expect(notes.map(({ kind, title, detail, nodeId }) => ({ kind, title, detail, nodeId }))).toEqual([
      { kind: "scheduleRan", title: "Schedule #1 ran", detail: "5.00 zUSDC to 0x0000…00b2", nodeId: "schedule-1" },
      { kind: "scheduleRan", title: "Schedule #2 ran", detail: "7.00 zUSDC to invoice #9", nodeId: "schedule-2" },
    ]);
  });
});

describe("GET /v1/schedules/due", () => {
  const due: DueScheduleRow[] = [
    { account: ACCOUNT, ...payInvoice },
    { account: ACCOUNT, ...transfer },
    { account: ACCOUNT, ...transfer, scheduleId: 3n, nextAt: 5_000n },
    { account: ACCOUNT, ...transfer, scheduleId: 4n, active: false },
  ];

  test("lists active schedules due by `before`, earliest first, in wire form", async () => {
    const h = await createHarness({}, { schedules: due });
    const res = await h.request("GET", `/v1/schedules/due?chainId=${CHAIN_ID}&before=2000&limit=10`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      asOf: { block: 7, updatedAt: 1_700_000_000 },
      chainId: CHAIN_ID,
      before: 2000,
      schedules: [
        { account: ACCOUNT, id: "1", kind: "transfer", recipient: PAYEE, invoiceId: null, amount: "5000000", nextAt: 1060, interval: 60, remaining: 3 },
        { account: ACCOUNT, id: "2", kind: "payInvoice", recipient: null, invoiceId: "9", amount: "7000000", nextAt: 1120, interval: 0, remaining: 1 },
      ],
    });
  });

  test("defaults `before` to the indexed head's time and honours `limit`", async () => {
    const h = await createHarness({}, { schedules: due });
    const body = (await (await h.request("GET", "/v1/schedules/due?limit=2")).json()) as { before: number; schedules: { id: string }[] };
    expect(body.before).toBe(1_700_000_000);
    expect(body.schedules.map((s) => s.id)).toEqual(["1", "2"]);
  });

  test("refuses another chain and bad numbers", async () => {
    const h = await createHarness({}, { schedules: due });
    expect((await h.request("GET", "/v1/schedules/due?chainId=1")).status).toBe(404);
    expect((await h.request("GET", "/v1/schedules/due?before=-1")).status).toBe(400);
    expect((await h.request("GET", "/v1/schedules/due?limit=501")).status).toBe(400);
  });
});
