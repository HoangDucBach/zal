import { describe, expect, it } from "vitest";

import { activityNodeId } from "./activity-node";

describe("activityNodeId", () => {
  it("points each event at the node it is about", () => {
    expect([
      activityNodeId({ name: "RelationshipAccepted", relationshipId: 2n }),
      activityNodeId({ name: "InvoiceIssued", invoiceId: 1n }),
      activityNodeId({ name: "Advanced", invoiceId: 1n }),
      activityNodeId({ name: "InvoiceEscrowed", invoiceId: 1n }),
      activityNodeId({ name: "PaymentRouted", invoiceId: 1n }),
      activityNodeId({ name: "BudgetSet", budgetId: 3n }),
      activityNodeId({ name: "OpExecuted", opId: 4n }),
    ]).toEqual([
      "rel-2",
      "invoice-1",
      "invoice-1",
      "escrow-1",
      "split",
      "budget-3",
      "approval",
    ]);
  });
});
