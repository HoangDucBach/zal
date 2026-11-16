import type { CanvasNodeData } from "./graph";
import type { CanvasState } from "./types";

import { describe, expect, test } from "vitest";

import { buildCanvasGraph, nodeId } from "./graph";
import {
  canConnect,
  describeAction,
  palette,
  type ConnectEnd,
  type PaletteComponent,
} from "./palette";
import { ME, VAULT, account, invoice, rel, state } from "./test-fixtures";

const SHOP = "0x00000000000000000000000000000000000000f6" as const;

const budget = {
  id: 3n,
  limit: 20_000_000_000n,
  used: 0n,
  periodStart: 0,
  periodLength: 30 * 86_400,
};

/** A canvas that sells to CLUB and buys from SHOP, with every invoice state the rules care about. */
const world: CanvasState = state({
  account: account({
    route: [{ kind: "hold", target: ME, bps: 10_000 }],
    budgets: [budget],
    members: [
      { address: "0x00000000000000000000000000000000000000e5", role: "admin" },
      { address: "0x00000000000000000000000000000000000000e6", role: "admin" },
    ],
  }),
  relationships: [
    rel({ id: 1n, status: "active" }),
    rel({ id: 2n, buyer: ME, seller: SHOP, proposer: SHOP, status: "active" }),
  ],
  invoices: [
    // Sold, approved and fully escrowed: the pool advances on it.
    invoice({
      id: 7n,
      status: "approved",
      escrowed: 5_000_000_000n,
      approvedAt: 1,
    }),
    // Bought: issued, approved, and approved with escrow.
    invoice({
      id: 10n,
      relationshipId: 2n,
      seller: SHOP,
      buyer: ME,
      owner: SHOP,
    }),
    invoice({
      id: 11n,
      relationshipId: 2n,
      seller: SHOP,
      buyer: ME,
      owner: SHOP,
      status: "approved",
    }),
    invoice({
      id: 12n,
      relationshipId: 2n,
      seller: SHOP,
      buyer: ME,
      owner: SHOP,
      status: "approved",
      escrowed: 5_000_000_000n,
    }),
  ],
});

const graph = buildCanvasGraph(world, { vault: VAULT });
const node = (id: string): ConnectEnd => {
  const data = graph.nodes.find((n) => n.id === id)?.data;

  if (data === undefined) throw new Error(`no node ${id}`);

  return { kind: "node", data: data as CanvasNodeData };
};
const draft = (component: PaletteComponent): ConnectEnd => ({
  kind: "draft",
  component,
});
const connect = (source: ConnectEnd, target: ConnectEnd, s = world) =>
  canConnect(source, target, s);

describe("canConnect: every valid pair opens its action", () => {
  test.each<[string, ConnectEnd, ConnectEnd, string]>([
    [
      "Account -> draft Counterparty",
      node(nodeId.account),
      draft("counterparty"),
      "proposeRelationship",
    ],
    [
      "Account -> draft Split",
      node(nodeId.account),
      draft("split"),
      "setRoute",
    ],
    ["Account -> Split", node(nodeId.account), node(nodeId.split), "setRoute"],
    [
      "Account -> draft Budget",
      node(nodeId.account),
      draft("budget"),
      "addBudget",
    ],
    [
      "Account -> draft Vault",
      node(nodeId.account),
      draft("vault"),
      "vaultDeposit",
    ],
    [
      "Account -> draft Approval",
      node(nodeId.account),
      draft("approval"),
      "setPolicy",
    ],
    [
      "Account -> draft Payee endpoint",
      node(nodeId.account),
      draft("endpoint"),
      "publishEndpoint",
    ],
    [
      "Account -> draft Pool liquidity",
      node(nodeId.account),
      draft("liquidity"),
      "provideLiquidity",
    ],
    ["Split -> draft Vault", node(nodeId.split), draft("vault"), "setRoute"],
    [
      "Counterparty I sell to -> draft Invoice",
      node(nodeId.counterparty(1n)),
      draft("invoice"),
      "issueInvoice",
    ],
    [
      "draft Budget -> issued invoice I pay",
      draft("budget"),
      node(nodeId.invoice(10n)),
      "approveInvoice",
    ],
    [
      "Budget -> issued invoice I pay",
      node(nodeId.budget(3n)),
      node(nodeId.invoice(10n)),
      "approveInvoice",
    ],
    [
      "approved invoice I pay -> draft Escrow",
      node(nodeId.invoice(11n)),
      draft("escrow"),
      "escrow",
    ],
    [
      "escrowed invoice I pay -> draft Schedule",
      node(nodeId.invoice(12n)),
      draft("schedule"),
      "schedulePayment",
    ],
    [
      "approved invoice I pay, not escrowed -> draft Schedule",
      node(nodeId.invoice(11n)),
      draft("schedule"),
      "schedulePayment",
    ],
    [
      "draft Schedule -> counterparty",
      draft("schedule"),
      node(nodeId.counterparty(2n)),
      "scheduleTransfer",
    ],
    [
      "draft Schedule -> Account",
      draft("schedule"),
      node(nodeId.account),
      "scheduleTransfer",
    ],
    [
      "invoice I sell -> draft Funding pool",
      node(nodeId.invoice(7n)),
      draft("pool"),
      "advance",
    ],
    [
      "invoice I sell -> Funding pool",
      node(nodeId.invoice(7n)),
      node(nodeId.pool),
      "advance",
    ],
    [
      "Funding pool -> invoice I sell (either direction)",
      node(nodeId.pool),
      node(nodeId.invoice(7n)),
      "advance",
    ],
  ])("%s", (_, source, target, kind) => {
    const result = connect(source, target);

    expect(result).toMatchObject({ ok: true, action: { kind } });
    if (result.ok) expect(describeAction(result.action)).not.toBe("");
  });

  test("the prefilled action carries the ids of both ends", () => {
    expect(connect(node(nodeId.budget(3n)), node(nodeId.invoice(10n)))).toEqual(
      {
        ok: true,
        action: { kind: "approveInvoice", invoiceId: 10n, budgetId: 3n },
      },
    );
    expect(connect(node(nodeId.split), draft("vault"))).toEqual({
      ok: true,
      action: { kind: "setRoute", vaultLeg: true },
    });
    expect(connect(node(nodeId.invoice(7n)), node(nodeId.pool))).toEqual({
      ok: true,
      action: { kind: "advance", invoiceId: 7n },
    });
  });
});

describe("canConnect: invalid pairs say why", () => {
  test.each<[string, ConnectEnd, ConnectEnd, string]>([
    [
      "two drafts",
      draft("budget"),
      draft("escrow"),
      "Two drafts · one end must be on-chain",
    ],
    [
      "draft Budget -> invoice I sell",
      draft("budget"),
      node(nodeId.invoice(7n)),
      "Only the buyer charges a budget",
    ],
    [
      "draft Budget -> approved invoice I pay",
      draft("budget"),
      node(nodeId.invoice(11n)),
      "Budget charges at approval · this invoice is past it",
    ],
    [
      "draft Escrow -> issued invoice I pay",
      draft("escrow"),
      node(nodeId.invoice(10n)),
      "Approve the invoice first",
    ],
    [
      "draft Escrow -> escrowed invoice",
      draft("escrow"),
      node(nodeId.invoice(12n)),
      "Already escrowed",
    ],
    [
      "draft Escrow -> invoice I sell",
      draft("escrow"),
      node(nodeId.invoice(7n)),
      "Only the buyer escrows",
    ],
    [
      "draft Schedule -> issued invoice I pay",
      draft("schedule"),
      node(nodeId.invoice(10n)),
      "Approve the invoice first",
    ],
    [
      "draft Schedule -> invoice I sell",
      draft("schedule"),
      node(nodeId.invoice(7n)),
      "Only the buyer schedules payment",
    ],
    [
      "draft Schedule -> Split",
      draft("schedule"),
      node(nodeId.split),
      "Schedule attaches to the Account, a counterparty or an invoice",
    ],
    [
      "draft Funding pool -> invoice I pay",
      draft("pool"),
      node(nodeId.invoice(11n)),
      "Only the seller takes an advance",
    ],
    [
      "draft Invoice -> counterparty I buy from",
      draft("invoice"),
      node(nodeId.counterparty(2n)),
      "Only the seller issues invoices",
    ],
    [
      "draft Invoice -> Account",
      draft("invoice"),
      node(nodeId.account),
      "Invoice attaches to a counterparty you sell to",
    ],
    [
      "draft Counterparty -> invoice",
      draft("counterparty"),
      node(nodeId.invoice(10n)),
      "Counterparty attaches to the Account",
    ],
    [
      "Account -> counterparty (no component end)",
      node(nodeId.account),
      node(nodeId.counterparty(1n)),
      "Account and 0x0000…00b2 do not connect",
    ],
    [
      "draft Stream -> Account",
      draft("stream"),
      node(nodeId.account),
      "Not in v1 contracts",
    ],
    [
      "draft Account -> Account",
      draft("account"),
      node(nodeId.account),
      "Already created · one Account per canvas",
    ],
  ])("%s", (_, source, target, reason) => {
    expect(connect(source, target)).toEqual({ ok: false, reason });
  });
});

describe("palette offers drafts with nothing selected", () => {
  test("components that need a node become drafts that say what to connect to", () => {
    const entries = palette(world, undefined);
    const status = Object.fromEntries(
      entries.map((e) => [e.component, e.availability.status]),
    );

    expect(status).toMatchObject({
      counterparty: "ready",
      // The route is already set: the Split node edits it, so the palette offers no second Split.
      split: "unsupported",
      invoice: "draft",
      escrow: "draft",
      pool: "draft",
      schedule: "ready",
      stream: "unsupported",
      account: "blocked",
    });
    expect(entries.find((e) => e.component === "escrow")?.availability).toEqual(
      {
        status: "draft",
        reason: "Connects to an approved invoice you pay",
      },
    );
  });

  test("a selected node still filters the palette to what fits it (C2)", () => {
    const invoiceData = node(nodeId.invoice(11n));

    if (invoiceData.kind !== "node") throw new Error("unreachable");
    const ready = palette(world, invoiceData.data)
      .filter((e) => e.availability.status === "ready")
      .map((e) => e.component);

    expect(ready).toEqual(["schedule", "escrow"]);
  });
});
