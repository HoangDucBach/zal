import type { ActivityEvent, ActivityItem, CanvasState } from "./types";

import { describe, expect, test } from "vitest";

import { activityTitle } from "./activity";
import {
  arrivals,
  deriveNotifications,
  notificationsStorageKey,
  parseReadKeys,
  serializeReadKeys,
} from "./notifications";
import { CLUB, ME, POOL, account, invoice, rel, state } from "./test-fixtures";

let block = 0n;
const item = (event: ActivityEvent): ActivityItem => {
  block += 1n;

  return {
    key: `0xtx:${block}`,
    timestamp: Number(block),
    blockNumber: block,
    transactionHash: "0x00",
    title: activityTitle(event),
    event,
  };
};

const kinds = (s: CanvasState) =>
  deriveNotifications(s).map((n) => [n.kind, n.nodeId]);

describe("notifications from the event stream", () => {
  test("a proposal from someone else is news; my own proposal is not", () => {
    const fromClub = state({
      relationships: [rel({ proposer: CLUB, buyer: CLUB, seller: ME })],
      activity: [item({ name: "RelationshipProposed", relationshipId: 1n })],
      labels: { [CLUB]: "Demo club" },
    });
    const mine = state({
      relationships: [rel({ proposer: ME })],
      activity: [item({ name: "RelationshipProposed", relationshipId: 1n })],
    });

    expect(kinds(fromClub)).toEqual([["proposalReceived", "rel-1"]]);
    expect(deriveNotifications(fromClub)[0]?.title).toBe(
      "Demo club proposed a relationship",
    );
    expect(kinds(mine)).toEqual([]);
  });

  test("an invoice issued to me needs my approval; one I issued does not notify me", () => {
    const issued = item({ name: "InvoiceIssued", invoiceId: 7n });

    expect(
      kinds(
        state({
          invoices: [invoice({ buyer: ME, seller: CLUB })],
          activity: [issued],
        }),
      ),
    ).toEqual([["invoiceIssued", "invoice-7"]]);
    expect(kinds(state({ invoices: [invoice()], activity: [issued] }))).toEqual(
      [],
    );
  });

  test("an op waiting for my signature notifies; one I signed or that ran does not", () => {
    const op = {
      opId: 3n,
      call: { fn: "payInvoice", invoiceId: 7n } as const,
      amount: 1n,
      confirmations: 1,
      required: 2,
      executed: false,
      stale: false,
      confirmedByMe: false,
    };
    const submitted = item({ name: "OpSubmitted", opId: 3n });

    expect(
      kinds(state({ account: account({ ops: [op] }), activity: [submitted] })),
    ).toEqual([["signatureNeeded", "approval"]]);
    expect(
      kinds(
        state({
          account: account({ ops: [{ ...op, confirmedByMe: true }] }),
          activity: [submitted],
        }),
      ),
    ).toEqual([]);
  });

  test("the seller hears about the advance and the payment; a buyer hears when a schedule ran", () => {
    const sold = state({
      invoices: [
        invoice({
          status: "paid",
          owner: POOL,
          advance: { principal: 4_000_000_000n, fee: 50_000_000n, fundedAt: 0 },
        }),
      ],
      activity: [
        item({ name: "Advanced", invoiceId: 7n }),
        item({ name: "InvoicePaid", invoiceId: 7n }),
      ],
    });

    expect(kinds(sold)).toEqual([
      ["paymentReceived", "invoice-7"],
      ["advancePaid", "invoice-7"],
    ]);
    expect(deriveNotifications(sold)[1]?.detail).toBe(
      "3,950.00 zUSDC from the funding pool",
    );

    const bought = state({
      invoices: [invoice({ buyer: ME, seller: CLUB, status: "paid" })],
      activity: [item({ name: "InvoicePaid", invoiceId: 7n })],
    });

    expect(kinds(bought)).toEqual([]);

    const ran = state({
      account: account({
        schedules: [
          {
            id: 2n,
            kind: "transfer",
            recipient: CLUB,
            amount: 100_000_000n,
            nextAt: 120,
            interval: 60,
            remaining: 2,
            active: true,
          },
        ],
      }),
      activity: [item({ name: "ScheduleRan", scheduleId: 2n })],
      labels: { [CLUB]: "Demo club" },
    });

    expect(kinds(ran)).toEqual([["scheduleRan", "schedule-2"]]);
    expect(deriveNotifications(ran)[0]).toMatchObject({
      title: "Schedule #2 ran",
      detail: "100.00 zUSDC to Demo club",
    });
  });

  test("events that are not news (my own route change, approvals I made) are left out", () => {
    expect(
      kinds(
        state({
          invoices: [invoice({ status: "approved" })],
          activity: [
            item({ name: "RouteSet" }),
            item({ name: "InvoiceApproved", invoiceId: 7n }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("arrivals are the keys a new read added", () => {
    const s1 = state({
      invoices: [invoice({ buyer: ME, seller: CLUB })],
      activity: [item({ name: "InvoiceIssued", invoiceId: 7n })],
    });
    const s2 = state({
      ...s1,
      invoices: [
        invoice({ buyer: ME, seller: CLUB }),
        invoice({ id: 8n, buyer: ME, seller: CLUB }),
      ],
      activity: [
        ...s1.activity,
        item({ name: "InvoiceIssued", invoiceId: 8n }),
      ],
    });
    const before = deriveNotifications(s1);
    const after = deriveNotifications(s2);

    expect(arrivals(before, after).map((n) => n.nodeId)).toEqual(["invoice-8"]);
    expect(arrivals(after, after)).toEqual([]);
  });
});

describe("read state per wallet", () => {
  test("the key is versioned and scoped to chain and wallet", () => {
    expect(notificationsStorageKey(1, "0xAB")).toBe(
      "zal.notifications.v1:1:0xab",
    );
  });

  test("read keys round-trip, keep only keys still in the feed, and bad data reads as nothing read", () => {
    const feed = deriveNotifications(
      state({
        invoices: [invoice({ buyer: ME, seller: CLUB })],
        activity: [item({ name: "InvoiceIssued", invoiceId: 7n })],
      }),
    );
    const key = feed[0]?.key ?? "";

    expect([
      ...parseReadKeys(serializeReadKeys(new Set([key, "gone"]), feed)),
    ]).toEqual([key]);
    expect(parseReadKeys(null).size).toBe(0);
    expect(parseReadKeys("[").size).toBe(0);
    expect(
      parseReadKeys(JSON.stringify({ version: 9, read: [key] })).size,
    ).toBe(0);
  });
});
