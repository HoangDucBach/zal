// Chain state to canvas: which nodes and edges exist, where they sit, and whether each is ghost or solid. Pure,
// so the mapping in contracts.md "Ghost and solid on-chain" is tested without a browser.

import type {
  AccountState,
  Budget,
  CanvasState,
  Invoice,
  InvoiceStatus,
  PartyRole,
  PoolState,
  Relationship,
  RelStatus,
} from "./types";

import { isAddressEqual, type Address } from "viem";

import {
  cadenceText,
  pendingScheduleNodeId,
  scheduleNodeId,
  scheduleViews,
  type ScheduleView,
} from "./schedules";

/** Ghost: on-chain but the other side has not committed. Solid: committed. Ended: rejected or cancelled. */
export type Commitment = "ghost" | "solid" | "ended";

export function relationshipCommitment(status: RelStatus): Commitment {
  switch (status) {
    case "none":
    case "proposed":
      return "ghost";
    case "active":
      return "solid";
    case "rejected":
    case "cancelled":
      return "ended";
  }
}

export function invoiceCommitment(status: InvoiceStatus): Commitment {
  switch (status) {
    case "none":
    case "issued":
      return "ghost";
    case "approved":
    case "paid":
      return "solid";
    case "rejected":
    case "cancelled":
      return "ended";
  }
}

export const isEscrowBacked = (invoice: Invoice): boolean =>
  invoice.faceValue > 0n && invoice.escrowed === invoice.faceValue;

export const isFunded = (invoice: Invoice, pool: Address): boolean =>
  invoice.owner !== undefined && isAddressEqual(invoice.owner, pool);

export function roleIn(
  rel: { buyer: Address; seller: Address },
  account: Address,
): PartyRole {
  return isAddressEqual(rel.seller, account) ? "seller" : "buyer";
}

export type CanvasNodeData =
  | {
      readonly kind: "account";
      readonly commitment: Commitment;
      readonly account: AccountState;
      /** Display names for known addresses, for the members listed on the card. */
      readonly labels: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "counterparty";
      readonly commitment: Commitment;
      readonly relationship: Relationship;
      readonly counterparty: Address;
      /** The other party's role in this relationship, the label on its side of the edge. */
      readonly theirRole: PartyRole;
      readonly label: string | undefined;
      /** The relationship waits for this canvas to accept or reject. */
      readonly awaitingMe: boolean;
    }
  | {
      readonly kind: "invoice";
      readonly commitment: Commitment;
      readonly invoice: Invoice;
      readonly myRole: PartyRole;
      readonly funded: boolean;
      readonly escrowBacked: boolean;
      readonly awaitingMe: boolean;
      readonly now: number;
    }
  | {
      readonly kind: "budget";
      readonly commitment: Commitment;
      readonly budget: Budget;
    }
  | {
      readonly kind: "approval";
      readonly commitment: Commitment;
      readonly account: AccountState;
    }
  | {
      readonly kind: "split";
      readonly commitment: Commitment;
      readonly account: AccountState;
    }
  | {
      readonly kind: "escrow";
      readonly commitment: Commitment;
      readonly invoice: Invoice;
    }
  | {
      /** A payment the account approved ahead of time (ADR 0015); ghost while its op waits for signatures. */
      readonly kind: "schedule";
      readonly commitment: Commitment;
      readonly schedule: ScheduleView;
      /** The recipient's display name, when the app knows it. */
      readonly label: string | undefined;
      readonly now: number;
    }
  | {
      readonly kind: "vault";
      readonly commitment: Commitment;
      readonly account: AccountState;
      readonly vault: Address;
    }
  | {
      readonly kind: "pool";
      readonly commitment: Commitment;
      readonly pool: PoolState;
      readonly financed: readonly Invoice[];
      /** The connected wallet's pool shares, worth `lpAssets`. */
      readonly lpAssets: bigint;
    };

export type CanvasNodeKind = CanvasNodeData["kind"];

export interface CanvasNodeSpec {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly data: CanvasNodeData;
}

export interface CanvasEdgeSpec {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  /** Ghost edges are dashed and moving (xyflow `animated`). */
  readonly ghost: boolean;
  /** `money`: funds move from source to target. `link`: a relationship or reference that moves none (ADR 0011). */
  readonly flow: EdgeFlow;
}

export type EdgeFlow = "money" | "link";

export interface CanvasGraph {
  readonly nodes: readonly CanvasNodeSpec[];
  readonly edges: readonly CanvasEdgeSpec[];
  /** Ghost nodes that wait for this canvas to act: the Inbox. */
  readonly inbox: readonly string[];
}

export const nodeId = {
  account: "account",
  split: "split",
  vault: "vault",
  approval: "approval",
  pool: "pool",
  counterparty: (relId: bigint) => `rel-${relId}`,
  invoice: (id: bigint) => `invoice-${id}`,
  escrow: (id: bigint) => `escrow-${id}`,
  schedule: scheduleNodeId,
  pendingSchedule: pendingScheduleNodeId,
  budget: (id: bigint) => `budget-${id}`,
} as const;

/**
 * Columns, left to right: the account on its own (it is the largest card), then Approval above budgets, its Split
 * (the Vault above), the counterparties with their invoices stacked under each, then each invoice's Escrow and
 * Schedules on its row (the pool above them, so an invoice's edge to it never runs through the counterparty stack).
 * A card is 256 px wide, so a 300 px column leaves a gutter for the edges; the Account card is 320 px wide.
 */
const COLUMN = 300;
const ACCOUNT_X = -380;
const ROW = 200;
/** One footprint: cards this far apart vertically never overlap. */
const BELOW = 190;
/** Space between one counterparty's stack and the next. */
const STACK_GAP = 30;

/** Who ended a relationship: the non-proposer rejects, the proposer cancels. That side no longer shows it. */
function endedByMe(rel: Relationship, account: Address): boolean {
  const iProposed = isAddressEqual(rel.proposer, account);

  return rel.status === "cancelled"
    ? iProposed
    : rel.status === "rejected"
      ? !iProposed
      : false;
}

export interface BuildOptions {
  readonly vault: Address;
}

/** The cadence while money still moves; a finished or cancelled schedule's edge stays quiet. */
const scheduleEdgeLabel = (view: ScheduleView): string | undefined =>
  view.status === "active" || view.status === "pending"
    ? cadenceText(view.interval)
    : undefined;

function scheduleCommitment(view: ScheduleView): Commitment {
  switch (view.status) {
    case "pending":
      return "ghost";
    case "active":
      return "solid";
    case "ended":
    case "cancelled":
      return "ended";
  }
}

export function buildCanvasGraph(
  state: CanvasState,
  { vault }: BuildOptions,
): CanvasGraph {
  const me = state.account.address;
  const nodes: CanvasNodeSpec[] = [];
  const edges: CanvasEdgeSpec[] = [];
  const inbox: string[] = [];

  nodes.push({
    id: nodeId.account,
    position: { x: ACCOUNT_X, y: -ROW },
    data: {
      kind: "account",
      commitment: state.account.exists ? "solid" : "ghost",
      account: state.account,
      labels: state.labels,
    },
  });
  if (!state.account.exists) return { nodes, edges, inbox };

  const pushSchedule = (
    view: ScheduleView,
    position: { x: number; y: number },
  ) =>
    nodes.push({
      id: view.nodeId,
      position,
      data: {
        kind: "schedule",
        commitment: scheduleCommitment(view),
        schedule: view,
        label:
          view.recipient === undefined
            ? undefined
            : state.labels[view.recipient],
        now: state.now,
      },
    });
  const unplaced = new Set(scheduleViews(state.account));
  /**
   * Places each schedule `match` picks on the row at `y`, from column `firstColumn` rightwards, with an edge to
   * `target`: a PayInvoice beside its invoice, a Transfer beside the counterparty it pays.
   */
  const placeSchedules = (
    match: (view: ScheduleView) => boolean,
    target: string,
    firstColumn: number,
    y: number,
  ) => {
    let column = firstColumn;

    for (const view of unplaced) {
      if (!match(view)) continue;
      unplaced.delete(view);
      pushSchedule(view, { x: COLUMN * column, y });
      column += 1;
      edges.push({
        id: `${view.nodeId}-${target}`,
        source: view.nodeId,
        target,
        label: scheduleEdgeLabel(view),
        ghost: view.status === "pending",
        flow: "money",
      });
    }
  };

  const route = state.account.route;

  nodes.push({
    id: nodeId.split,
    position: { x: COLUMN, y: 0 },
    data: {
      kind: "split",
      commitment: route.length > 0 ? "solid" : "ghost",
      account: state.account,
    },
  });
  edges.push({
    id: "split-account",
    source: nodeId.split,
    target: nodeId.account,
    label: "Hold",
    ghost: route.length === 0,
    flow: "money",
  });

  const hasVaultLeg = route.some((leg) => leg.kind === "vault");

  if (hasVaultLeg || state.account.vaultShares > 0n) {
    nodes.push({
      id: nodeId.vault,
      position: { x: COLUMN, y: -ROW },
      data: {
        kind: "vault",
        commitment: "solid",
        account: state.account,
        vault,
      },
    });
    if (hasVaultLeg)
      edges.push({
        id: "split-vault",
        source: nodeId.split,
        target: nodeId.vault,
        ghost: false,
        flow: "money",
      });
  }

  if (state.account.members.length >= 2) {
    nodes.push({
      id: nodeId.approval,
      position: { x: 0, y: -ROW },
      data: { kind: "approval", commitment: "solid", account: state.account },
    });
    edges.push({
      id: "approval-account",
      source: nodeId.approval,
      target: nodeId.account,
      ghost: false,
      flow: "link",
    });
  }

  state.account.budgets.forEach((budget, index) => {
    nodes.push({
      id: nodeId.budget(budget.id),
      position: { x: 0, y: ROW + index * BELOW },
      data: { kind: "budget", commitment: "solid", budget },
    });
    edges.push({
      id: `account-budget-${budget.id}`,
      source: nodeId.account,
      target: nodeId.budget(budget.id),
      ghost: false,
      flow: "money",
    });
  });

  const visible = state.relationships.filter((rel) => !endedByMe(rel, me));
  let row = ROW;

  for (const rel of visible) {
    const myRole = roleIn(rel, me);
    const counterparty = myRole === "seller" ? rel.buyer : rel.seller;
    const commitment = relationshipCommitment(rel.status);
    const awaitingMe =
      rel.status === "proposed" && !isAddressEqual(rel.proposer, me);
    const relNode = nodeId.counterparty(rel.id);
    const invoices = state.invoices.filter(
      (inv) => inv.relationshipId === rel.id,
    );
    const relRow = row;

    nodes.push({
      id: relNode,
      position: { x: COLUMN * 2, y: relRow },
      data: {
        kind: "counterparty",
        commitment,
        relationship: rel,
        counterparty,
        theirRole: myRole === "seller" ? "buyer" : "seller",
        label: state.labels[counterparty],
        awaitingMe,
      },
    });
    if (awaitingMe) inbox.push(relNode);
    edges.push({
      id: `rel-edge-${rel.id}`,
      source: nodeId.account,
      target: relNode,
      label: `you: ${myRole} · them: ${myRole === "seller" ? "buyer" : "seller"}`,
      ghost: commitment !== "solid",
      flow: "link",
    });
    placeSchedules(
      (view) =>
        view.kind === "transfer" &&
        view.recipient !== undefined &&
        isAddressEqual(view.recipient, counterparty),
      relNode,
      3,
      relRow,
    );

    invoices.forEach((invoice, index) => {
      const id = nodeId.invoice(invoice.id);
      const invCommitment = invoiceCommitment(invoice.status);
      // The pool keeps the NFT as the paid record, so "financed" is shown only while the advance is open.
      const viaPool = isFunded(invoice, state.pool.address);
      const funded = viaPool && invoice.status === "approved";
      const invoiceAwaitingMe =
        invoice.status === "issued" && myRole === "buyer";
      const y = relRow + (index + 1) * BELOW;

      nodes.push({
        id,
        position: { x: COLUMN * 2, y },
        data: {
          kind: "invoice",
          commitment: invCommitment,
          invoice,
          myRole,
          funded,
          escrowBacked: isEscrowBacked(invoice),
          awaitingMe: invoiceAwaitingMe,
          now: state.now,
        },
      });
      if (invoiceAwaitingMe) inbox.push(id);
      edges.push({
        id: `${id}-rel`,
        source: relNode,
        target: id,
        ghost: invCommitment !== "solid",
        flow: "link",
      });

      if (myRole === "seller") {
        // The payment recipient is the NFT holder: once funded, the invoice's last edge reroutes to the pool.
        edges.push(
          viaPool
            ? {
                id: `${id}-pool`,
                source: id,
                target: nodeId.pool,
                label: "repays pool",
                ghost: invCommitment !== "solid",
                flow: "money",
              }
            : {
                id: `${id}-split`,
                source: id,
                target: nodeId.split,
                label: undefined,
                ghost: invCommitment !== "solid",
                flow: "money",
              },
        );
      } else {
        const budgetId = state.account.budgetOfInvoice[String(invoice.id)];

        if (budgetId !== undefined) {
          edges.push({
            id: `${id}-budget`,
            source: nodeId.budget(budgetId),
            target: id,
            label: "budget",
            ghost: false,
            flow: "money",
          });
        }
      }

      if (invoice.escrowed > 0n) {
        nodes.push({
          id: nodeId.escrow(invoice.id),
          position: { x: COLUMN * 3, y },
          data: { kind: "escrow", commitment: "solid", invoice },
        });
        edges.push({
          id: `${id}-escrow`,
          source: nodeId.escrow(invoice.id),
          target: id,
          label: "locked",
          ghost: false,
          flow: "money",
        });
      }

      if (myRole === "buyer")
        placeSchedules(
          (view) => view.kind === "payInvoice" && view.invoiceId === invoice.id,
          id,
          invoice.escrowed > 0n ? 4 : 3,
          y,
        );
    });
    row += (1 + invoices.length) * BELOW + STACK_GAP;
  }

  // The rest pay an address with no counterparty node here: below the Split, paid from the Account.
  [...unplaced].forEach((view, index) => {
    pushSchedule(view, { x: COLUMN, y: ROW + index * BELOW });
    edges.push({
      id: `account-${view.nodeId}`,
      source: nodeId.account,
      target: view.nodeId,
      label: scheduleEdgeLabel(view),
      ghost: view.status === "pending",
      flow: "money",
    });
  });

  const financed = state.invoices.filter(
    (inv) => inv.status === "approved" && isFunded(inv, state.pool.address),
  );
  const sellerOfApproved = state.invoices.some(
    (inv) => inv.status === "approved" && isAddressEqual(inv.seller, me),
  );
  const poolEdges = edges.some((edge) => edge.target === nodeId.pool);

  const lpPosition = state.lp.shares > 0n;

  if (sellerOfApproved || poolEdges || lpPosition) {
    nodes.push({
      id: nodeId.pool,
      position: { x: COLUMN * 3, y: -ROW },
      data: {
        kind: "pool",
        commitment: "solid",
        pool: state.pool,
        financed,
        lpAssets: state.lp.assets,
      },
    });
  }
  if (sellerOfApproved || poolEdges) {
    edges.push({
      id: "pool-split",
      source: nodeId.pool,
      target: nodeId.split,
      label: "reserve",
      ghost: !state.invoices.some((inv) => isFunded(inv, state.pool.address)),
      flow: "money",
    });
  }

  return { nodes, edges, inbox };
}

/** What a node is called wherever it is named outside its own card: gate ports, menus, notifications. */
export function nodeTitle(data: CanvasNodeData): string {
  switch (data.kind) {
    case "account":
      return "Account";
    case "counterparty":
      return (
        data.label ??
        `${data.counterparty.slice(0, 6)}…${data.counterparty.slice(-4)}`
      );
    case "invoice":
      return `Invoice #${data.invoice.id}`;
    case "budget":
      return `Budget #${data.budget.id}`;
    case "approval":
      return "Approval";
    case "split":
      return "Split";
    case "escrow":
      return `Escrow #${data.invoice.id}`;
    case "schedule":
      return data.schedule.id === undefined
        ? `Schedule (op #${data.schedule.opId})`
        : `Schedule #${data.schedule.id}`;
    case "vault":
      return "Vault";
    case "pool":
      return "Funding pool";
  }
}
