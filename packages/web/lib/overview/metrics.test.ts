import type { CashMove } from "@/lib/canvas/types";

import { describe, expect, test } from "vitest";

import {
  balanceSeries,
  dailyBalance,
  invoicesByStatus,
  obligorCredit,
  poolUse,
  routedByLeg,
  upcomingDue,
  weeklyFlows,
} from "./metrics";

import {
  CLUB,
  VAULT,
  account,
  invoice,
  state,
} from "@/lib/canvas/test-fixtures";

const DAY = 86_400;
const USDC = 1_000_000n;

const move = (timestamp: number, amount: bigint): CashMove => ({
  key: `${timestamp}:${amount}`,
  timestamp,
  blockNumber: BigInt(timestamp),
  amount,
  counterparty: CLUB,
});

describe("balance over time", () => {
  test("walks back from the chain balance and ends on it at chain time", () => {
    const s = state({
      now: 30 * DAY,
      account: account({ balance: 7_000n * USDC }),
      cash: [
        move(1 * DAY, 10_000n * USDC),
        move(10 * DAY, -5_000n * USDC),
        move(20 * DAY, 2_000n * USDC),
      ],
    });

    expect(
      balanceSeries(s).map((p) => [p.timestamp / DAY, p.balance / USDC]),
    ).toEqual([
      [1, 0n],
      [1, 10_000n],
      [10, 5_000n],
      [20, 7_000n],
      [30, 7_000n],
    ]);
  });

  test("moves in one block count once, at the balance after the last of them", () => {
    const s = state({
      now: 5 * DAY,
      account: account({ balance: 4_000n * USDC }),
      cash: [move(DAY, 5_000n * USDC), move(DAY, -1_000n * USDC)],
    });

    expect(balanceSeries(s).map((p) => p.balance / USDC)).toEqual([
      0n,
      4_000n,
      4_000n,
    ]);
  });

  test("an account with no movement is one point at its balance", () => {
    const s = state({ now: 9, account: account({ balance: 3n }) });

    expect(balanceSeries(s)).toEqual([{ timestamp: 9, balance: 3n }]);
  });
});

describe("daily balance", () => {
  test("starts at the first movement, then one point a day at the time of day of chain time", () => {
    const s = state({
      now: 10 * DAY,
      account: account({ balance: 7_000n * USDC }),
      cash: [
        move(7 * DAY + 600, 10_000n * USDC),
        move(7 * DAY + 660, -5_000n * USDC),
        move(9 * DAY + 3_600, 2_000n * USDC),
      ],
    });

    expect(
      dailyBalance(s).map((p) => [p.timestamp - 7 * DAY, p.balance / USDC]),
    ).toEqual([
      [600, 10_000n],
      [DAY, 5_000n],
      [2 * DAY, 5_000n],
      [3 * DAY, 7_000n],
    ]);
  });

  test("an account funded moments ago spans from that movement to now", () => {
    const s = state({
      now: 20 * DAY,
      account: account({ balance: 10_000n * USDC }),
      cash: [move(20 * DAY - 30, 10_000n * USDC)],
    });

    expect(dailyBalance(s)).toEqual([
      { timestamp: 20 * DAY - 30, balance: 10_000n * USDC },
      { timestamp: 20 * DAY, balance: 10_000n * USDC },
    ]);
  });

  test("an account with no movement holds its balance over the last week", () => {
    const s = state({ now: 10 * DAY, account: account({ balance: 3n }) });

    expect(dailyBalance(s).map((p) => [p.timestamp / DAY, p.balance])).toEqual([
      [3, 3n],
      [4, 3n],
      [5, 3n],
      [6, 3n],
      [7, 3n],
      [8, 3n],
      [9, 3n],
      [10, 3n],
    ]);
  });

  test("a movement in the block of chain time still draws a line: itself and now", () => {
    const s = state({
      now: 4 * DAY,
      account: account({ balance: 5n }),
      cash: [move(4 * DAY, 5n)],
    });

    expect(dailyBalance(s)).toEqual([
      { timestamp: 4 * DAY, balance: 5n },
      { timestamp: 4 * DAY, balance: 5n },
    ]);
  });
});

test("weekly flows split in and out, oldest week first", () => {
  const now = 28 * DAY;
  const s = state({
    now,
    cash: [
      move(2 * DAY, 9n),
      move(27 * DAY, 4n),
      move(27 * DAY, -3n),
      move(26 * DAY, -1n),
    ],
  });
  const weeks = weeklyFlows(s, 4);

  expect(weeks.map((w) => [w.incoming, w.outgoing])).toEqual([
    [9n, 0n],
    [0n, 0n],
    [0n, 0n],
    [4n, 4n],
  ]);
  expect(weeks.at(-1)?.start).toBe(now - 7 * DAY);
});

test("routed totals add up per leg and take their kind from the current route", () => {
  const s = state({
    account: account({
      route: [
        { kind: "hold", target: VAULT, bps: 9000 },
        { kind: "vault", target: VAULT, bps: 1000 },
      ],
    }),
    routed: [
      {
        key: "a",
        timestamp: 1,
        invoiceId: 7n,
        amount: 100n,
        legAmounts: [90n, 10n],
      },
      {
        key: "b",
        timestamp: 2,
        invoiceId: 8n,
        amount: 50n,
        legAmounts: [45n, 5n, 0n],
      },
    ],
  });

  expect(routedByLeg(s).map((l) => [l.kind, l.amount])).toEqual([
    ["hold", 135n],
    ["vault", 15n],
    [undefined, 0n],
  ]);
});

test("invoices by status keep lifecycle order and skip empty statuses", () => {
  const counts = invoicesByStatus([
    invoice({ id: 1n, status: "paid", faceValue: 5n }),
    invoice({ id: 2n, status: "issued", faceValue: 2n }),
    invoice({ id: 3n, status: "paid", faceValue: 1n }),
  ]);

  expect(counts).toEqual([
    { status: "issued", count: 1, faceValue: 2n },
    { status: "paid", count: 2, faceValue: 6n },
  ]);
});

test("upcoming due dates are open invoices, soonest first", () => {
  const due = upcomingDue([
    invoice({ id: 1n, status: "approved", dueDate: 30 }),
    invoice({ id: 2n, status: "paid", dueDate: 5 }),
    invoice({ id: 3n, status: "issued", dueDate: 10 }),
  ]);

  expect(due.map((i) => i.id)).toEqual([3n, 1n]);
});

test("pool utilisation is the deployed share, zero for an empty pool", () => {
  const base = state();

  expect(poolUse(base)).toEqual({ deployed: 0n, utilisation: 0 });
  expect(
    poolUse(
      state({ pool: { ...base.pool, totalAssets: 10_000n, idleCash: 6_000n } }),
    ),
  ).toEqual({ deployed: 4_000n, utilisation: 0.4 });
});

test("obligor credit lists each enrolled buyer once", () => {
  const credit = { limit: 10n, outstanding: 4n };
  const lines = obligorCredit(
    state({
      invoices: [
        invoice({ id: 1n, buyerCredit: credit }),
        invoice({ id: 2n, buyerCredit: credit }),
        invoice({ id: 3n, buyer: VAULT }),
      ],
    }),
  );

  expect(lines).toEqual([{ buyer: CLUB, ...credit }]);
});
