import type { CanvasNodeData } from "./graph";
import type { CanvasState } from "./types";

import { describe, expect, test } from "vitest";

import { buildCanvasGraph, nodeId } from "./graph";
import { evaluate, palette, type PaletteComponent } from "./palette";
import { CLUB, ME, VAULT, account, invoice, rel, state } from "./test-fixtures";

/** The node the user selected, built the way the canvas builds it. */
const select = (s: CanvasState, id: string): CanvasNodeData => {
  const data = buildCanvasGraph(s, { vault: VAULT }).nodes.find(
    (n) => n.id === id,
  )?.data;

  if (data === undefined) throw new Error(`no node ${id}`);

  return data;
};

/** The components the palette offers (ready) for a selection. */
const offered = (s: CanvasState, target?: CanvasNodeData) =>
  palette(s, target)
    .filter((e) => e.availability.status === "ready")
    .map((e) => e.component);

const reason = (
  component: PaletteComponent,
  s: CanvasState,
  target?: CanvasNodeData,
) => {
  const a = evaluate(component, s, target);

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
      "schedule",
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
      evaluate("invoice", active, select(active, nodeId.counterparty(1n))),
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
      "schedule",
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

    expect(evaluate("budget", s, select(s, nodeId.invoice(9n)))).toEqual({
      status: "ready",
      action: { kind: "approveInvoice", invoiceId: 9n, budgetId: 2n },
    });
    const none = state({ relationships: [buying], invoices: [boughtInvoice] });

    expect(reason("budget", none, select(none, nodeId.invoice(9n)))).toMatch(
      /Add a budget first/,
    );
  });

  test("Schedule pays an approved invoice I buy, escrowed or not, once (ZR-SCH-01)", () => {
    const approved = state({
      relationships: [buying],
      invoices: [{ ...boughtInvoice, status: "approved" }],
    });
    const target = select(approved, nodeId.invoice(9n));
    const issued = state({
      relationships: [buying],
      invoices: [boughtInvoice],
    });

    expect(evaluate("schedule", approved, target)).toEqual({
      status: "ready",
      action: { kind: "schedulePayment", invoiceId: 9n },
    });
    expect(
      reason("schedule", issued, select(issued, nodeId.invoice(9n))),
    ).toMatch(/Approve the invoice first/);
    const scheduled = state({
      relationships: [buying],
      invoices: [{ ...boughtInvoice, status: "approved" }],
      account: account({
        schedules: [
          {
            id: 1n,
            kind: "payInvoice",
            invoiceId: 9n,
            amount: boughtInvoice.faceValue,
            nextAt: 100,
            interval: 0,
            remaining: 1,
            active: true,
          },
        ],
      }),
    });

    expect(
      reason("schedule", scheduled, select(scheduled, nodeId.invoice(9n))),
    ).toMatch(/Already scheduled/);
  });

  test("Schedule on the Account or a counterparty starts a transfer to it", () => {
    const s = state({ relationships: [buying] });

    expect(evaluate("schedule", s, select(s, nodeId.account))).toEqual({
      status: "ready",
      action: { kind: "scheduleTransfer" },
    });
    expect(evaluate("schedule", s, select(s, nodeId.counterparty(2n)))).toEqual(
      {
        status: "ready",
        action: { kind: "scheduleTransfer", recipient: CLUB },
      },
    );
  });

  test("Stream is always listed as unsupported by the v1 contracts", () => {
    const entry = palette(state(), undefined).find(
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
        palette(state(), undefined).map((e) => [e.component, e.group]),
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

describe("one Split, Vault and Approval per canvas", () => {
  const entryOf = (
    component: PaletteComponent,
    s: CanvasState,
    target?: CanvasNodeData,
    placed: readonly PaletteComponent[] = [],
  ) => palette(s, target, placed).find((e) => e.component === component);

  test("Split is offered while the route is empty and no Split draft is placed", () => {
    expect(entryOf("split", state())?.availability.status).toBe("ready");
  });

  test("a set route shows Split disabled: the Split node edits it", () => {
    const s = state({
      account: account({
        route: [{ kind: "hold", target: ME, bps: 10_000 }],
      }),
    });

    expect(entryOf("split", s)?.availability).toEqual({
      status: "unsupported",
      reason: "One Split per canvas",
    });
  });

  test("a placed Split draft shows Split disabled", () => {
    expect(
      entryOf("split", state(), undefined, ["split"])?.availability,
    ).toEqual({ status: "unsupported", reason: "One Split per canvas" });
  });

  test("a Vault node (shares held) shows Vault disabled", () => {
    const s = state({ account: account({ vaultShares: 1n }) });

    expect(entryOf("vault", s)?.availability).toEqual({
      status: "unsupported",
      reason: "One Vault per canvas",
    });
  });

  test("a placed Approval draft shows Approval disabled", () => {
    const s = state({
      account: account({
        members: [
          { address: ME, role: "admin" },
          { address: CLUB, role: "approver" },
        ],
      }),
    });

    expect(entryOf("approval", s)?.availability.status).toBe("ready");
    expect(
      entryOf("approval", s, undefined, ["approval"])?.availability,
    ).toEqual({ status: "unsupported", reason: "One Approval per canvas" });
  });

  test("a singleton that does not fit the selection stays hidden", () => {
    const s = state({
      invoices: [boughtInvoice],
      relationships: [buying],
      account: account({
        route: [{ kind: "hold", target: ME, bps: 10_000 }],
      }),
    });

    expect(
      entryOf("split", s, select(s, nodeId.invoice(boughtInvoice.id)))
        ?.availability.status,
    ).toBe("blocked");
  });
});
