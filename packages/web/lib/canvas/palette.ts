// The component palette (PRD "Component catalogue", story C2): which components fit the selected node and the
// chain state, and the action each one starts. Pure, so every rule is tested without a browser. Dropping a
// component on a node and dragging a connection between two nodes run the same rules (`canConnect`), so a
// connection the palette would not offer is blocked with the same reason.

import type { CanvasNodeData, CanvasNodeKind } from "./graph";
import type { CanvasState, Invoice } from "./types";
import type { Address } from "viem";

import { advanceEligibility } from "./advance";
import { nodeId, nodeTitle, roleIn } from "./graph";
import { allows, roleForAction, roleReason } from "./roles";
import { isInvoiceScheduled } from "./schedules";

export const PALETTE_GROUPS = [
  "Root",
  "Relationship",
  "Document",
  "Spend control",
  "Time",
  "Allocation",
  "Commitment",
  "Yield",
  "Financing",
] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/** The action a component starts. The Inspector opens its form, prefilled from these fields. */
export type CanvasAction =
  | { readonly kind: "createAccount" }
  | { readonly kind: "proposeRelationship" }
  | { readonly kind: "publishEndpoint" }
  | { readonly kind: "issueInvoice"; readonly relationshipId: bigint }
  | { readonly kind: "addBudget" }
  | {
      readonly kind: "approveInvoice";
      readonly invoiceId: bigint;
      readonly budgetId: bigint;
    }
  | { readonly kind: "setPolicy" }
  /** Pay one approved invoice at a set time (ADR 0015). */
  | { readonly kind: "schedulePayment"; readonly invoiceId: bigint }
  /** Pay a fixed amount once or every interval; `recipient` is prefilled from a counterparty. */
  | { readonly kind: "scheduleTransfer"; readonly recipient?: Address }
  /** `vaultLeg`: the Split form opens with a leg to the Vault added. */
  | { readonly kind: "setRoute"; readonly vaultLeg?: boolean }
  | { readonly kind: "escrow"; readonly invoiceId: bigint }
  | { readonly kind: "vaultDeposit" }
  | { readonly kind: "advance"; readonly invoiceId: bigint }
  | { readonly kind: "provideLiquidity" };

/**
 * `ready`: offered, and starts `action`. `blocked`: does not fit this selection or state; hidden from the palette,
 * and a drop explains `reason`. `unsupported`: fits, but v1 cannot do it, or the canvas already has its one node of
 * this kind (`singletonTaken`); shown disabled. `draft`:
 * fits no node on its own yet, so the palette offers it as a draft to place and connect (`reason` says to what).
 */
export type Availability =
  | { readonly status: "ready"; readonly action: CanvasAction }
  | { readonly status: "blocked"; readonly reason: string }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "draft"; readonly reason: string };

export const CATALOGUE = [
  { component: "account", group: "Root", title: "Account" },
  { component: "counterparty", group: "Relationship", title: "Counterparty" },
  { component: "endpoint", group: "Relationship", title: "Payee endpoint" },
  { component: "invoice", group: "Document", title: "Invoice" },
  { component: "budget", group: "Spend control", title: "Budget" },
  { component: "approval", group: "Spend control", title: "Approval" },
  { component: "schedule", group: "Time", title: "Schedule" },
  { component: "stream", group: "Time", title: "Stream" },
  { component: "split", group: "Allocation", title: "Split" },
  { component: "escrow", group: "Commitment", title: "Escrow" },
  { component: "vault", group: "Yield", title: "Vault" },
  { component: "pool", group: "Financing", title: "Funding pool" },
  { component: "liquidity", group: "Financing", title: "Pool liquidity" },
] as const satisfies readonly {
  component: string;
  group: PaletteGroup;
  title: string;
}[];

export type PaletteComponent = (typeof CATALOGUE)[number]["component"];

export interface PaletteEntry {
  readonly component: PaletteComponent;
  readonly group: PaletteGroup;
  readonly title: string;
  readonly availability: Availability;
}

const ready = (action: CanvasAction): Availability => ({
  status: "ready",
  action,
});
const blocked = (reason: string): Availability => ({
  status: "blocked",
  reason,
});

type Target = CanvasNodeData | undefined;

/** Canvas-level components attach to the account, to nothing selected, or to a node of their own kind. */
const onCanvas = (target: Target, ...kinds: CanvasNodeData["kind"][]) =>
  target === undefined ||
  target.kind === "account" ||
  kinds.includes(target.kind);

function invoiceTarget(
  target: Target,
):
  | { readonly invoice: Invoice; readonly myRole: "buyer" | "seller" }
  | undefined {
  return target?.kind === "invoice"
    ? { invoice: target.invoice, myRole: target.myRole }
    : undefined;
}

function evaluateInvoiceComponent(
  component: "schedule" | "escrow" | "pool",
  state: CanvasState,
  target: Target,
): Availability {
  const selected = invoiceTarget(target);
  const noun = {
    schedule: "Schedule",
    escrow: "Escrow",
    pool: "Funding pool",
  }[component];

  if (selected === undefined)
    return blocked(
      component === "pool"
        ? "Funding pool needs an approved invoice you sell"
        : `${noun} needs an approved invoice you pay`,
    );
  const { invoice, myRole } = selected;

  if (component === "pool") {
    if (myRole !== "seller") return blocked("Only the seller takes an advance");
    const eligibility = advanceEligibility(invoice, state.pool, state.now);

    return eligibility.ok
      ? ready({ kind: "advance", invoiceId: invoice.id })
      : blocked(eligibility.reason);
  }
  if (myRole !== "buyer")
    return blocked(
      component === "escrow"
        ? "Only the buyer escrows"
        : "Only the buyer schedules payment",
    );
  if (invoice.status === "paid") return blocked("Already paid");
  if (invoice.status !== "approved")
    return blocked(
      invoice.status === "issued"
        ? "Approve the invoice first"
        : `Invoice ${invoice.status}`,
    );

  if (component === "escrow")
    return invoice.escrowed > 0n
      ? blocked("Already escrowed")
      : ready({ kind: "escrow", invoiceId: invoice.id });

  if (isInvoiceScheduled(state.account, invoice.id))
    return blocked("Already scheduled");

  return ready({ kind: "schedulePayment", invoiceId: invoice.id });
}

/** Rules that hold whatever the component connects to, or `undefined` when the component may be placed at all. */
function precondition(
  component: PaletteComponent,
  state: CanvasState,
): Availability | undefined {
  const { account } = state;

  if (component === "stream")
    return { status: "unsupported", reason: "Not in v1 contracts" };
  // An LP is a wallet, so it needs no canvas.
  if (component === "liquidity") return undefined;
  if (component === "account")
    return account.exists
      ? blocked("Already created · one Account per canvas")
      : undefined;
  if (!account.exists) return blocked("Create the Account first");
  if (component === "approval" && account.members.length < 2)
    return blocked("Approval needs 2+ members · add one on the Account");
  if (
    component === "budget" &&
    !state.relationships.some(
      (rel) =>
        (rel.status === "active" || rel.status === "proposed") &&
        roleIn(rel, account.address) === "buyer",
    )
  )
    return blocked("Budget needs a relationship where you buy");

  return undefined;
}

export function evaluate(
  component: PaletteComponent,
  state: CanvasState,
  target: Target,
): Availability {
  const availability =
    precondition(component, state) ?? attach(component, state, target);

  if (availability.status !== "ready") return availability;
  const needed = roleForAction(availability.action);

  return allows(state.account.myRole, needed)
    ? availability
    : blocked(roleReason(needed));
}

/** What `component` does attached to `target`, once its precondition holds. */
function attach(
  component: PaletteComponent,
  state: CanvasState,
  target: Target,
): Availability {
  const { account } = state;

  switch (component) {
    case "stream":
      return {
        status: "unsupported",
        reason: "Not in v1 contracts",
      };
    case "account":
      return ready({ kind: "createAccount" });
    case "liquidity":
      return onCanvas(target, "pool")
        ? ready({ kind: "provideLiquidity" })
        : blocked("Pool liquidity attaches to the Account or funding pool");
    case "counterparty":
      return onCanvas(target, "counterparty")
        ? ready({ kind: "proposeRelationship" })
        : blocked("Counterparty attaches to the Account");
    case "endpoint":
      return onCanvas(target, "split")
        ? ready({ kind: "publishEndpoint" })
        : blocked("Payee endpoint attaches to the Account or Split");
    case "split":
      return onCanvas(target, "split")
        ? ready({ kind: "setRoute" })
        : blocked("Split attaches to the Account");
    case "vault":
      if (target?.kind === "split")
        return ready({ kind: "setRoute", vaultLeg: true });

      return onCanvas(target, "vault")
        ? ready({ kind: "vaultDeposit" })
        : blocked("Vault attaches to the Account or Split");
    case "approval":
      return onCanvas(target, "approval")
        ? ready({ kind: "setPolicy" })
        : blocked("Approval attaches to the Account");
    case "budget": {
      const selected = invoiceTarget(target);

      if (selected === undefined)
        return onCanvas(target, "budget")
          ? ready({ kind: "addBudget" })
          : blocked("Budget attaches to the Account or an invoice you pay");
      if (selected.myRole !== "buyer")
        return blocked("Only the buyer charges a budget");
      if (selected.invoice.status !== "issued")
        return blocked("Budget charges at approval · this invoice is past it");
      const budget =
        account.budgets.find(
          (b) => b.limit - b.used >= selected.invoice.faceValue,
        ) ?? account.budgets[0];

      return budget === undefined
        ? blocked("Add a budget first")
        : ready({
            kind: "approveInvoice",
            invoiceId: selected.invoice.id,
            budgetId: budget.id,
          });
    }
    case "invoice": {
      if (target?.kind !== "counterparty")
        return blocked("Invoice attaches to a counterparty you sell to");
      if (target.theirRole !== "buyer")
        return blocked("Only the seller issues invoices");
      if (target.relationship.status !== "active")
        return blocked(
          target.relationship.status === "proposed"
            ? "Not active until they accept"
            : `Relationship ${target.relationship.status}`,
        );

      return ready({
        kind: "issueInvoice",
        relationshipId: target.relationship.id,
      });
    }
    case "schedule":
      if (target?.kind === "invoice")
        return evaluateInvoiceComponent(component, state, target);
      if (onCanvas(target)) return ready({ kind: "scheduleTransfer" });
      if (target?.kind !== "counterparty")
        return blocked(
          "Schedule attaches to the Account, a counterparty or an invoice",
        );
      if (
        target.relationship.status === "rejected" ||
        target.relationship.status === "cancelled"
      )
        return blocked(`Relationship ${target.relationship.status}`);

      return ready({
        kind: "scheduleTransfer",
        recipient: target.counterparty,
      });
    case "escrow":
    case "pool":
      return evaluateInvoiceComponent(component, state, target);
  }
}

// ---- Connections ----------------------------------------------------------------------------------------------

/** One end of a connection: a node the chain draws, or a draft placed from the palette (off-chain, ADR 0003). */
export type ConnectEnd =
  | { readonly kind: "node"; readonly data: CanvasNodeData }
  | { readonly kind: "draft"; readonly component: PaletteComponent };

export type Connection =
  | { readonly ok: true; readonly action: CanvasAction }
  | { readonly ok: false; readonly reason: string };

/**
 * On-chain nodes that act as a component when connected, because the action is about that very node: approve
 * against this Budget, advance from this pool, deposit into or route to this Vault, set this Split or policy.
 */
const NODE_AS_COMPONENT: Partial<Record<CanvasNodeKind, PaletteComponent>> = {
  budget: "budget",
  pool: "pool",
  vault: "vault",
  split: "split",
  approval: "approval",
};

/** The component one end stands for, when the other end is what it attaches to. */
function componentOf(end: ConnectEnd): PaletteComponent | undefined {
  return end.kind === "draft"
    ? end.component
    : NODE_AS_COMPONENT[end.data.kind];
}

const titleOf = (end: ConnectEnd): string =>
  end.kind === "draft"
    ? `this ${CATALOGUE.find((c) => c.component === end.component)?.title ?? "draft"}`
    : nodeTitle(end.data);

/**
 * Whether two ends may be connected, and the action the connection starts. Direction does not matter: one end
 * is the component (a draft, or a node in NODE_AS_COMPONENT), the other the on-chain node it attaches to, judged
 * by `evaluate`. A draft always plays the component, so two drafts never connect.
 */
export function canConnect(
  source: ConnectEnd,
  target: ConnectEnd,
  state: CanvasState,
): Connection {
  if (source.kind === "draft" && target.kind === "draft")
    return {
      ok: false,
      reason: "Two drafts · one end must be on-chain",
    };
  const pairs: {
    component: PaletteComponent;
    anchor: CanvasNodeData;
    via: ConnectEnd;
  }[] = [];

  for (const [end, other] of [
    [target, source],
    [source, target],
  ] as const) {
    const component = componentOf(end);

    if (component !== undefined && other.kind === "node")
      pairs.push({ component, anchor: other.data, via: end });
    if (end.kind === "draft") break;
  }
  let reason: string | undefined;

  for (const { component, anchor, via } of pairs) {
    const availability = evaluate(component, state, anchor);

    if (availability.status === "ready") {
      const { action } = availability;

      // A Budget node approves against itself, not the first budget with room.
      return {
        ok: true,
        action:
          action.kind === "approveInvoice" &&
          via.kind === "node" &&
          via.data.kind === "budget"
            ? { ...action, budgetId: via.data.budget.id }
            : action,
      };
    }
    reason ??= availability.reason;
  }

  return {
    ok: false,
    reason:
      reason ?? `${titleOf(source)} and ${titleOf(target)} do not connect`,
  };
}

/** What a connection does, in one line: the tooltip on a node while a connection is dragged over it. */
export function describeAction(action: CanvasAction): string {
  switch (action.kind) {
    case "createAccount":
      return "Create the Account";
    case "proposeRelationship":
      return "Propose a relationship";
    case "publishEndpoint":
      return "Set payee endpoint visibility";
    case "issueInvoice":
      return `Issue invoice on relationship #${action.relationshipId}`;
    case "addBudget":
      return "Add a budget";
    case "approveInvoice":
      return `Approve invoice #${action.invoiceId} against budget #${action.budgetId}`;
    case "setPolicy":
      return "Set approval policy";
    case "schedulePayment":
      return `Pay invoice #${action.invoiceId} at a set time`;
    case "scheduleTransfer":
      return "Scheduled transfer · once or recurring";
    case "setRoute":
      return action.vaultLeg === true
        ? "Add a Split leg → Vault"
        : "Set Split legs";
    case "escrow":
      return `Escrow invoice #${action.invoiceId}`;
    case "vaultDeposit":
      return "Deposit into the Vault";
    case "advance":
      return `Advance on invoice #${action.invoiceId}`;
    case "provideLiquidity":
      return "Deposit from wallet into the funding pool";
  }
}

/**
 * The node an action creates when its id is known ahead, so it can take the place of the draft that started it.
 * Relationships, invoices and budgets get their ids on-chain, so they land wherever the layout puts new nodes.
 */
export function landsAs(action: CanvasAction): string | undefined {
  switch (action.kind) {
    case "escrow":
      return nodeId.escrow(action.invoiceId);
    case "vaultDeposit":
      return nodeId.vault;
    case "setRoute":
      return action.vaultLeg === true ? nodeId.vault : nodeId.split;
    case "advance":
    case "provideLiquidity":
      return nodeId.pool;
    case "setPolicy":
      return nodeId.approval;
    default:
      return undefined;
  }
}

/** One line per component: the palette item's tooltip. */
export const COMPONENT_HINTS: Record<PaletteComponent, string> = {
  account: "One per canvas · holds your money, runs every flow",
  counterparty: "A business you buy from or sell to",
  endpoint: "Shows buyers where your Split sends payments",
  invoice: "Invoice NFT · on a counterparty you sell to",
  budget: "Spend cap per 30 days",
  approval: "m of n signatures above a limit",
  schedule: "Pay at a time, or every ≥ 1 min",
  stream: "Continuous payout · not in v1",
  split: "Incoming money → hold · transfer · Vault",
  escrow: "Locks face value for an approved invoice you pay",
  vault: "Idle money earns yield",
  pool: "Early payment on an approved invoice you sell",
  liquidity: "Lend wallet zUSDC to the funding pool",
};

/** What a draft of each component connects to: its note, "Connects to …". */
export const DRAFT_TARGETS: Record<PaletteComponent, string> = {
  account: "nothing · it creates your canvas",
  counterparty: "your Account",
  endpoint: "your Account or Split",
  invoice: "a counterparty you sell to",
  budget: "your Account, or an issued invoice you pay",
  approval: "your Account",
  schedule: "your Account, a counterparty, or an approved invoice you pay",
  stream: "nothing · not in v1",
  split: "your Account",
  escrow: "an approved invoice you pay",
  vault: "your Account or Split",
  pool: "an approved invoice you sell",
  liquidity: "your Account or the funding pool",
};

/**
 * Components the canvas holds once, because each stands for one piece of account state: the Split is the single
 * route (`setRoute` overwrites it), the Vault node is the one Zal vault, the Approval node the one policy. Once the
 * node is on-chain it is edited from the node itself; once a draft is placed, a second draft would overwrite the
 * first. The Approval node is drawn as soon as there are two members and its policy is set from the palette, so
 * only a placed draft takes it. The Account is guarded by `precondition`.
 */
const SINGLETONS: Partial<
  Record<PaletteComponent, (state: CanvasState) => boolean>
> = {
  split: (state) => state.account.route.length > 0,
  vault: (state) =>
    state.account.route.some((leg) => leg.kind === "vault") ||
    state.account.vaultShares > 0n,
  approval: () => false,
};

/** Why `component` is not offered again, when the canvas already has its one node or draft. */
export function singletonTaken(
  component: PaletteComponent,
  state: CanvasState,
  placed: readonly PaletteComponent[],
): string | undefined {
  const onChain = SINGLETONS[component];

  if (onChain === undefined) return undefined;
  if (!onChain(state) && !placed.includes(component)) return undefined;
  const title = CATALOGUE.find((c) => c.component === component)?.title;

  return `One ${title ?? component} per canvas`;
}

/**
 * The palette for a selection. `placed` lists the components of the drafts already on the canvas, so a singleton
 * with a draft is shown disabled.
 */
export function palette(
  state: CanvasState,
  target: Target,
  placed: readonly PaletteComponent[] = [],
): PaletteEntry[] {
  return CATALOGUE.map(({ component, group, title }) => {
    const availability = evaluate(component, state, target);
    const taken = singletonTaken(component, state, placed);

    // A singleton that would not fit this selection anyway stays hidden; otherwise it shows, disabled.
    if (
      taken !== undefined &&
      state.account.exists &&
      (availability.status !== "blocked" || target === undefined)
    )
      return {
        component,
        group,
        title,
        availability: { status: "unsupported", reason: taken },
      };

    // With nothing selected, a component that needs a node becomes a draft to place and connect.
    return {
      component,
      group,
      title,
      availability:
        target === undefined &&
        availability.status === "blocked" &&
        precondition(component, state) === undefined &&
        state.account.myRole === "admin"
          ? {
              status: "draft",
              reason: `Connects to ${DRAFT_TARGETS[component]}`,
            }
          : availability,
    };
  });
}
