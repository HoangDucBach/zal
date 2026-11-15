// The notification feed, derived on the server from the same CanvasState the web builds (ADR 0012). The kinds,
// titles, details and node ids match packages/web/lib/canvas/notifications.ts; test/web-mirror.test.ts fails if
// the web's kinds drift from these. Read state is stored per wallet in zal_app.notification_reads.

import type { ActivityItem, CanvasState } from "./web-mirror/types.ts";

import { formatUnits, isAddressEqual } from "viem";

export const NOTIFICATION_KINDS = [
  "proposalReceived",
  "invoiceIssued",
  "signatureNeeded",
  "paymentReceived",
  "advancePaid",
  "keeperSettled",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface CanvasNotification {
  /** The activity key (`<transactionHash>:<logIndex>`), the same key the web uses for read state. */
  readonly key: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly detail: string;
  readonly nodeId: string;
  readonly timestamp: number;
  readonly blockNumber: bigint;
}

export interface NotificationContext {
  /**
   * Invoices that were settled by someone other than their buyer: on the live chain, a keeper or any caller
   * paying an escrowed invoice at its due date (ZR-PAY-03). The sandbox passes its keeper's job list instead.
   */
  readonly scheduled: readonly bigint[];
}

/** The web's node ids (packages/web/lib/canvas/graph.ts `nodeId`). */
const nodeId = {
  approval: "approval",
  counterparty: (relId: bigint) => `rel-${relId}`,
  invoice: (id: bigint) => `invoice-${id}`,
} as const;

const usdcFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const usdc = (amount: bigint) => `${usdcFormat.format(Number(formatUnits(amount, 6)))} zUSDC`;

function toNotification(
  item: ActivityItem,
  state: CanvasState,
  { scheduled }: NotificationContext,
): CanvasNotification | undefined {
  const me = state.account.address;
  const { event } = item;
  const base = { key: item.key, timestamp: item.timestamp, blockNumber: item.blockNumber };

  switch (event.name) {
    case "RelationshipProposed": {
      const rel = state.relationships.find((r) => r.id === event.relationshipId);
      if (rel === undefined || isAddressEqual(rel.proposer, me)) return undefined;
      const sellsToMe = isAddressEqual(rel.buyer, me);
      return {
        ...base,
        kind: "proposalReceived",
        title: `${state.labels[rel.proposer] ?? "A counterparty"} proposed a relationship`,
        detail: `They would be your ${sellsToMe ? "seller" : "buyer"}. Accept or reject it.`,
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
        detail: `${usdc(inv.faceValue)} from ${state.labels[inv.seller] ?? "your seller"}. It needs your approval.`,
        nodeId: nodeId.invoice(inv.id),
      };
    }
    case "OpSubmitted": {
      const op = state.account.ops.find((o) => o.opId === event.opId);
      if (op === undefined || op.executed || op.stale || op.confirmedByMe) return undefined;
      return {
        ...base,
        kind: "signatureNeeded",
        title: `Operation #${op.opId} needs your signature`,
        detail: `${op.confirmations} of ${op.required} signatures so far.`,
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
          detail: `${usdc(inv.faceValue)} settled through your flow.`,
          nodeId: nodeId.invoice(inv.id),
        };
      if (scheduled.includes(inv.id))
        return {
          ...base,
          kind: "keeperSettled",
          title: `Keeper settled invoice #${inv.id}`,
          detail: `${usdc(inv.faceValue)} paid from escrow at the due date.`,
          nodeId: nodeId.invoice(inv.id),
        };
      return undefined;
    }
    case "Advanced": {
      const inv = state.invoices.find((i) => i.id === event.invoiceId);
      if (inv === undefined || !isAddressEqual(inv.seller, me)) return undefined;
      return {
        ...base,
        kind: "advancePaid",
        title: `Advance on invoice #${inv.id} paid`,
        detail:
          inv.advance === undefined
            ? "The funding pool paid you early."
            : `${usdc(inv.advance.principal - inv.advance.fee)} from the funding pool.`,
        nodeId: nodeId.invoice(inv.id),
      };
    }
    default:
      return undefined;
  }
}

/** Newest first. */
export function deriveNotifications(state: CanvasState, context: NotificationContext): CanvasNotification[] {
  return state.activity
    .flatMap((item) => {
      const n = toNotification(item, state, context);
      return n === undefined ? [] : [n];
    })
    .sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber > b.blockNumber ? -1 : 1));
}
