// Which canvas node an activity event is about, so the Timeline flies to it. Kept out of activity.ts, which the
// indexer mirrors byte for byte and which has no graph.

import type { ActivityEvent } from "./types";

import { nodeId } from "./graph";

/** The canvas node an event is about, for the Timeline to fly to. */
export function activityNodeId(event: ActivityEvent): string {
  switch (event.name) {
    case "RelationshipProposed":
    case "RelationshipAccepted":
    case "RelationshipRejected":
    case "RelationshipCancelled":
      return nodeId.counterparty(event.relationshipId);
    case "InvoiceEscrowed":
      return nodeId.escrow(event.invoiceId);
    case "InvoiceIssued":
    case "InvoiceApproved":
    case "InvoiceRejected":
    case "InvoiceCancelled":
    case "InvoicePaid":
    case "Advanced":
    case "Repaid":
      return nodeId.invoice(event.invoiceId);
    case "PaymentRouted":
    case "RouteSet":
      return nodeId.split;
    case "BudgetSet":
      return nodeId.budget(event.budgetId);
    case "OpSubmitted":
    case "OpExecuted":
      return nodeId.approval;
    case "ScheduleCreated":
    case "ScheduleRan":
    case "ScheduleCancelled":
      return nodeId.schedule(event.scheduleId);
  }
}
