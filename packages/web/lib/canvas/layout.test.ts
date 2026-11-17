import type { CanvasState } from "./types";

import { describe, expect, test } from "vitest";

import { buildCanvasGraph, nodeId } from "./graph";
import {
  CHILD_NAME_MAX,
  DEPTH_REASON,
  EMPTY_LAYOUT,
  childName,
  layoutProblem,
  renameChild,
  addDraft,
  addLink,
  removeDrafts,
  settleLink,
  FOOTPRINT,
  MAX_CANVAS_DEPTH,
  ROOT,
  buildView,
  classifyCrossing,
  dissolve,
  layoutStorageKey,
  levelOf,
  moveToChild,
  newChildId,
  childOf,
  moveToParent,
  parseStoredLayout,
  reconcile,
  serializeLayout,
  setPositions,
  type CanvasLayout,
  type XY,
} from "./layout";
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

const graphOf = (s: CanvasState) => buildCanvasGraph(s, { vault: VAULT });

/** A seller with `count` active buyers, one issued invoice each, a Split and a budget: a large canvas. */
const big = (count: number): CanvasState => {
  const party = (i: number) =>
    `0x${(0xb000 + i).toString(16).padStart(40, "0")}` as const;

  return state({
    account: account({
      route: [{ kind: "vault", target: VAULT, bps: 10_000 }],
      budgets: [
        { id: 1n, limit: 1n, used: 0n, periodStart: 0, periodLength: 1 },
      ],
    }),
    relationships: Array.from({ length: count }, (_, i) =>
      rel({ id: BigInt(i + 1), buyer: party(i), status: "active" }),
    ),
    invoices: Array.from({ length: count }, (_, i) =>
      invoice({
        id: BigInt(100 + i),
        relationshipId: BigInt(i + 1),
        buyer: party(i),
      }),
    ),
  });
};

const overlapping = (positions: readonly XY[]) =>
  positions.flatMap((a, i) =>
    positions
      .slice(i + 1)
      .filter(
        (b) =>
          Math.abs(a.x - b.x) < FOOTPRINT.width &&
          Math.abs(a.y - b.y) < FOOTPRINT.height,
      ),
  ).length;

const sellerWithInvoice = state({
  account: account({ route: [{ kind: "vault", target: VAULT, bps: 10_000 }] }),
  relationships: [rel({ status: "active" })],
  invoices: [invoice({ status: "approved" })],
});

describe("layout: positions and placement", () => {
  test("a first load takes every node at the graph's own position", () => {
    const graph = graphOf(sellerWithInvoice);
    const layout = reconcile(EMPTY_LAYOUT, graph, ROOT);

    for (const n of graph.nodes)
      expect(layout.positions[n.id]).toEqual(n.position);
    expect(layout.children).toEqual([]);
  });

  test("nothing new returns the same layout object, so callers skip the write", () => {
    const graph = graphOf(sellerWithInvoice);
    const layout = reconcile(EMPTY_LAYOUT, graph, ROOT);

    expect(reconcile(layout, graph, ROOT)).toBe(layout);
  });

  test("a canvas with 32 counterparties lays out with no two nodes on top of each other", () => {
    const graph = graphOf(big(32));
    const layout = reconcile(EMPTY_LAYOUT, graph, ROOT);

    expect(graph.nodes.length).toBeGreaterThan(64);
    expect(
      overlapping(graph.nodes.map((n) => layout.positions[n.id] ?? n.position)),
    ).toBe(0);
  });

  test("a new node lands next to its neighbour where the user dragged it, not on top of another node", () => {
    const before = graphOf(
      state({ relationships: [rel({ status: "active" })] }),
    );
    const dragged = setPositions(reconcile(EMPTY_LAYOUT, before, ROOT), {
      [nodeId.counterparty(1n)]: { x: 2000, y: 2000 },
    });
    const after = graphOf(
      state({
        relationships: [rel({ status: "active" })],
        invoices: [invoice()],
      }),
    );
    const layout = reconcile(dragged, after, ROOT);
    const inv = layout.positions[nodeId.invoice(7n)];
    const party = layout.positions[nodeId.counterparty(1n)];

    expect(inv).toBeDefined();
    expect(Math.abs((inv?.x ?? 0) - (party?.x ?? 0))).toBeLessThan(400);
    expect(overlapping(Object.values(layout.positions))).toBe(0);
  });

  test("new nodes keep clear of nodes the user already placed", () => {
    const graph = graphOf(big(3));
    const crowded = setPositions(
      reconcile(EMPTY_LAYOUT, graphOf(big(2)), ROOT),
      {
        [nodeId.account]: { x: 1044, y: 240 + 2 * 340 },
      },
    );
    const layout = reconcile(crowded, graph, ROOT);

    expect(
      overlapping(graph.nodes.map((n) => layout.positions[n.id] ?? n.position)),
    ).toBe(0);
  });
});

describe("layout: child canvases", () => {
  const graph = graphOf(sellerWithInvoice);
  const base = reconcile(EMPTY_LAYOUT, graph, ROOT);
  const picked = [nodeId.counterparty(1n), nodeId.invoice(7n), nodeId.account];

  test("depth is one level, held in a constant", () => {
    expect(MAX_CANVAS_DEPTH).toBe(1);
  });

  test("moving nodes into a child leaves the Account on the root and puts a gate in their place", () => {
    const result = moveToChild(base, picked, ROOT, {
      kind: "new",
      id: "child-1",
      name: "Club",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.child).toBe("child-1");
    expect(levelOf(result.layout, nodeId.account)).toBe(ROOT);
    expect(levelOf(result.layout, nodeId.invoice(7n))).toBe("child-1");
    expect(result.layout.positions["child-1"]).toBeDefined();
    const root = buildView(graph, result.layout, ROOT);

    expect(root.nodes.map((n) => n.id)).not.toContain(nodeId.invoice(7n));
    expect(root.nodes.find((n) => n.id === "child-1")?.data).toMatchObject({
      kind: "gate",
      gate: { name: "Club", nodeCount: 2 },
    });
  });

  test("only the Account selected cannot make a child canvas", () => {
    const result = moveToChild(base, [nodeId.account], ROOT, {
      kind: "new",
      id: "child-1",
      name: "x",
    });

    expect(result).toEqual({
      ok: false,
      reason: "The Account stays on the root canvas",
    });
  });

  test("a child canvas cannot hold another child canvas", () => {
    const first = moveToChild(base, [nodeId.invoice(7n)], ROOT, {
      kind: "new",
      id: "child-1",
      name: "A",
    });

    if (!first.ok) throw new Error(first.reason);
    expect(
      moveToChild(first.layout, [nodeId.split], "child-1", {
        kind: "new",
        id: "child-2",
        name: "B",
      }),
    ).toEqual({ ok: false, reason: DEPTH_REASON });
    expect(
      moveToChild(first.layout, ["child-1", nodeId.split], ROOT, {
        kind: "new",
        id: "child-2",
        name: "B",
      }).ok,
    ).toBe(false);
  });

  test("a new child canvas keeps its id when the move is replayed on a newer layout (save conflict)", () => {
    const id = newChildId();
    const move = { kind: "new", id, name: "Events" } as const;
    const local = moveToChild(base, picked, ROOT, move);

    if (!local.ok) throw new Error(local.reason);
    // Another browser saved first: it added a child of its own, so the edit replays on its layout.
    const theirs = moveToChild(base, [nodeId.split], ROOT, {
      kind: "new",
      id: newChildId(),
      name: "Theirs",
    });

    if (!theirs.ok) throw new Error(theirs.reason);
    const replayed = moveToChild(theirs.layout, picked, ROOT, move);

    if (!replayed.ok) throw new Error(replayed.reason);
    expect(replayed.child).toBe(local.child);
    expect(childOf(replayed.layout, id)?.nodeIds).toEqual(
      childOf(local.layout, id)?.nodeIds,
    );
    expect(replayed.layout.children).toHaveLength(2);
  });

  test("applying a new-child move twice with the same id changes nothing", () => {
    const move = { kind: "new", id: newChildId(), name: "Events" } as const;
    const once = moveToChild(base, picked, ROOT, move);

    if (!once.ok) throw new Error(once.reason);
    const twice = moveToChild(once.layout, picked, ROOT, move);

    expect(twice).toEqual(once);
  });

  test("child ids are unique per browser and fit the API's child-<12 digits>", () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => newChildId()));

    expect(ids.size).toBe(1_000);
    for (const id of ids) expect(id).toMatch(/^child-\d{12}$/);
  });

  test("dissolve moves the nodes back to the root with no overlaps and removes the gate", () => {
    const moved = moveToChild(base, picked, ROOT, {
      kind: "new",
      id: "child-1",
      name: "Club",
    });

    if (!moved.ok) throw new Error(moved.reason);
    const back = dissolve(moved.layout, moved.child);

    expect(back.children).toEqual([]);
    expect(back.positions["child-1"]).toBeUndefined();
    expect(levelOf(back, nodeId.invoice(7n))).toBe(ROOT);
    expect(
      overlapping(graph.nodes.map((n) => back.positions[n.id] ?? n.position)),
    ).toBe(0);
  });

  test("move to parent takes one node out of its child canvas", () => {
    const moved = moveToChild(base, picked, ROOT, {
      kind: "new",
      id: "child-1",
      name: "Club",
    });

    if (!moved.ok) throw new Error(moved.reason);
    const out = moveToParent(moved.layout, [nodeId.invoice(7n)]);

    expect(levelOf(out, nodeId.invoice(7n))).toBe(ROOT);
    expect(levelOf(out, nodeId.counterparty(1n))).toBe("child-1");
  });

  test("a node created while a child canvas is open lands in that child", () => {
    const moved = moveToChild(base, [nodeId.counterparty(1n)], ROOT, {
      kind: "new",
      id: "child-1",
      name: "Club",
    });

    if (!moved.ok) throw new Error(moved.reason);
    const grown = graphOf(
      state({
        ...sellerWithInvoice,
        relationships: [
          rel({ status: "active" }),
          rel({ id: 2n, status: "proposed" }),
        ],
      }),
    );
    const layout = reconcile(moved.layout, grown, "child-1");

    expect(levelOf(layout, nodeId.counterparty(2n))).toBe("child-1");
  });

  test("on the root, a new node follows its only neighbour into that neighbour's child canvas", () => {
    const moved = moveToChild(base, [nodeId.invoice(7n)], ROOT, {
      kind: "new",
      id: "child-1",
      name: "Inv",
    });

    if (!moved.ok) throw new Error(moved.reason);
    const buyer = state({
      relationships: [rel({ buyer: ME, seller: CLUB, status: "active" })],
      invoices: [
        invoice({
          buyer: ME,
          seller: CLUB,
          status: "approved",
          escrowed: 5_000_000_000n,
        }),
      ],
    });
    const layout = reconcile(moved.layout, graphOf(buyer), ROOT);

    expect(levelOf(layout, nodeId.escrow(7n))).toBe("child-1");
  });
});

describe("gate ports from crossing edges", () => {
  const inside = (ids: string[]) => (id: string) => ids.includes(id);

  test("money into the child is Inflow, out of it is Outflow, and a reference is a Link", () => {
    expect(
      classifyCrossing(
        { source: nodeId.account, target: "budget-1", flow: "money" },
        inside(["budget-1"]),
      ),
    ).toBe("inflow");
    expect(
      classifyCrossing(
        { source: "invoice-7", target: nodeId.split, flow: "money" },
        inside(["invoice-7"]),
      ),
    ).toBe("outflow");
    expect(
      classifyCrossing(
        { source: "rel-1", target: "invoice-7", flow: "link" },
        inside(["invoice-7"]),
      ),
    ).toBe("link");
    expect(
      classifyCrossing(
        { source: "rel-1", target: "invoice-7", flow: "link" },
        inside(["rel-1", "invoice-7"]),
      ),
    ).toBeUndefined();
  });

  test("the parent re-points crossing edges at the gate's port handles", () => {
    const graph = graphOf(sellerWithInvoice);
    const moved = moveToChild(
      reconcile(EMPTY_LAYOUT, graph, ROOT),
      [nodeId.invoice(7n)],
      ROOT,
      {
        kind: "new",
        id: "child-1",
        name: "Inv",
      },
    );

    if (!moved.ok) throw new Error(moved.reason);
    const root = buildView(graph, moved.layout, ROOT);
    const gate = root.nodes.find((n) => n.id === "child-1");

    expect(gate?.data).toMatchObject({
      gate: { ports: { outflow: 1, link: 1, inflow: 0 } },
    });
    expect(root.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "child-1",
          target: nodeId.split,
          sourceHandle: "outflow",
          label: "Outflow",
        }),
        expect.objectContaining({
          source: nodeId.counterparty(1n),
          target: "child-1",
          targetHandle: "link-in",
          label: "Link",
        }),
      ]),
    );
  });

  test("inside the child, each crossing edge ends on a port at the edge of the view", () => {
    const graph = graphOf(sellerWithInvoice);
    const base = reconcile(EMPTY_LAYOUT, graph, ROOT);
    const moved = moveToChild(base, [nodeId.invoice(7n)], ROOT, {
      kind: "new",
      id: "child-1",
      name: "Inv",
    });

    if (!moved.ok) throw new Error(moved.reason);
    const view = buildView(graph, moved.layout, "child-1");
    const ports = view.nodes.filter((n) => n.data.kind === "port");
    const invoiceAt = base.positions[nodeId.invoice(7n)] ?? { x: 0, y: 0 };

    expect(ports.map((p) => p.data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          port: "outflow",
          target: nodeId.split,
          label: "Split",
        }),
        expect.objectContaining({
          port: "link",
          target: nodeId.counterparty(1n),
        }),
      ]),
    );
    const outflow = ports.find((p) => p.id === `port:outflow:${nodeId.split}`);

    expect(outflow?.position.x).toBeGreaterThan(invoiceAt.x);
    expect(
      view.edges.every((e) => view.nodes.some((n) => n.id === e.source)),
    ).toBe(true);
    expect(
      view.edges.every((e) => view.nodes.some((n) => n.id === e.target)),
    ).toBe(true);
  });

  test("the gate sums money in and out from its invoices", () => {
    const paid = state({
      relationships: [rel({ status: "active" })],
      invoices: [
        invoice({
          status: "approved",
          owner: POOL,
          advance: { principal: 4_000n, fee: 50n, fundedAt: 0 },
        }),
      ],
      routed: [
        {
          key: "a",
          timestamp: 0,
          invoiceId: 7n,
          amount: 1_000n,
          legAmounts: [],
        },
      ],
    });
    const graph = graphOf(paid);
    const moved = moveToChild(
      reconcile(EMPTY_LAYOUT, graph, ROOT),
      [nodeId.invoice(7n)],
      ROOT,
      {
        kind: "new",
        id: "child-1",
        name: "Inv",
      },
    );

    if (!moved.ok) throw new Error(moved.reason);
    const gate = buildView(graph, moved.layout, ROOT, paid.routed).nodes.find(
      (n) => n.id === "child-1",
    );

    expect(gate?.data).toMatchObject({
      gate: { moneyIn: 4_950n, moneyOut: 0n },
    });
  });
});

describe("layout storage", () => {
  test("the key is versioned and scoped to chain and account", () => {
    expect(layoutStorageKey(43114, "0xAbC")).toBe(
      "zal.canvas-layout.v1:43114:0xabc",
    );
  });

  test("a stored layout round-trips, and anything unreadable is empty", () => {
    const layout: CanvasLayout = {
      positions: { account: { x: 1, y: 2 }, "child-1": { x: 3, y: 4 } },
      children: [{ id: "child-1", name: "Club", nodeIds: ["rel-1"] }],
      drafts: [],
      links: [],
    };

    expect(parseStoredLayout(serializeLayout(layout))).toEqual(layout);
    expect(parseStoredLayout(null)).toEqual(EMPTY_LAYOUT);
    expect(parseStoredLayout("{not json")).toEqual(EMPTY_LAYOUT);
    expect(
      parseStoredLayout(JSON.stringify({ version: 0, ...layout })),
    ).toEqual(EMPTY_LAYOUT);
  });
});

describe("drafts (presentation only)", () => {
  const s = state({ relationships: [rel({ status: "active" })] });
  const graph = graphOf(s);
  const base = reconcile(EMPTY_LAYOUT, graph, ROOT);

  test("a draft lands exactly where it is dropped and draws as a draft node", () => {
    const { layout, id } = addDraft(base, "escrow", { x: 913, y: -47 }, ROOT);

    expect(id).toMatch(/^draft-\d{1,15}$/);
    expect(layout.positions[id]).toEqual({ x: 913, y: -47 });
    expect(buildView(graph, layout, ROOT).nodes).toContainEqual({
      id,
      position: { x: 913, y: -47 },
      data: { kind: "draft", draft: { id, component: "escrow" } },
    });
  });

  test("a draft dropped inside a child canvas stays on that canvas", () => {
    const grouped = moveToChild(base, [nodeId.counterparty(1n)], ROOT, {
      kind: "new",
      id: "child-1",
      name: "Club",
    });

    if (!grouped.ok) throw new Error(grouped.reason);
    const { layout, id } = addDraft(
      grouped.layout,
      "invoice",
      { x: 0, y: 0 },
      grouped.child,
    );

    expect(levelOf(layout, id)).toBe(grouped.child);
    expect(buildView(graph, layout, ROOT).nodes.map((n) => n.id)).not.toContain(
      id,
    );
    expect(
      buildView(graph, layout, grouped.child).nodes.map((n) => n.id),
    ).toContain(id);
  });

  test("a draft link draws dashed between its ends until it settles", () => {
    const placed = addDraft(base, "counterparty", { x: 50, y: 400 }, ROOT);
    const linked = addLink(placed.layout, nodeId.account, placed.id);
    const edge = buildView(graph, linked.layout, ROOT).edges.find(
      (e) => e.id === linked.id,
    );

    expect(edge).toMatchObject({
      source: nodeId.account,
      target: placed.id,
      ghost: true,
      draft: true,
    });
    // Drawing the same connection again replaces it rather than doubling it.
    expect(
      addLink(linked.layout, placed.id, nodeId.account).layout.links,
    ).toHaveLength(1);
  });

  test("settling a link removes it and its draft; a known landing node takes the draft's place", () => {
    const placed = addDraft(base, "escrow", { x: 700, y: 700 }, ROOT);
    const linked = addLink(
      placed.layout,
      nodeId.invoice(7n),
      placed.id,
      nodeId.escrow(7n),
    );
    const settled = settleLink(linked.layout, linked.id);

    expect(settled.drafts).toEqual([]);
    expect(settled.links).toEqual([]);
    expect(settled.positions[placed.id]).toBeUndefined();
    expect(settled.positions[nodeId.escrow(7n)]).toEqual({ x: 700, y: 700 });
  });

  test("deleting a draft deletes the links that touch it, and only drafts can be deleted", () => {
    const placed = addDraft(base, "budget", { x: 0, y: 600 }, ROOT);
    const linked = addLink(placed.layout, nodeId.account, placed.id);
    const removed = removeDrafts(linked.layout, [placed.id, nodeId.account]);

    expect(removed.drafts).toEqual([]);
    expect(removed.links).toEqual([]);
    expect(removed.positions[nodeId.account]).toEqual(
      base.positions[nodeId.account],
    );
  });

  test("new chain nodes are placed around drafts, not on top of them", () => {
    const at = { x: 1_000, y: 1_000 };
    const placed = addDraft(EMPTY_LAYOUT, "vault", at, ROOT);
    const layout = reconcile(
      placed.layout,
      {
        nodes: [{ id: "x", position: at, data: graph.nodes[0]!.data }],
        edges: [],
      },
      ROOT,
    );

    expect(layout.positions.x).not.toEqual(at);
  });

  test("drafts and links survive storage, and a layout saved before drafts reads with none", () => {
    const placed = addDraft(base, "pool", { x: 1, y: 2 }, ROOT);
    const linked = addLink(
      placed.layout,
      nodeId.invoice(7n),
      placed.id,
      nodeId.pool,
    );

    expect(parseStoredLayout(serializeLayout(linked.layout))).toEqual(
      linked.layout,
    );
    expect(
      parseStoredLayout(
        JSON.stringify({ version: 1, positions: {}, children: [] }),
      ),
    ).toEqual(EMPTY_LAYOUT);
  });
});

describe("the API's limits, checked before a save", () => {
  test("a child canvas name is cut to the API's limit without splitting a character", () => {
    expect(childName(`  ${"x".repeat(200)}  `)).toHaveLength(CHILD_NAME_MAX);
    const emoji = childName(`${"x".repeat(CHILD_NAME_MAX - 1)}😀`);

    expect(emoji).toBe("x".repeat(CHILD_NAME_MAX - 1));
    expect(emoji.isWellFormed()).toBe(true);
    const named = {
      ...EMPTY_LAYOUT,
      children: [{ id: "child-1" as const, name: "Ops", nodeIds: [] }],
    };

    expect(
      renameChild(named, "child-1", "y".repeat(500)).children[0]?.name,
    ).toHaveLength(CHILD_NAME_MAX);
  });

  test("a layout within every limit passes; one past a limit names it", () => {
    expect(layoutProblem(EMPTY_LAYOUT)).toBeUndefined();
    const named = (name: string) => ({
      ...EMPTY_LAYOUT,
      children: [{ id: "child-1" as const, name, nodeIds: [] }],
    });

    expect(layoutProblem(named("x".repeat(CHILD_NAME_MAX)))).toBeUndefined();
    expect(layoutProblem(named("x".repeat(CHILD_NAME_MAX + 1)))).toMatch(
      /children\.0\.name/,
    );
    expect(layoutProblem(named("a\u0000b"))).toBeDefined();
    expect(
      layoutProblem(setPositions(EMPTY_LAYOUT, { a: { x: 1e8, y: 0 } })),
    ).toMatch(/positions/);
    const many = Object.fromEntries(
      Array.from({ length: 2_001 }, (_, i) => [`n${i}`, { x: 0, y: 0 }]),
    );

    expect(layoutProblem(setPositions(EMPTY_LAYOUT, many))).toMatch(
      /2000 positions/,
    );
  });

  test("placing a draft again with the same id changes nothing, so a replay never doubles it", () => {
    const once = addDraft(
      EMPTY_LAYOUT,
      "escrow",
      { x: 1, y: 2 },
      ROOT,
      "draft-7",
    );

    expect(
      addDraft(once.layout, "escrow", { x: 1, y: 2 }, ROOT, "draft-7").layout,
    ).toBe(once.layout);
  });
});
