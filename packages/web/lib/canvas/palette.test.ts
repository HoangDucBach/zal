import type { CanvasNodeData } from "./graph";
import type { CanvasState } from "./types";

import { describe, expect, test } from "vitest";

import { buildCanvasGraph, nodeId } from "./graph";
import {
  evaluate,
  palette,
  type PaletteComponent,
  type PaletteContext,
} from "./palette";
import { CLUB, ME, VAULT, account, invoice, rel, state } from "./test-fixtures";

const SANDBOX: PaletteContext = { keeper: true, scheduled: [] };
const LIVE: PaletteContext = { keeper: false, scheduled: [] };

/** The node the user selected, built the way the canvas builds it. */
const select = (s: CanvasState, id: string): CanvasNodeData => {
  const data = buildCanvasGraph(s, { vault: VAULT }).nodes.find(
    (n) => n.id === id,
  )?.data;

  if (data === undefined) throw new Error(`no node ${id}`);

  return data;
};

/** The components the palette offers (ready) for a selection. */
const offered = (s: CanvasState, target?: CanvasNodeData, context = SANDBOX) =>
  palette(s, target, context)
    .filter((e) => e.availability.status === "ready")
    .map((e) => e.component);

const reason = (
  component: PaletteComponent,
  s: CanvasState,
  target?: CanvasNodeData,
  context = SANDBOX,
) => {
  const a = evaluate(component, s, target, context);

  return a.status === "ready" ? undefined : a.reason;
};

const buying = rel({
  id: 2n,
  buyer: ME,
  seller: CLUB,
  proposer: CLUB,
  status: "active",
});
const boughtInvoice = invoice({
  id: 9n,
  relationshipId: 2n,
  seller: CLUB,
  buyer: ME,
  owner: CLUB,
});

describe("palette rules (story C2)", () => {
  test("before the canvas exists only the Account and pool liquidity are offered", () => {
    const s = state({ account: account({ exists: false }) });

    expect(offered(s)).toEqual(["account", "liquidity"]);
    expect(reason("split", s)).toBe("Create the Account first");
  });

  test("with nothing selected, only canvas-level components fit", () => {
    expect(offered(state())).toEqual([
      "counterparty",
      "endpoint",
      "split",
      "vault",
      "liquidity",
    ]);
  });

  test("Budget appears once the account buys on some relationship", () => {
    expect(reason("budget", state())).toMatch(/relationship where you buy/);
    expect(offered(state({ relationships: [buying] }))).toContain("budget");
  });

  test("Approval appears only on a canvas with two or more members", () => {
    expect(reason("approval", state())).toMatch(/needs 2\+ members/);
    const two = account({
      members: [
        { address: ME, role: "admin" },
        { address: CLUB, role: "approver" },
      ],
    });

    expect(offered(state({ account: two }))).toContain("approval");
  });

  test("Invoice fits only an active relationship where I sell, and says why otherwise", () => {
    const proposed = state({ relationships: [rel({ status: "proposed" })] });
    const active = state({ relationships: [rel({ status: "active" })] });
    const asBuyer = state({ relationships: [buying] });

    expect(offered(active, select(active, nodeId.counterparty(1n)))).toContain(
      "invoice",
    );
    expect(
      evaluate(
        "invoice",
        active,
        select(active, nodeId.counterparty(1n)),
        SANDBOX,
      ),
    ).toEqual({
      status: "ready",
      action: { kind: "issueInvoice", relationshipId: 1n },
    });
    expect(
      reason("invoice", proposed, select(proposed, nodeId.counterparty(1n))),
    ).toMatch(/Not active until they accept/);
    expect(
      reason("invoice", asBuyer, select(asBuyer, nodeId.counterparty(2n))),
    ).toMatch(/Only the seller issues invoices/);
    expect(reason("invoice", active, select(active, nodeId.account))).toMatch(
      /attaches to a counterparty you sell to/,
    );
  });

  test("Funding pool appears only when an approved invoice of mine is selected and the pool would advance", () => {
    const s = (over: Parameters<typeof invoice>[0]) =>
      state({
        relationships: [rel({ status: "active" })],
        invoices: [invoice(over)],
      });
    const escrowed = s({ status: "approved", escrowed: 5_000_000_000n });
    const unescrowed = s({ status: "approved" });
    const issued = s({ status: "issued" });

    expect(offered(escrowed, select(escrowed, nodeId.invoice(7n)))).toEqual([
      "pool",
    ]);
    expect(reason("pool", escrowed)).toMatch(
      /needs an approved invoice you sell/,
    );
    expect(
      reason("pool", unescrowed, select(unescrowed, nodeId.invoice(7n))),
    ).toMatch(/Not escrowed and buyer not enrolled/);
    expect(reason("pool", issued, select(issued, nodeId.invoice(7n)))).toMatch(
      /not approved/,
    );
  });

  test("Escrow appears only on an approved invoice where I am the buyer", () => {
    const s = (over: Parameters<typeof invoice>[0]) =>
      state({
        relationships: [buying],
        invoices: [{ ...boughtInvoice, ...over }],
      });
    const approved = s({ status: "approved" });

    expect(offered(approved, select(approved, nodeId.invoice(9n)))).toEqual([
      "escrow",
    ]);
    expect(
      reason(
        "escrow",
        s({ status: "issued" }),
        select(s({ status: "issued" }), nodeId.invoice(9n)),
      ),
    ).toMatch(/Approve the invoice first/);
    const asSeller = state({
      relationships: [rel({ status: "active" })],
      invoices: [invoice({ status: "approved" })],
    });

    expect(
      reason("escrow", asSeller, select(asSeller, nodeId.invoice(7n))),
    ).toMatch(/Only the buyer escrows/);
  });

  test("Budget dropped on an issued invoice I pay approves it against a budget with room", () => {
    const s = state({
      relationships: [buying],
      invoices: [boughtInvoice],
      account: account({
        budgets: [
          {
            id: 1n,
            limit: 1_000_000n,
            used: 0n,
            periodStart: 0,
            periodLength: 0,
          },
          {
            id: 2n,
            limit: 10_000_000_000n,
            used: 0n,
            periodStart: 0,
            periodLength: 0,
          },
        ],
      }),
    });

    expect(
      evaluate("budget", s, select(s, nodeId.invoice(9n)), SANDBOX),
    ).toEqual({
      status: "ready",
      action: { kind: "approveInvoice", invoiceId: 9n, budgetId: 2n },
    });
    const none = state({ relationships: [buying], invoices: [boughtInvoice] });

    expect(reason("budget", none, select(none, nodeId.invoice(9n)))).toMatch(
      /Add a budget first/,
    );
  });

  test("Schedule needs an escrowed invoice I pay, a keeper, and is offered once", () => {
    const escrowed = state({
      relationships: [buying],
      invoices: [
        {
          ...boughtInvoice,
          status: "approved",
          escrowed: boughtInvoice.faceValue,
        },
      ],
    });
    const target = select(escrowed, nodeId.invoice(9n));
    const unescrowed = state({
      relationships: [buying],
      invoices: [{ ...boughtInvoice, status: "approved" }],
    });

    expect(evaluate("schedule", escrowed, target, SANDBOX)).toEqual({
      status: "ready",
      action: { kind: "schedule", invoiceId: 9n },
    });
    expect(evaluate("schedule", escrowed, target, LIVE).status).toBe(
      "unsupported",
    );
    expect(reason("schedule", escrowed, target, LIVE)).toMatch(
      /No keeper on this network/,
    );
    expect(
      reason("schedule", escrowed, target, { keeper: true, scheduled: [9n] }),
    ).toMatch(/Already scheduled/);
    expect(
      reason("schedule", unescrowed, select(unescrowed, nodeId.invoice(9n))),
    ).toMatch(/Escrow first/);
  });

  test("Stream is always listed as unsupported by the v1 contracts", () => {
    const entry = palette(state(), undefined, SANDBOX).find(
      (e) => e.component === "stream",
    );

    expect(entry?.availability).toEqual({
      status: "unsupported",
      reason: "Not in v1 contracts",
    });
  });

  test("every component sits in its PRD catalogue group", () => {
    expect(
      Object.fromEntries(
        palette(state(), undefined, SANDBOX).map((e) => [e.component, e.group]),
      ),
    ).toEqual({
      account: "Root",
      counterparty: "Relationship",
      endpoint: "Relationship",
      invoice: "Document",
      budget: "Spend control",
      approval: "Spend control",
      schedule: "Time",
      stream: "Time",
      split: "Allocation",
      escrow: "Commitment",
      vault: "Yield",
      pool: "Financing",
      liquidity: "Financing",
    });
  });
});
