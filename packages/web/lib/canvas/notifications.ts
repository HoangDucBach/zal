// The notification feed: the events in a canvas's activity that are news for this account, each pointing at the
// node it is about. Derived from chain events (ADR 0003), so it needs no storage beyond what has been read.

import type { CanvasNodeData } from "./graph";
import type { ActivityItem, CanvasState } from "./types";
import type { Address } from "viem";

import { isAddressEqual } from "viem";

import { nodeId } from "./graph";

import { formatUsdc, shortAddress } from "@/lib/format";

export const NOTIFICATION_KINDS = [
  "proposalReceived",
  "invoiceIssued",
  "signatureNeeded",
  "paymentReceived",
  "advancePaid",
  "scheduleRan",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface CanvasNotification {
  /** The activity key (transaction and log index): stable across reads, so read state survives a reload. */
  readonly key: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly detail: string;
  /** The canvas node to fly to. */
  readonly nodeId: string;
  readonly timestamp: number;
  readonly blockNumber: bigint;
}

const usdc = (amount: bigint) => `${formatUsdc(amount)} zUSDC`;

function toNotification(
  item: ActivityItem,
  state: CanvasState,
): CanvasNotification | undefined {
  const me = state.account.address;
  const { event } = item;
  const base = {
    key: item.key,
    timestamp: item.timestamp,
    blockNumber: item.blockNumber,
  };

  switch (event.name) {
    case "RelationshipProposed": {
      const rel = state.relationships.find(
        (r) => r.id === event.relationshipId,
      );

      if (rel === undefined || isAddressEqual(rel.proposer, me))
        return undefined;
      const sellsToMe = isAddressEqual(rel.buyer, me);

      return {
        ...base,
        kind: "proposalReceived",
        title: `${state.labels[rel.proposer] ?? "A counterparty"} proposed a relationship`,
        detail: `As your ${sellsToMe ? "seller" : "buyer"}`,
        nodeId: nodeId.counterparty(rel.id),
      };
    }
    case "InvoiceIssued": {
      const inv = state.invoices.find((i) => i.id === event.invoiceId);

      if (inv === undefined || !isAddressEqual(inv.buyer, me)) return undefined;

      return {
        ...base,
        kind: "invoiceIssued",
        title: `Invoice #${inv.id} issued to you`,
        detail: `${usdc(inv.faceValue)} from ${state.labels[inv.seller] ?? "your seller"} · needs approval`,
        nodeId: nodeId.invoice(inv.id),
      };
    }
    case "OpSubmitted": {
      const op = state.account.ops.find((o) => o.opId === event.opId);

      if (op === undefined || op.executed || op.stale || op.confirmedByMe)
        return undefined;

      return {
        ...base,
        kind: "signatureNeeded",
        title: `Operation #${op.opId} needs your signature`,
        detail: `${op.confirmations} of ${op.required} signed`,
        nodeId: nodeId.approval,
      };
    }
    case "InvoicePaid": {
      const inv = state.invoices.find((i) => i.id === event.invoiceId);

      if (inv === undefined) return undefined;
      if (isAddressEqual(inv.seller, me))
        return {
          ...base,
          kind: "paymentReceived",
          title: `Invoice #${inv.id} paid`,
          detail: `${usdc(inv.faceValue)} settled through your flow`,
          nodeId: nodeId.invoice(inv.id),
        };

      return undefined;
    }
    case "ScheduleRan": {
      // The account's own event, so this canvas is the payer. The payee hears through its own events.
      const schedule = state.account.schedules.find(
        (s) => s.id === event.scheduleId,
      );

      if (schedule === undefined) return undefined;
      const to =
        schedule.recipient === undefined
          ? `invoice #${schedule.invoiceId}`
          : (state.labels[schedule.recipient] ??
            shortAddress(schedule.recipient));

      return {
        ...base,
        kind: "scheduleRan",
        title: `Schedule #${schedule.id} ran`,
        detail: `${usdc(schedule.amount)} to ${to}`,
        nodeId: nodeId.schedule(schedule.id),
      };
    }
    case "Advanced": {
      const inv = state.invoices.find((i) => i.id === event.invoiceId);

      if (inv === undefined || !isAddressEqual(inv.seller, me))
        return undefined;

      return {
        ...base,
        kind: "advancePaid",
        title: `Advance on invoice #${inv.id} paid`,
        detail:
          inv.advance === undefined
            ? "Funding pool paid you early"
            : `${usdc(inv.advance.principal - inv.advance.fee)} from the funding pool`,
        nodeId: nodeId.invoice(inv.id),
      };
    }
    default:
      return undefined;
  }
}

/** Newest first. */
export function deriveNotifications(state: CanvasState): CanvasNotification[] {
  return state.activity
    .flatMap((item) => {
      const n = toNotification(item, state);

      return n === undefined ? [] : [n];
    })
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? 0
        : a.blockNumber > b.blockNumber
          ? -1
          : 1,
    );
}

// ---- Details for the Inbox hover card -------------------------------------------------------------------------

export const NOTIFICATION_LABEL: Record<NotificationKind, string> = {
  proposalReceived: "Relationship proposed",
  invoiceIssued: "Invoice issued",
  signatureNeeded: "Signature needed",
  paymentReceived: "Payment received",
  advancePaid: "Advance paid",
  scheduleRan: "Schedule ran",
};

export interface InboxDetails {
  readonly counterparty?: Address;
  /** The counterparty's display name, when the app knows it. */
  readonly counterpartyLabel?: string;
  readonly amount?: bigint;
  readonly invoiceId?: bigint;
  readonly dueDate?: number;
  /** What the item needs from this canvas now, read from the node's current state. */
  readonly action: string;
}

const NO_ACTION = "None";

/**
 * The full details of an inbox item, from the node it points at. Reads the node rather than the notification, so
 * the API feed and the chain-derived feed show the same thing, and the action reflects the node as it is now.
 */
export function inboxDetails(
  kind: NotificationKind | undefined,
  data: CanvasNodeData | undefined,
): InboxDetails {
  const signature = kind === "signatureNeeded" ? "Sign" : NO_ACTION;

  switch (data?.kind) {
    case "counterparty":
      return {
        counterparty: data.counterparty,
        counterpartyLabel: data.label,
        action: data.awaitingMe ? "Accept or reject" : NO_ACTION,
      };
    case "invoice": {
      const { invoice } = data;
      const advance = invoice.advance;

      return {
        counterparty: data.myRole === "seller" ? invoice.buyer : invoice.seller,
        amount:
          kind === "advancePaid" && advance !== undefined
            ? advance.principal - advance.fee
            : invoice.faceValue,
        invoiceId: invoice.id,
        dueDate: invoice.dueDate,
        action: data.awaitingMe ? "Approve or reject" : signature,
      };
    }
    case "schedule":
      return {
        counterparty: data.schedule.recipient,
        counterpartyLabel: data.label,
        amount: data.schedule.amount,
        invoiceId: data.schedule.invoiceId,
        action: signature,
      };
    default:
      return { action: signature };
  }
}

// ---- Read state, per wallet -----------------------------------------------------------------------------------

export const NOTIFICATIONS_VERSION = 1;

/** Per wallet, and per canvas when another than the wallet's own is open: each canvas has its own feed. */
export const notificationsStorageKey = (
  chainId: number,
  wallet: string,
  selected?: string,
): string =>
  `zal.notifications.v${NOTIFICATIONS_VERSION}:${chainId}:${wallet.toLowerCase()}${selected === undefined ? "" : `:${selected.toLowerCase()}`}`;

/** Stored JSON to the set of read keys. Anything unreadable is "nothing read". */
export function parseReadKeys(json: string | null): ReadonlySet<string> {
  if (json === null) return new Set();
  try {
    const value: unknown = JSON.parse(json);

    return typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === NOTIFICATIONS_VERSION &&
      "read" in value &&
      Array.isArray(value.read)
      ? new Set(value.read.filter((k): k is string => typeof k === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

/** Keeps only keys still in the feed, so storage does not grow without bound. */
export const serializeReadKeys = (
  read: ReadonlySet<string>,
  feed: readonly CanvasNotification[],
): string =>
  JSON.stringify({
    version: NOTIFICATIONS_VERSION,
    read: feed.filter((n) => read.has(n.key)).map((n) => n.key),
  });

/** Notifications in `next` that were not in `previous`: the ones that just arrived. */
export const arrivals = (
  previous: readonly CanvasNotification[],
  next: readonly CanvasNotification[],
): CanvasNotification[] => {
  const known = new Set(previous.map((n) => n.key));

  return next.filter((n) => !known.has(n.key));
};
