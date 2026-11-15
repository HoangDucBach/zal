// The canvas layout (ADR 0011): where each node is drawn and which child canvas holds it. Presentation only, kept
// per chain and account in browser storage; losing it loses positions and grouping, never money (ADR 0003).
// Pure, so every rule (depth, the Account staying on the root, gate ports, placement without overlap) is tested
// without a browser.

import type {
  CanvasEdgeSpec,
  CanvasGraph,
  CanvasNodeData,
  CanvasNodeSpec,
  EdgeFlow,
} from "./graph";
import type { PaletteComponent } from "./palette";
import type { RoutedPayment } from "./types";

import { z } from "zod";

import { nodeId, nodeTitle } from "./graph";
import { CATALOGUE } from "./palette";

/** A child canvas cannot hold another child canvas. Raise this to allow deeper nesting. */
export const MAX_CANVAS_DEPTH = 1;

export const ROOT = "root";
export type ChildId = `child-${number}`;
export type CanvasLevel = typeof ROOT | ChildId;

export interface XY {
  readonly x: number;
  readonly y: number;
}

export interface ChildCanvas {
  readonly id: ChildId;
  readonly name: string;
  readonly nodeIds: readonly string[];
}

export type DraftId = `draft-${number}`;

/** A component placed from the palette that is not on-chain yet. Presentation only, like the rest of the layout. */
export interface Draft {
  readonly id: DraftId;
  readonly component: PaletteComponent;
}

/**
 * A connection the user drew that exists on-chain only once its transaction confirms. Its ends are node or draft
 * ids. `lands` is the node the transaction creates, when that id is known ahead (an Escrow, a Schedule, the Vault):
 * it takes the draft's place.
 */
export interface DraftLink {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly lands?: string;
}

export interface CanvasLayout {
  /** Node and draft positions, and each child canvas's gate position in its parent under the child's id. */
  readonly positions: Readonly<Record<string, XY>>;
  readonly children: readonly ChildCanvas[];
  readonly drafts: readonly Draft[];
  readonly links: readonly DraftLink[];
}

export const EMPTY_LAYOUT: CanvasLayout = {
  positions: {},
  children: [],
  drafts: [],
  links: [],
};

export const isChildId = (id: string): id is ChildId => /^child-\d+$/.test(id);

export const isDraftId = (id: string): id is DraftId => /^draft-\d+$/.test(id);

export const depthOf = (level: CanvasLevel): number => (level === ROOT ? 0 : 1);

export const childOf = (
  layout: CanvasLayout,
  id: ChildId,
): ChildCanvas | undefined => layout.children.find((c) => c.id === id);

/** The canvas a node is drawn on. Gates live on the root. */
export function levelOf(layout: CanvasLayout, id: string): CanvasLevel {
  return layout.children.find((c) => c.nodeIds.includes(id))?.id ?? ROOT;
}

/** One compact node card plus a gutter: two nodes closer than this overlap. */
export const FOOTPRINT = { width: 260, height: 130 } as const;

const overlaps = (a: XY, b: XY) =>
  Math.abs(a.x - b.x) < FOOTPRINT.width &&
  Math.abs(a.y - b.y) < FOOTPRINT.height;

/** The free spot nearest to `desired`, searched in rings of half a footprint. */
export function placeFree(desired: XY, occupied: readonly XY[]): XY {
  if (!occupied.some((o) => overlaps(desired, o))) return desired;
  const stepX = FOOTPRINT.width / 2;
  const stepY = FOOTPRINT.height / 2;

  for (let ring = 1; ring < 400; ring++) {
    const candidates: XY[] = [];

    for (let dx = -ring; dx <= ring; dx++)
      for (let dy = -ring; dy <= ring; dy++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring)
          candidates.push({
            x: desired.x + dx * stepX,
            y: desired.y + dy * stepY,
          });
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - desired.x, a.y - desired.y) -
          Math.hypot(b.x - desired.x, b.y - desired.y) ||
        a.y - b.y ||
        a.x - b.x,
    );
    const free = candidates.find((c) => !occupied.some((o) => overlaps(c, o)));

    if (free !== undefined) return free;
  }

  return desired;
}

/** Who sits on `level`: its nodes that the graph still draws, and on the root the gates too. */
function occupants(
  layout: CanvasLayout,
  level: CanvasLevel,
  present: ReadonlySet<string>,
  except: ReadonlySet<string> = new Set(),
): XY[] {
  const ids =
    level === ROOT
      ? [
          ...[...present].filter((id) => levelOf(layout, id) === ROOT),
          ...layout.children.map((c) => c.id),
        ]
      : (childOf(layout, level)?.nodeIds ?? []).filter((id) => present.has(id));

  return ids.flatMap((id) => {
    const at = layout.positions[id];

    return at === undefined || except.has(id) ? [] : [at];
  });
}

function neighboursOf(edges: readonly CanvasEdgeSpec[], id: string): string[] {
  return edges.flatMap((e) =>
    e.source === id ? [e.target] : e.target === id ? [e.source] : [],
  );
}

/**
 * Gives every node the layout has not seen a canvas and a position. A new node joins the open child canvas; on the
 * root it follows its neighbours into a child when they all sit in one. It lands where the graph would put it
 * relative to a placed neighbour on the same canvas, moved to the nearest free spot. Returns `layout` itself when
 * nothing is new, so callers can skip a write.
 */
export function reconcile(
  layout: CanvasLayout,
  graph: Pick<CanvasGraph, "nodes" | "edges">,
  open: CanvasLevel,
): CanvasLayout {
  const unknown = graph.nodes.filter(
    (n) => layout.positions[n.id] === undefined,
  );

  if (unknown.length === 0) return layout;
  const present = new Set([
    ...graph.nodes.map((n) => n.id),
    ...layout.drafts.map((d) => d.id),
  ]);
  const specAt = new Map(graph.nodes.map((n) => [n.id, n.position]));
  let next: CanvasLayout = layout;
  const openChild = open === ROOT ? undefined : childOf(layout, open);

  for (const spec of unknown) {
    const placed = neighboursOf(graph.edges, spec.id).filter(
      (id) => next.positions[id] !== undefined && present.has(id),
    );
    const levels = new Set(placed.map((id) => levelOf(next, id)));
    const [only] = levels;
    const level: CanvasLevel =
      spec.id === nodeId.account
        ? ROOT
        : openChild !== undefined
          ? openChild.id
          : levels.size === 1 && only !== undefined
            ? only
            : ROOT;
    const anchor = placed.find((id) => levelOf(next, id) === level);
    const anchorAt = anchor === undefined ? undefined : next.positions[anchor];
    const anchorSpec = anchor === undefined ? undefined : specAt.get(anchor);
    const desired =
      anchorAt === undefined || anchorSpec === undefined
        ? spec.position
        : {
            x: anchorAt.x + spec.position.x - anchorSpec.x,
            y: anchorAt.y + spec.position.y - anchorSpec.y,
          };
    const at = placeFree(desired, occupants(next, level, present));

    next = {
      ...next,
      positions: { ...next.positions, [spec.id]: at },
      children:
        level === ROOT
          ? next.children
          : next.children.map((c) =>
              c.id === level ? { ...c, nodeIds: [...c.nodeIds, spec.id] } : c,
            ),
    };
  }

  return next;
}

export type LayoutResult =
  | {
      readonly ok: true;
      readonly layout: CanvasLayout;
      readonly child: ChildId;
    }
  | { readonly ok: false; readonly reason: string };

const fail = (reason: string): LayoutResult => ({ ok: false, reason });

export const DEPTH_REASON = "Child canvases are one level deep";

/** The longest child canvas name the API stores, in UTF-16 code units. */
export const CHILD_NAME_MAX = 120;

/** `name` trimmed and cut to `CHILD_NAME_MAX`, never splitting a surrogate pair. */
export function childName(name: string): string {
  const cut = name.trim().slice(0, CHILD_NAME_MAX);
  const last = cut.charCodeAt(cut.length - 1);

  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * A child canvas id no other browser picks: 12 random digits, the API's limit. Like a draft id, it is chosen once,
 * before the edit, so an edit replayed on a newer layout (a save conflict) creates the same child and the
 * selection still points at it.
 */
export function newChildId(): ChildId {
  return `child-${1e11 + Math.floor(Math.random() * 9e11)}`;
}

/** Why `nodeIds` cannot move into a new child canvas from `from`, or `undefined` when they can. */
export function cannotGroup(
  nodeIds: readonly string[],
  from: CanvasLevel,
): string | undefined {
  if (depthOf(from) + 1 > MAX_CANVAS_DEPTH) return DEPTH_REASON;
  if (nodeIds.some(isChildId)) return "Child canvases are one level deep";
  const movable = nodeIds.filter((id) => id !== nodeId.account);

  if (movable.length === 0)
    return nodeIds.length === 0
      ? "Select nodes first"
      : "The Account stays on the root canvas";

  return undefined;
}

const centroid = (points: readonly XY[]): XY =>
  points.length === 0
    ? { x: 0, y: 0 }
    : {
        x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
      };

/**
 * Moves nodes into a new child canvas (`name` given) or an existing one. The Account is left out and stays on the
 * root. A new child's gate takes the moved nodes' place in the parent. Applying a "new" move again with the same
 * `id` changes nothing: the child exists, and the nodes are already in it.
 */
export function moveToChild(
  layout: CanvasLayout,
  nodeIds: readonly string[],
  from: CanvasLevel,
  requested:
    | { readonly kind: "new"; readonly id: ChildId; readonly name: string }
    | { readonly kind: "existing"; readonly id: ChildId },
): LayoutResult {
  const target =
    requested.kind === "new" && childOf(layout, requested.id) !== undefined
      ? ({ kind: "existing", id: requested.id } as const)
      : requested;

  if (target.kind === "new") {
    const reason = cannotGroup(nodeIds, from);

    if (reason !== undefined) return fail(reason);
  } else if (childOf(layout, target.id) === undefined) {
    return fail("Child canvas no longer exists");
  } else if (nodeIds.some(isChildId)) {
    return fail("Child canvases are one level deep");
  }
  const moving = [
    ...new Set(nodeIds.filter((id) => id !== nodeId.account && !isChildId(id))),
  ];

  if (moving.length === 0) return fail("The Account stays on the root canvas");
  const id = target.id;
  const without = layout.children.map((c) =>
    c.id === id
      ? c
      : { ...c, nodeIds: c.nodeIds.filter((n) => !moving.includes(n)) },
  );
  const children: ChildCanvas[] =
    target.kind === "new"
      ? [
          ...without,
          {
            id,
            name: childName(target.name) || suggestChildName(layout, []),
            nodeIds: moving,
          },
        ]
      : without.map((c) =>
          c.id === id
            ? {
                ...c,
                nodeIds: [
                  ...c.nodeIds,
                  ...moving.filter((n) => !c.nodeIds.includes(n)),
                ],
              }
            : c,
        );
  let positions = layout.positions;

  if (target.kind === "new" && from === ROOT) {
    const moved = moving.flatMap((n) => {
      const at = layout.positions[n];

      return at === undefined ? [] : [at];
    });
    const rest = Object.entries(layout.positions)
      .filter(
        ([n]) =>
          !moving.includes(n) &&
          (isChildId(n) || !children.some((c) => c.nodeIds.includes(n))),
      )
      .map(([, at]) => at);

    positions = { ...positions, [id]: placeFree(centroid(moved), rest) };
  }

  return { ok: true, layout: { ...layout, positions, children }, child: id };
}

/** Puts nodes back on the root canvas, each at the nearest free spot to where it was. */
function returnToRoot(
  layout: CanvasLayout,
  nodeIds: readonly string[],
): CanvasLayout {
  const children = layout.children.map((c) => ({
    ...c,
    nodeIds: c.nodeIds.filter((n) => !nodeIds.includes(n)),
  }));
  const positions: Record<string, XY> = { ...layout.positions };
  const rootIds = Object.keys(positions).filter(
    (n) => !nodeIds.includes(n) && !children.some((c) => c.nodeIds.includes(n)),
  );
  const occupied = rootIds.flatMap((n) => {
    const at = positions[n];

    return at === undefined ? [] : [at];
  });

  for (const n of nodeIds) {
    const at = positions[n];

    if (at === undefined) continue;
    const free = placeFree(at, occupied);

    positions[n] = free;
    occupied.push(free);
  }

  return { ...layout, positions, children };
}

export function moveToParent(
  layout: CanvasLayout,
  nodeIds: readonly string[],
): CanvasLayout {
  return returnToRoot(
    layout,
    nodeIds.filter((n) => levelOf(layout, n) !== ROOT),
  );
}

/** Removes a child canvas and moves its nodes back to the parent. */
export function dissolve(layout: CanvasLayout, id: ChildId): CanvasLayout {
  const child = childOf(layout, id);

  if (child === undefined) return layout;
  const positions = Object.fromEntries(
    Object.entries(layout.positions).filter(([n]) => n !== id),
  );
  const back = returnToRoot({ ...layout, positions }, child.nodeIds);

  return { ...back, children: back.children.filter((c) => c.id !== id) };
}

export function renameChild(
  layout: CanvasLayout,
  id: ChildId,
  name: string,
): CanvasLayout {
  const trimmed = childName(name);

  return trimmed === ""
    ? layout
    : {
        ...layout,
        children: layout.children.map((c) =>
          c.id === id ? { ...c, name: trimmed } : c,
        ),
      };
}

export function setPositions(
  layout: CanvasLayout,
  moved: Readonly<Record<string, XY>>,
): CanvasLayout {
  return { ...layout, positions: { ...layout.positions, ...moved } };
}

// ---- Drafts and draft links ------------------------------------------------------------------------------------

/**
 * A draft id no other browser picks: milliseconds and two random digits (15 digits, the API's limit). Ids are not
 * numbered from the layout, because an edit replayed on a newer layout (a save conflict) must keep its id: the
 * selection, a link drawn from the draft, and later moves all refer to it.
 */
export function newDraftId(): DraftId {
  return `draft-${Date.now() * 100 + Math.floor(Math.random() * 100)}`;
}

/** Places a draft exactly at `at` on `level`. Applying it again with the same `id` changes nothing. */
export function addDraft(
  layout: CanvasLayout,
  component: PaletteComponent,
  at: XY,
  level: CanvasLevel,
  id: DraftId = newDraftId(),
): { readonly layout: CanvasLayout; readonly id: DraftId } {
  if (layout.drafts.some((d) => d.id === id)) return { layout, id };

  return {
    id,
    layout: {
      ...layout,
      positions: { ...layout.positions, [id]: at },
      drafts: [...layout.drafts, { id, component }],
      children:
        level === ROOT
          ? layout.children
          : layout.children.map((c) =>
              c.id === level ? { ...c, nodeIds: [...c.nodeIds, id] } : c,
            ),
    },
  };
}

/** Deletes drafts and draft links by id, with every link that touches a deleted draft. Other ids are ignored. */
export function removeDrafts(
  layout: CanvasLayout,
  ids: readonly string[],
): CanvasLayout {
  const gone = new Set(
    ids.filter((id) => layout.drafts.some((d) => d.id === id)),
  );
  const links = layout.links.filter(
    (l) => !ids.includes(l.id) && !gone.has(l.source) && !gone.has(l.target),
  );

  if (gone.size === 0 && links.length === layout.links.length) return layout;

  return {
    positions: Object.fromEntries(
      Object.entries(layout.positions).filter(([id]) => !gone.has(id)),
    ),
    children: layout.children.map((c) => ({
      ...c,
      nodeIds: c.nodeIds.filter((id) => !gone.has(id)),
    })),
    drafts: layout.drafts.filter((d) => !gone.has(d.id)),
    links,
  };
}

/** Records a drawn connection, replacing an earlier one between the same two ends. */
export function addLink(
  layout: CanvasLayout,
  source: string,
  target: string,
  lands?: string,
): { readonly layout: CanvasLayout; readonly id: string } {
  const id = `link:${source}->${target}`;
  const same = (l: DraftLink) =>
    (l.source === source && l.target === target) ||
    (l.source === target && l.target === source);

  return {
    id,
    layout: {
      ...layout,
      links: [
        ...layout.links.filter((l) => !same(l)),
        lands === undefined
          ? { id, source, target }
          : { id, source, target, lands },
      ],
    },
  };
}

/**
 * The link's transaction confirmed: the chain draws the connection now (ADR 0003), so the link and its draft end
 * go. The node it `lands` as takes the draft's place and canvas.
 */
export function settleLink(layout: CanvasLayout, linkId: string): CanvasLayout {
  const link = layout.links.find((l) => l.id === linkId);

  if (link === undefined) return layout;
  const draft = [link.source, link.target].find((id) =>
    layout.drafts.some((d) => d.id === id),
  );
  const rest = removeDrafts(
    layout,
    draft === undefined ? [linkId] : [linkId, draft],
  );
  const at = draft === undefined ? undefined : layout.positions[draft];

  if (link.lands === undefined || at === undefined || draft === undefined)
    return rest;
  const level = levelOf(layout, draft);
  const lands = link.lands;

  return {
    ...rest,
    positions: { ...rest.positions, [lands]: at },
    children: rest.children.map((c) => {
      const without = c.nodeIds.filter((id) => id !== lands);

      return { ...c, nodeIds: c.id === level ? [...without, lands] : without };
    }),
  };
}

/** A name for a new child canvas: the counterparty it holds, else the next free "Canvas n". */
export function suggestChildName(
  layout: CanvasLayout,
  data: readonly CanvasNodeData[],
): string {
  const parties = data.flatMap((d) =>
    d.kind === "counterparty" ? [nodeTitle(d)] : [],
  );

  if (parties.length === 1 && parties[0] !== undefined) return parties[0];
  const taken = new Set(layout.children.map((c) => c.name));
  let n = layout.children.length + 1;

  while (taken.has(`Canvas ${n}`)) n += 1;

  return `Canvas ${n}`;
}

// ---- Gates and gate ports -------------------------------------------------------------------------------------

/** How an edge crosses a child canvas's boundary (ADR 0011). */
export type GatePort = "inflow" | "outflow" | "link";
export const GATE_PORTS: readonly GatePort[] = ["inflow", "outflow", "link"];

/** `undefined` when the edge does not cross: both ends inside, or both outside. */
export function classifyCrossing(
  edge: {
    readonly source: string;
    readonly target: string;
    readonly flow: EdgeFlow;
  },
  inside: (id: string) => boolean,
): GatePort | undefined {
  const source = inside(edge.source);

  if (source === inside(edge.target)) return undefined;
  if (edge.flow === "link") return "link";

  return source ? "outflow" : "inflow";
}

export interface GateSummary {
  readonly id: ChildId;
  readonly name: string;
  /** Nodes inside that the graph still draws. */
  readonly nodeCount: number;
  /** Money into this account through the child's invoices: Split payments and pool advances, base units. */
  readonly moneyIn: bigint;
  /** Money out of this account through the child's invoices: invoices it paid as buyer, base units. */
  readonly moneyOut: bigint;
  /** Inbox items inside. */
  readonly waiting: number;
  readonly ports: Readonly<Record<GatePort, number>>;
}

// A type alias, not an interface, so it is assignable to xyflow's `Record<string, unknown>` node data.
export type PortData = {
  readonly kind: "port";
  readonly port: GatePort;
  /** The node outside the child canvas this port stands for. */
  readonly target: string;
  readonly label: string;
  /** Where `target` is drawn: the root, or another child canvas. */
  readonly targetLevel: CanvasLevel;
};

export type ViewNodeData =
  | CanvasNodeData
  | { readonly kind: "gate"; readonly gate: GateSummary }
  | PortData
  | { readonly kind: "draft"; readonly draft: Draft };

export interface ViewNode {
  readonly id: string;
  readonly position: XY;
  readonly data: ViewNodeData;
}

export interface ViewEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly ghost: boolean;
  readonly flow: EdgeFlow;
  /** Set on the end that is a gate or a gate port; the other end picks a side from positions. */
  readonly sourceHandle?: string;
  readonly targetHandle?: string;
  /** A draft link: drawn by the user, not on-chain yet. */
  readonly draft?: boolean;
}

export interface CanvasView {
  readonly level: CanvasLevel;
  readonly nodes: readonly ViewNode[];
  readonly edges: readonly ViewEdge[];
}

export const PORT_LABELS: Record<GatePort, string> = {
  inflow: "Inflow",
  outflow: "Outflow",
  link: "Link",
};

/** Gate and port handle ids, so each port type enters and leaves on its own side. */
export const HANDLE = {
  inflow: "inflow",
  outflow: "outflow",
  linkIn: "link-in",
  linkOut: "link-out",
} as const;

const sourceHandleOf = (flow: EdgeFlow) =>
  flow === "money" ? HANDLE.outflow : HANDLE.linkOut;
const targetHandleOf = (flow: EdgeFlow) =>
  flow === "money" ? HANDLE.inflow : HANDLE.linkIn;

export function gateSummary(
  child: ChildCanvas,
  graph: CanvasGraph,
  routed: readonly RoutedPayment[],
): GateSummary {
  const inside = new Set(child.nodeIds);
  const nodes = graph.nodes.filter((n) => inside.has(n.id));
  let moneyIn = 0n;
  let moneyOut = 0n;

  for (const { data } of nodes) {
    if (data.kind !== "invoice") continue;
    const { invoice, myRole } = data;

    if (myRole === "seller") {
      moneyIn += routed
        .filter((r) => r.invoiceId === invoice.id)
        .reduce((sum, r) => sum + r.amount, 0n);
      if (invoice.advance !== undefined)
        moneyIn += invoice.advance.principal - invoice.advance.fee;
    } else if (invoice.status === "paid") {
      moneyOut += invoice.faceValue;
    }
  }
  const ports: Record<GatePort, number> = { inflow: 0, outflow: 0, link: 0 };

  for (const edge of graph.edges) {
    const port = classifyCrossing(edge, (id) => inside.has(id));

    if (port !== undefined) ports[port]++;
  }

  return {
    id: child.id,
    name: child.name,
    nodeCount: nodes.length,
    moneyIn,
    moneyOut,
    waiting: graph.inbox.filter((id) => inside.has(id)).length,
    ports,
  };
}

const positionOf = (layout: CanvasLayout, spec: CanvasNodeSpec): XY =>
  layout.positions[spec.id] ?? spec.position;

function rootView(
  graph: CanvasGraph,
  layout: CanvasLayout,
  routed: readonly RoutedPayment[],
): CanvasView {
  const rep = (id: string): string => levelOf(layout, id);
  const nodes: ViewNode[] = [
    ...graph.nodes
      .filter((n) => levelOf(layout, n.id) === ROOT)
      .map((n) => ({
        id: n.id,
        position: positionOf(layout, n),
        data: n.data,
      })),
    ...layout.children.map((child) => {
      const inside = graph.nodes.filter((n) => child.nodeIds.includes(n.id));

      return {
        id: child.id,
        position:
          layout.positions[child.id] ??
          centroid(inside.map((n) => positionOf(layout, n))),
        data: {
          kind: "gate" as const,
          gate: gateSummary(child, graph, routed),
        },
      };
    }),
  ];
  const merged = new Map<string, ViewEdge & { readonly count: number }>();

  for (const edge of graph.edges) {
    const source = rep(edge.source) === ROOT ? edge.source : rep(edge.source);
    const target = rep(edge.target) === ROOT ? edge.target : rep(edge.target);

    if (source === target) continue;
    if (source === edge.source && target === edge.target) {
      merged.set(edge.id, { ...edge, count: 1 });
      continue;
    }
    const gate = isChildId(source) ? source : target;
    const port = classifyCrossing(edge, (id) => rep(id) === gate) ?? "link";
    const key = `${source}->${target}:${port}`;
    const previous = merged.get(key);
    const count = (previous?.count ?? 0) + 1;

    merged.set(key, {
      id: `gate:${key}`,
      source,
      target,
      label: `${PORT_LABELS[port]}${count > 1 ? ` ×${count}` : ""}`,
      ghost: (previous?.ghost ?? true) && edge.ghost,
      flow: edge.flow,
      ...(isChildId(source) ? { sourceHandle: sourceHandleOf(edge.flow) } : {}),
      ...(isChildId(target) ? { targetHandle: targetHandleOf(edge.flow) } : {}),
      count,
    });
  }

  return {
    level: ROOT,
    nodes,
    edges: [...merged.values()].map(({ count: _count, ...edge }) => edge),
  };
}

const PORT_GAP = { x: 340, y: 120, row: 200, column: 280 } as const;

function childView(
  graph: CanvasGraph,
  layout: CanvasLayout,
  child: ChildCanvas,
): CanvasView {
  const inside = new Set(child.nodeIds);
  const own = graph.nodes.filter((n) => inside.has(n.id));
  const placed = own.map((n) => ({
    id: n.id,
    position: positionOf(layout, n),
    data: n.data as ViewNodeData,
  }));
  const xs = placed.map((n) => n.position.x);
  const ys = placed.map((n) => n.position.y);
  const box = {
    left: xs.length === 0 ? 0 : Math.min(...xs),
    right: xs.length === 0 ? 0 : Math.max(...xs),
    top: ys.length === 0 ? 0 : Math.min(...ys),
  };
  const dataOf = new Map(graph.nodes.map((n) => [n.id, n.data]));
  const ports = new Map<string, PortData>();
  const edges: ViewEdge[] = [];

  for (const edge of graph.edges) {
    const port = classifyCrossing(edge, (id) => inside.has(id));

    if (port === undefined) {
      if (inside.has(edge.source)) edges.push(edge);
      continue;
    }
    const outside = inside.has(edge.source) ? edge.target : edge.source;
    const portId = `port:${port}:${outside}`;
    const targetLevel = levelOf(layout, outside);
    const outsideData = dataOf.get(outside);
    const name = outsideData === undefined ? outside : nodeTitle(outsideData);
    const where =
      targetLevel === ROOT ? undefined : childOf(layout, targetLevel)?.name;

    ports.set(portId, {
      kind: "port",
      port,
      target: outside,
      label: where === undefined ? name : `${name} (in ${where})`,
      targetLevel,
    });
    edges.push(
      edge.source === outside
        ? {
            ...edge,
            id: `${edge.id}@port`,
            source: portId,
            sourceHandle: sourceHandleOf(edge.flow),
          }
        : {
            ...edge,
            id: `${edge.id}@port`,
            target: portId,
            targetHandle: targetHandleOf(edge.flow),
          },
    );
  }
  const counter: Record<GatePort, number> = { inflow: 0, outflow: 0, link: 0 };
  const portNodes: ViewNode[] = [...ports.entries()].map(([id, data]) => {
    const index = counter[data.port]++;
    const position =
      data.port === "inflow"
        ? { x: box.left - PORT_GAP.x, y: box.top + index * PORT_GAP.y }
        : data.port === "outflow"
          ? { x: box.right + PORT_GAP.x, y: box.top + index * PORT_GAP.y }
          : {
              x: box.left + index * PORT_GAP.column,
              y: box.top - PORT_GAP.row,
            };

    return { id, position, data };
  });

  return { level: child.id, nodes: [...placed, ...portNodes], edges };
}

/** What one canvas level draws: its own nodes, gates for its children, and gate ports for crossing edges. */
export function buildView(
  graph: CanvasGraph,
  layout: CanvasLayout,
  level: CanvasLevel,
  routed: readonly RoutedPayment[] = [],
): CanvasView {
  const child = level === ROOT ? undefined : childOf(layout, level);
  const view =
    child === undefined
      ? rootView(graph, layout, routed)
      : childView(graph, layout, child);
  const drafts: ViewNode[] = layout.drafts.flatMap((draft) => {
    const at = layout.positions[draft.id];

    return at === undefined || levelOf(layout, draft.id) !== view.level
      ? []
      : [{ id: draft.id, position: at, data: { kind: "draft", draft } }];
  });
  const drawn = new Set([...view.nodes, ...drafts].map((n) => n.id));
  const links: ViewEdge[] = layout.links
    .filter((l) => drawn.has(l.source) && drawn.has(l.target))
    .map((l) => ({
      id: l.id,
      source: l.source,
      target: l.target,
      label: "draft",
      ghost: true,
      flow: "link",
      draft: true,
    }));

  return {
    ...view,
    nodes: [...view.nodes, ...drafts],
    edges: [...view.edges, ...links],
  };
}

// ---- Storage --------------------------------------------------------------------------------------------------

/** Bump when the stored shape changes; an old version is dropped, which only loses presentation. */
export const LAYOUT_VERSION = 1;

export const layoutStorageKey = (chainId: number, account: string): string =>
  `zal.canvas-layout.v${LAYOUT_VERSION}:${chainId}:${account.toLowerCase()}`;

const xySchema = z.object({ x: z.number(), y: z.number() });
const COMPONENTS = CATALOGUE.map((c) => c.component) as [
  PaletteComponent,
  ...PaletteComponent[],
];
const storedSchema = z.object({
  version: z.literal(LAYOUT_VERSION),
  positions: z.record(z.string(), xySchema),
  children: z.array(
    z.object({
      id: z.string().regex(/^child-\d+$/),
      name: z.string(),
      nodeIds: z.array(z.string()),
    }),
  ),
  // Added within version 1: a layout saved before drafts existed reads as having none.
  drafts: z
    .array(
      z.object({
        id: z.string().regex(/^draft-\d+$/),
        component: z.enum(COMPONENTS),
      }),
    )
    .default([]),
  links: z
    .array(
      z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        lands: z.string().optional(),
      }),
    )
    .default([]),
});

/** Text Postgres jsonb can store: no NUL and no lone UTF-16 surrogate. */
const storableText = z
  .string()
  .refine(
    (t) => !t.includes("\u0000") && t.isWellFormed(),
    "has a NUL or a lone surrogate",
  );
const apiId = storableText.min(1).max(128);
const coordinate = z.number().finite().min(-1e7).max(1e7);

/**
 * The limits the API puts on a stored layout (packages/indexer/lib/layout.ts), checked before a save so a layout
 * the API would refuse for good is never queued: the edit that would break one is refused on the spot instead.
 */
const apiLayoutSchema = z.object({
  positions: z
    .record(apiId, z.object({ x: coordinate, y: coordinate }))
    .refine((p) => Object.keys(p).length <= 2_000, "at most 2000 positions"),
  children: z
    .array(
      z.object({
        id: z.string().regex(/^child-\d{1,12}$/),
        name: storableText.max(CHILD_NAME_MAX),
        nodeIds: z.array(apiId).max(2_000),
      }),
    )
    .max(200),
  drafts: z
    .array(z.object({ id: z.string().regex(/^draft-\d{1,15}$/) }))
    .max(500),
  links: z
    .array(
      z.object({
        id: apiId,
        source: apiId,
        target: apiId,
        lands: apiId.optional(),
      }),
    )
    .max(1_000),
});

/** The API's body limit for a layout save. */
export const LAYOUT_MAX_BYTES = 256 * 1024;

/** Why the API would refuse to store `layout`, or `undefined` when it fits every limit. */
export function layoutProblem(layout: CanvasLayout): string | undefined {
  const parsed = apiLayoutSchema.safeParse(layout);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];

    return issue === undefined
      ? "Layout out of limits"
      : `Layout out of limits · ${issue.path.join(".")} ${issue.message}`;
  }
  // The request wraps the layout with its version and revision: a little headroom covers both.
  const bytes = new TextEncoder().encode(serializeLayout(layout)).length;

  return bytes + 64 > LAYOUT_MAX_BYTES
    ? `Layout too large · ${Math.ceil(bytes / 1024)} KB of ${LAYOUT_MAX_BYTES / 1024} KB`
    : undefined;
}

/** A stored layout value (browser storage or the API) to a layout. Anything unreadable is an empty layout. */
export function parseLayout(value: unknown): CanvasLayout {
  const parsed = storedSchema.safeParse(value);

  if (!parsed.success) return EMPTY_LAYOUT;

  return {
    positions: parsed.data.positions,
    children: parsed.data.children.map((c) => ({
      ...c,
      id: c.id as ChildId,
    })),
    drafts: parsed.data.drafts.map((d) => ({ ...d, id: d.id as DraftId })),
    links: parsed.data.links.map(({ lands, ...l }) =>
      lands === undefined ? l : { ...l, lands },
    ),
  };
}

/** Stored JSON to a layout. Anything unreadable is an empty layout. */
export function parseStoredLayout(json: string | null): CanvasLayout {
  if (json === null) return EMPTY_LAYOUT;
  try {
    return parseLayout(JSON.parse(json));
  } catch {
    return EMPTY_LAYOUT;
  }
}

export const serializeLayout = (layout: CanvasLayout): string =>
  JSON.stringify({ version: LAYOUT_VERSION, ...layout });
