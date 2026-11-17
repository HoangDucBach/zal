import type { CanvasState } from "@/lib/canvas/types";

import { getAddress } from "viem";
import { describe, expect, test } from "vitest";

import { problemToError } from "./client";
import {
  canvasResponseSchema,
  faucetDripResponseSchema,
  faucetResponseSchema,
  streamFeedSchema,
} from "./wire";

import { account, invoice, rel, state } from "@/lib/canvas/test-fixtures";

/** The API's wire form (packages/indexer/lib/canvas.ts `toWire`): bigints as strings, hex lowercase, undefined as null. */
function toWire(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (typeof value === "string")
    return /^0x[0-9a-fA-F]*$/.test(value) ? value.toLowerCase() : value;
  if (Array.isArray(value)) return value.map(toWire);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, toWire(v)]),
    );

  return value;
}

const SELLER = getAddress("0x206a7e277be02587782007fdb172a7668db60047");
const BUYER = getAddress("0xecee1f8ca6a92593ac3a9b97782ebc3daa712c26");
const POOL = getAddress("0xdc64a140aa3e981100a9beca4e685f962f0cf6c9");

const live: CanvasState = state({
  wallet: SELLER,
  account: account({
    address: SELLER,
    balance: 14_854_995_485n,
    members: [{ address: SELLER, role: "admin" }],
    budgetOfInvoice: { "3": 1n },
    ops: [
      {
        opId: 2n,
        call: { fn: "approveInvoice", invoiceId: 3n, budgetId: 1n },
        amount: 5_000_000_000n,
        confirmations: 1,
        required: 2,
        executed: false,
        stale: false,
        confirmedByMe: true,
      },
      {
        opId: 3n,
        call: {
          fn: "createSchedule",
          kind: "transfer",
          recipient: BUYER,
          amount: 100_000_000n,
          start: 1_802_736_000,
          interval: 60,
          runs: 3,
        },
        amount: 300_000_000n,
        confirmations: 1,
        required: 1,
        executed: true,
        stale: false,
        confirmedByMe: true,
      },
    ],
    schedules: [
      {
        id: 1n,
        kind: "transfer",
        recipient: BUYER,
        amount: 100_000_000n,
        nextAt: 1_802_736_060,
        interval: 60,
        remaining: 2,
        active: true,
      },
      {
        id: 2n,
        kind: "payInvoice",
        invoiceId: 3n,
        amount: 5_000_000_000n,
        nextAt: 1_802_740_000,
        interval: 0,
        remaining: 0,
        active: false,
      },
    ],
  }),
  relationships: [
    rel({ id: 3n, buyer: BUYER, seller: SELLER, proposer: SELLER }),
  ],
  invoices: [
    invoice({
      id: 3n,
      relationshipId: 3n,
      seller: SELLER,
      buyer: BUYER,
      owner: POOL,
      docHash: "0x1f4e",
    }),
    invoice({
      id: 4n,
      relationshipId: 3n,
      seller: SELLER,
      buyer: BUYER,
      owner: undefined,
      status: "cancelled",
    }),
  ],
  activity: [
    {
      key: "0x263ae5dfab4ecfc82d65b1dd19c752d655be40b17be4a5796a44d8fc48dd0888:0",
      timestamp: 1_800_057_486,
      blockNumber: 61n,
      transactionHash:
        "0x263ae5dfab4ecfc82d65b1dd19c752d655be40b17be4a5796a44d8fc48dd0888",
      title: "Relationship #3 proposed",
      event: { name: "RelationshipProposed", relationshipId: 3n },
    },
    {
      key: "0x263ae5dfab4ecfc82d65b1dd19c752d655be40b17be4a5796a44d8fc48dd0888:1",
      timestamp: 1_802_736_060,
      blockNumber: 70n,
      transactionHash:
        "0x263ae5dfab4ecfc82d65b1dd19c752d655be40b17be4a5796a44d8fc48dd0888",
      title: "Schedule #1 ran",
      event: { name: "ScheduleRan", scheduleId: 1n },
    },
  ],
  cash: [
    {
      key: "k",
      timestamp: 1,
      blockNumber: 51n,
      amount: -10_000_000_000n,
      counterparty: BUYER,
    },
  ],
  routed: [
    {
      key: "r",
      timestamp: 2,
      invoiceId: 3n,
      amount: 949_994_983n,
      legAmounts: [94_999_498n, 854_995_485n],
    },
  ],
  pool: { ...state().pool, address: POOL },
  now: 1_802_735_931,
});

describe("canvas wire form", () => {
  test("parses back to the same CanvasState the chain reads give, addresses checksummed", () => {
    const parsed = canvasResponseSchema.parse({
      asOf: { block: 73, updatedAt: 1_802_735_931 },
      canvas: toWire(live),
      layout: null,
    });

    expect(parsed.canvas).toEqual(live);
    expect(parsed.canvas.relationships[0]?.buyer).toBe(BUYER);
    expect(parsed.canvas.invoices[1]?.owner).toBeUndefined();
    expect(parsed.canvas.invoices[0]?.advance).toBeUndefined();
  });

  test("an API from before scheduled payments sends no schedules: none", () => {
    const wire = toWire(live) as { account: Record<string, unknown> };

    delete wire.account.schedules;
    expect(
      canvasResponseSchema.parse({
        asOf: { block: 1, updatedAt: 1 },
        canvas: wire,
        layout: null,
      }).canvas.account.schedules,
    ).toEqual([]);
  });

  test("rejects a response whose amounts are not decimal strings", () => {
    const wire = toWire(live) as { account: Record<string, unknown> };

    wire.account.balance = 12.5;
    expect(
      canvasResponseSchema.safeParse({
        asOf: { block: 1, updatedAt: 1 },
        canvas: wire,
        layout: null,
      }).success,
    ).toBe(false);
  });

  test("rejects numbers outside their on-chain domain; a transfer out stays negative", () => {
    type Wire = {
      account: Record<string, unknown>;
      lp: Record<string, unknown>;
      pool: Record<string, unknown>;
      cash: { amount: unknown }[];
    };
    const parses = (edit: (wire: Wire) => void) => {
      const wire = toWire(live) as Wire;

      edit(wire);

      return canvasResponseSchema.safeParse({
        asOf: { block: 1, updatedAt: 1 },
        canvas: wire,
        layout: null,
      }).success;
    };
    const maxUint = (2n ** 256n - 1n).toString();

    expect(parses(() => undefined)).toBe(true);
    expect(parses((w) => (w.lp.walletUsdc = maxUint))).toBe(true);
    expect(parses((w) => (w.account.balance = "-5000000"))).toBe(false);
    expect(parses((w) => (w.lp.walletUsdc = (2n ** 256n).toString()))).toBe(
      false,
    );
    expect(parses((w) => (w.lp.walletUsdc = "9".repeat(90)))).toBe(false);
    expect(parses((w) => (w.account.threshold = -3))).toBe(false);
    expect(parses((w) => (w.account.threshold = 256))).toBe(false);
    expect(parses((w) => (w.pool.advanceRateBps = 10_001))).toBe(false);
    const leg = (bps: number) => (w: Wire) =>
      (w.account.route = [
        { kind: "transfer", target: BUYER.toLowerCase(), bps },
      ]);

    expect(parses(leg(10_000))).toBe(true);
    expect(parses(leg(10_001))).toBe(false);
    expect(parses((w) => (w.cash[0]!.amount = "-949994983"))).toBe(true);
    expect(
      parses((w) => (w.cash[0]!.amount = `-${(2n ** 256n).toString()}`)),
    ).toBe(false);
  });

  test("keeps the saved layout and its revision", () => {
    const parsed = canvasResponseSchema.parse({
      asOf: { block: 1, updatedAt: 1 },
      canvas: toWire(live),
      layout: {
        layout: {
          version: 1,
          positions: {},
          children: [],
          drafts: [],
          links: [],
        },
        revision: 4,
        updatedAt: "2026-11-15T00:10:09.059Z",
        updatedBy: "0x4dba26f44d935d0ed89eab31eea0acd4f27e746a",
      },
    });

    expect(parsed.layout?.revision).toBe(4);
  });

  test("parses a stream feed event", () => {
    const feed = streamFeedSchema.parse({
      subjects: ["0x206a7e277be02587782007fdb172a7668db60047"],
      name: "Repaid",
      key: "0x34:8",
      blockNumber: "73",
      logIndex: 8,
      transactionHash: `0x${"34".repeat(32)}`,
      timestamp: 1_802_735_931,
      relationshipId: null,
      invoiceId: "3",
      opId: null,
      budgetId: null,
    });

    expect(feed.invoiceId).toBe(3n);
    expect(feed.subjects).toEqual([SELLER]);
  });
});

describe("problem details", () => {
  test("map to an ApiError with the API's code and detail", () => {
    const error = problemToError(409, {
      type: "urn:zal:error:conflict",
      title: "conflict",
      status: 409,
      detail: "The layout changed since you loaded it",
      instance: "/v1/accounts/0x1/layout",
      code: "conflict",
    });

    expect(error.kind).toBe("api");
    expect(error.code).toBe("conflict");
    expect(error.status).toBe(409);
    expect(error.message).toBe("The layout changed since you loaded it");
  });

  test("name the first invalid field of a 400", () => {
    const error = problemToError(400, {
      status: 400,
      code: "bad_request",
      detail: "Invalid request",
      errors: [{ path: "keys.0", message: "not a notification key" }],
    });

    expect(error.message).toBe(
      "Invalid request: keys.0 not a notification key",
    );
  });

  test("survive a body that is not a problem", () => {
    const error = problemToError(502, "<html>Bad gateway</html>");

    expect(error.code).toBe("http");
    expect(error.status).toBe(502);
  });
});

describe("faucet", () => {
  const asOf = { block: 7, updatedAt: 1_700_000_000 };

  test("GET /v1/faucet parses both forms the API sends", () => {
    expect(
      faucetResponseSchema.parse({
        asOf,
        enabled: true,
        address: POOL.toLowerCase(),
        dripWei: "50000000000000000",
        minBalanceWei: "10000000000000000",
        faucetBalanceWei: "0",
      }),
    ).toEqual({
      asOf,
      enabled: true,
      address: POOL,
      dripWei: 50_000_000_000_000_000n,
      minBalanceWei: 10_000_000_000_000_000n,
      faucetBalanceWei: 0n,
    });
    expect(
      faucetResponseSchema.parse({
        asOf,
        enabled: false,
        address: null,
        dripWei: null,
        minBalanceWei: null,
        faucetBalanceWei: null,
      }),
    ).toEqual({ asOf, enabled: false });
  });

  test("POST /v1/faucet parses the hash and the amount", () => {
    const txHash = `0x${"ab".repeat(32)}`;

    expect(
      faucetDripResponseSchema.parse({
        asOf,
        txHash,
        amountWei: "50000000000000000",
      }),
    ).toEqual({ asOf, txHash, amountWei: 50_000_000_000_000_000n });
  });
});
