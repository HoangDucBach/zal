import type { ActivityItem, CanvasState } from "./types";

import { describe, expect, test } from "vitest";

import { nodeId } from "./graph";
import { buyerAndLpDemo, sellerDemo } from "./guided-demo";
import {
  CLUB,
  ME,
  POOL,
  VAULT,
  account,
  invoice,
  rel,
  state,
} from "./test-fixtures";

const FACE = 5_000_000_000n;
const titles = (...list: string[]): ActivityItem[] =>
  list.map((title, i) => ({
    key: String(i),
    timestamp: 0,
    blockNumber: BigInt(i),
    transactionHash: "0x00",
    title,
    event: { name: "RouteSet" },
  }));

/** The seller's canvas after each PRD demo step. */
const after = (step: number): CanvasState => {
  const route =
    step >= 1 ? [{ kind: "vault" as const, target: VAULT, bps: 10_000 }] : [];
  const relationships =
    step >= 2 ? [rel({ status: step >= 3 ? "active" : "proposed" })] : [];
  const invoices =
    step >= 4
      ? [
          invoice({
            status: step >= 7 ? "paid" : step >= 5 ? "approved" : "issued",
            escrowed: step >= 5 && step < 7 ? FACE : 0n,
            owner: step >= 6 ? POOL : ME,
          }),
        ]
      : [];
  const activity =
    step >= 7
      ? titles(
          "Invoice #7 issued",
          "Invoice #7 approved",
          "Invoice #7 escrowed",
          "Invoice #7 advanced by the pool",
          "Invoice #7 paid",
          ...(step >= 8
            ? ["Payment for invoice #7 ran through the Split"]
            : []),
        )
      : [];

  return state({
    account: account({ route, endpointPublic: step >= 1 }),
    relationships,
    invoices,
    activity,
  });
};

describe("guided demo: the eight PRD steps from chain state", () => {
  test("each step is detected exactly when the chain reaches it", () => {
    for (let step = 0; step <= 8; step++) {
      const demo = sellerDemo(after(step));

      expect(demo.done, `after step ${step}`).toBe(step);
      expect(demo.steps.map((s) => s.done)).toEqual(
        Array.from({ length: 8 }, (_, i) => i < step),
      );
    }
  });

  test("the next step names the node to fly to", () => {
    expect(sellerDemo(after(0)).next?.focus).toBe(nodeId.split);
    expect(sellerDemo(after(1)).next?.focus).toBe(nodeId.account);
    expect(sellerDemo(after(3)).next?.focus).toBe(nodeId.counterparty(1n));
    expect(sellerDemo(after(5)).next?.focus).toBe(nodeId.invoice(7n));
    expect(sellerDemo(after(8)).next).toBeUndefined();
  });

  test("a Split without a public endpoint does not finish step 1", () => {
    const s = state({
      account: account({
        route: [{ kind: "vault", target: VAULT, bps: 10_000 }],
      }),
    });

    expect(sellerDemo(s).steps[0]?.done).toBe(false);
  });

  test("a relationship someone else proposed to me does not count as step 2", () => {
    const s = state({
      relationships: [rel({ proposer: CLUB, status: "active" })],
    });

    expect(sellerDemo(s).done).toBe(0);
  });
});

describe("guided demo: buyer and LP roles", () => {
  const shopRel = rel({
    id: 2n,
    buyer: ME,
    seller: CLUB,
    proposer: CLUB,
    status: "active",
  });
  const bought = invoice({
    id: 9n,
    relationshipId: 2n,
    seller: CLUB,
    buyer: ME,
    owner: CLUB,
  });
  const op = (
    fn: "approveInvoice" | "escrowInvoice",
    confirmations: number,
  ) => ({
    opId: fn === "approveInvoice" ? 1n : 2n,
    call: { fn, invoiceId: 9n, budgetId: 1n } as const,
    amount: FACE,
    confirmations,
    required: 2,
    executed: true,
    stale: false,
    confirmedByMe: true,
  });

  test("a proposal from the print shop is step one, not done until accepted", () => {
    const pending = buyerAndLpDemo(
      state({ relationships: [{ ...shopRel, status: "proposed" }] }),
      [],
    );

    expect(pending.done).toBe(0);
    expect(pending.next?.focus).toBe(nodeId.counterparty(2n));
    expect(buyerAndLpDemo(state({ relationships: [shopRel] }), []).done).toBe(
      1,
    );
  });

  test("approvals count only when two signatures executed them", () => {
    const one = state({
      relationships: [shopRel],
      invoices: [{ ...bought, status: "approved" }],
      account: account({ ops: [op("approveInvoice", 1)] }),
    });
    const two = state({
      relationships: [shopRel],
      invoices: [{ ...bought, status: "approved" }],
      account: account({
        ops: [op("approveInvoice", 2), op("escrowInvoice", 2)],
      }),
    });

    expect(buyerAndLpDemo(one, []).steps[3]?.done).toBe(false);
    expect(
      buyerAndLpDemo(two, [])
        .steps.slice(3, 5)
        .map((s) => s.done),
    ).toEqual([true, true]);
  });

  test("the schedule step needs the keeper's settlement of a scheduled invoice", () => {
    const paid = state({
      relationships: [shopRel],
      invoices: [{ ...bought, status: "paid" }],
    });

    expect(buyerAndLpDemo(paid, []).steps[5]?.done).toBe(false);
    expect(buyerAndLpDemo(paid, [9n]).steps[5]?.done).toBe(true);
  });

  test("an LP position in the wallet finishes the LP step", () => {
    const lp = state({
      lp: {
        shares: 1n,
        assets: 1n,
        maxWithdraw: 1n,
        walletUsdc: 0n,
        allowance: 0n,
      },
    });

    expect(buyerAndLpDemo(lp, []).steps[6]?.done).toBe(true);
  });
});
