// Zal event logs to typed activity: which event, and the relationship, invoice, op or budget it is about. The
// Timeline shows the title; the notification feed (lib/canvas/notifications.ts) reads the event.

import type { ActivityEvent } from "./types";

const RELATIONSHIP_EVENTS = [
  "RelationshipProposed",
  "RelationshipAccepted",
  "RelationshipRejected",
  "RelationshipCancelled",
] as const;
const INVOICE_EVENTS = [
  "InvoiceIssued",
  "InvoiceApproved",
  "InvoiceRejected",
  "InvoiceCancelled",
  "InvoiceEscrowed",
  "InvoicePaid",
] as const;
const POOL_AND_ROUTE_EVENTS = ["Advanced", "Repaid", "PaymentRouted"] as const;
const OP_EVENTS = ["OpSubmitted", "OpExecuted"] as const;
const SCHEDULE_EVENTS = [
  "ScheduleCreated",
  "ScheduleRan",
  "ScheduleCancelled",
] as const;

const isOneOf = <T extends string>(
  list: readonly T[],
  name: string,
): name is T => (list as readonly string[]).includes(name);

/** `undefined` for events the canvas does not list (transfers, approvals of ERC-20, and the like). */
export function parseActivityEvent(
  eventName: string,
  args: Readonly<Record<string, unknown>>,
): ActivityEvent | undefined {
  const id = (key: string): bigint | undefined =>
    typeof args[key] === "bigint" ? args[key] : undefined;

  if (isOneOf(RELATIONSHIP_EVENTS, eventName)) {
    const relationshipId = id("id");

    return relationshipId === undefined
      ? undefined
      : { name: eventName, relationshipId };
  }
  if (isOneOf(INVOICE_EVENTS, eventName)) {
    const invoiceId = id("id");

    return invoiceId === undefined ? undefined : { name: eventName, invoiceId };
  }
  if (isOneOf(POOL_AND_ROUTE_EVENTS, eventName)) {
    const invoiceId = id("invoiceId");

    return invoiceId === undefined ? undefined : { name: eventName, invoiceId };
  }
  if (isOneOf(OP_EVENTS, eventName)) {
    const opId = id("opId");

    return opId === undefined ? undefined : { name: eventName, opId };
  }
  if (isOneOf(SCHEDULE_EVENTS, eventName)) {
    const scheduleId = id("id");

    return scheduleId === undefined
      ? undefined
      : { name: eventName, scheduleId };
  }
  if (eventName === "BudgetSet") {
    const budgetId = id("budgetId");

    return budgetId === undefined ? undefined : { name: eventName, budgetId };
  }
  if (eventName === "RouteSet") return { name: eventName };

  return undefined;
}

export function activityTitle(event: ActivityEvent): string {
  switch (event.name) {
    case "RelationshipProposed":
      return `Relationship #${event.relationshipId} proposed`;
    case "RelationshipAccepted":
      return `Relationship #${event.relationshipId} accepted`;
    case "RelationshipRejected":
      return `Relationship #${event.relationshipId} rejected`;
    case "RelationshipCancelled":
      return `Relationship #${event.relationshipId} cancelled`;
    case "InvoiceIssued":
      return `Invoice #${event.invoiceId} issued`;
    case "InvoiceApproved":
      return `Invoice #${event.invoiceId} approved`;
    case "InvoiceRejected":
      return `Invoice #${event.invoiceId} rejected`;
    case "InvoiceCancelled":
      return `Invoice #${event.invoiceId} cancelled`;
    case "InvoiceEscrowed":
      return `Invoice #${event.invoiceId} escrowed`;
    case "InvoicePaid":
      return `Invoice #${event.invoiceId} paid`;
    case "Advanced":
      return `Invoice #${event.invoiceId} advanced by the pool`;
    case "Repaid":
      return `Pool repaid for invoice #${event.invoiceId}`;
    case "PaymentRouted":
      return `Payment for invoice #${event.invoiceId} ran through the Split`;
    case "RouteSet":
      return "Split updated";
    case "BudgetSet":
      return `Budget #${event.budgetId} set`;
    case "OpSubmitted":
      return `Operation #${event.opId} submitted for approval`;
    case "OpExecuted":
      return `Operation #${event.opId} executed`;
    case "ScheduleCreated":
      return `Schedule #${event.scheduleId} created`;
    case "ScheduleRan":
      return `Schedule #${event.scheduleId} ran`;
    case "ScheduleCancelled":
      return `Schedule #${event.scheduleId} cancelled`;
  }
}
