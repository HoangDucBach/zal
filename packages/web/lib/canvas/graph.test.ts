import type { CanvasState } from "./types";

import { describe, expect, test } from "vitest";

import {
  buildCanvasGraph,
  invoiceCommitment,
  relationshipCommitment,
} from "./graph";
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

const build = (s: CanvasState) => buildCanvasGraph(s, { vault: VAULT });
const kindOf = (s: CanvasState, id: string) =>
  build(s).nodes.find((n) => n.id === id)?.data;

describe("ghost and solid follow contracts.md", () => {
  test("relationships: proposed is ghost, active is solid, rejected and cancelled end", () => {
    expect(relationshipCommitment("proposed")).toBe("ghost");
    expect(relationshipCommitment("active")).toBe("solid");
    expect(relationshipCommitment("rejected")).toBe("ended");
    expect(relationshipCommitment("cancelled")).toBe("ended");
  });

  test("invoices: issued is ghost, approved and paid are solid", () => {
    expect(invoiceCommitment("issued")).toBe("ghost");
    expect(invoiceCommitment("approved")).toBe("solid");
    expect(invoiceCommitment("paid")).toBe("solid");
    expect(invoiceCommitment("cancelled")).toBe("ended");
  });

  test("an account not created yet is a lone ghost", () => {
    const graph = build(state({ account: account({ exists: false }) }));

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.data.commitment).toBe("ghost");
  });

  test("a ghost edge is animated, a solid one is not", () => {
    const graph = build(state({ relationships: [rel()] }));

    expect(graph.edges.find((e) => e.id === "rel-edge-1")?.ghost).toBe(true);
    const active = build(state({ relationships: [rel({ status: "active" })] }));

    expect(active.edges.find((e) => e.id === "rel-edge-1")?.ghost).toBe(false);
  });
});

describe("relationships live on edges, roles never on accounts", () => {
  test("the counterparty shows its role in this relationship", () => {
    expect(kindOf(state({ relationships: [rel()] }), "rel-1")).toMatchObject({
      kind: "counterparty",
      theirRole: "buyer",
    });
    expect(
      kindOf(
        state({ relationships: [rel({ buyer: ME, seller: CLUB })] }),
        "rel-1",
      ),
    ).toMatchObject({ theirRole: "seller" });
  });

  test("a proposal from the other side lands in the Inbox; my own does not", () => {
    expect(
      build(state({ relationships: [rel({ proposer: CLUB })] })).inbox,
    ).toEqual(["rel-1"]);
    expect(build(state({ relationships: [rel()] })).inbox).toEqual([]);
  });

  test("the side that ended a relationship stops showing it; the other side sees it faded", () => {
    const rejectedByThem = state({
      relationships: [rel({ status: "rejected" })],
    });

    expect(kindOf(rejectedByThem, "rel-1")?.commitment).toBe("ended");
    const rejectedByMe = state({
      relationships: [rel({ status: "rejected", proposer: CLUB })],
    });

    expect(kindOf(rejectedByMe, "rel-1")).toBeUndefined();
    const cancelledByMe = state({
      relationships: [rel({ status: "cancelled" })],
    });

    expect(kindOf(cancelledByMe, "rel-1")).toBeUndefined();
  });
});

describe("invoices and money paths", () => {
  const active = rel({ status: "active" });

  test("an issued invoice waits in the buyer's Inbox", () => {
    const asBuyer = state({
      account: account(),
      relationships: [rel({ status: "active", buyer: ME, seller: CLUB })],
      invoices: [invoice({ buyer: ME, seller: CLUB })],
    });

    expect(build(asBuyer).inbox).toContain("invoice-7");
  });

  test("the funding pool appears once the seller has an approved invoice", () => {
    expect(
      kindOf(state({ relationships: [active], invoices: [invoice()] }), "pool"),
    ).toBeUndefined();
    expect(
      kindOf(
        state({
          relationships: [active],
          invoices: [invoice({ status: "approved" })],
        }),
        "pool",
      )?.kind,
    ).toBe("pool");
  });

  test("funding reroutes the invoice's last edge from the Split to the pool", () => {
    const unfunded = build(
      state({
        relationships: [active],
        invoices: [invoice({ status: "approved" })],
      }),
    );

    expect(unfunded.edges.map((e) => e.id)).toContain("invoice-7-split");
    const funded = build(
      state({
        relationships: [active],
        invoices: [invoice({ status: "approved", owner: POOL })],
      }),
    );

    expect(funded.edges.map((e) => e.id)).toContain("invoice-7-pool");
    expect(funded.edges.map((e) => e.id)).not.toContain("invoice-7-split");
    expect(funded.nodes.find((n) => n.id === "invoice-7")?.data).toMatchObject({
      funded: true,
    });
  });

  test("an escrowed invoice gets an escrow node and the escrow-backed badge", () => {
    const s = state({
      relationships: [active],
      invoices: [invoice({ status: "approved", escrowed: 5_000_000_000n })],
    });

    expect(kindOf(s, "escrow-7")?.kind).toBe("escrow");
    expect(kindOf(s, "invoice-7")).toMatchObject({ escrowBacked: true });
  });

  test("the buyer's invoice hangs off the budget it was charged to", () => {
    const s = state({
      account: account({
        budgets: [
          { id: 1n, limit: 1n, used: 1n, periodStart: 0, periodLength: 1 },
        ],
        budgetOfInvoice: { "7": 1n },
      }),
      relationships: [rel({ status: "active", buyer: ME, seller: CLUB })],
      invoices: [invoice({ buyer: ME, seller: CLUB, status: "approved" })],
    });

    expect(
      build(s).edges.find((e) => e.id === "invoice-7-budget")?.source,
    ).toBe("budget-1");
  });

  test("Approval appears only with two or more members, Vault only with a vault leg or shares", () => {
    expect(kindOf(state(), "approval")).toBeUndefined();
    const two = account({
      members: [
        { address: ME, role: "admin" },
        { address: CLUB, role: "approver" },
      ],
    });

    expect(kindOf(state({ account: two }), "approval")?.kind).toBe("approval");
    expect(kindOf(state(), "vault")).toBeUndefined();
    expect(
      kindOf(
        state({
          account: account({
            route: [{ kind: "vault", target: VAULT, bps: 10_000 }],
          }),
        }),
        "vault",
      )?.kind,
    ).toBe("vault");
  });
});

describe("after settlement", () => {
  test("a paid invoice the pool financed keeps its path to the pool but is no longer marked financed", () => {
    const s = state({
      relationships: [rel({ status: "active" })],
      invoices: [invoice({ status: "paid", owner: POOL })],
    });
    const graph = build(s);

    expect(graph.edges.map((e) => e.id)).toContain("invoice-7-pool");
    expect(graph.nodes.find((n) => n.id === "invoice-7")?.data).toMatchObject({
      funded: false,
      commitment: "solid",
    });
    expect(graph.nodes.find((n) => n.id === "pool")?.data).toMatchObject({
      financed: [],
    });
  });
});
