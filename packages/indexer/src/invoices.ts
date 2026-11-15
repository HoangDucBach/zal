// ZalInvoice events: the invoice state machine and NFT ownership (the payment recipient, INV-06).

import { zeroAddress } from "viem";
import { ponder } from "ponder:registry";
import schema from "ponder:schema";

import { publish } from "./feed.ts";

const STATUS = { issued: 1, approved: 2, paid: 3, rejected: 4, cancelled: 5 } as const;

ponder.on("ZalInvoice:InvoiceIssued", async ({ event, context }) => {
  const { id, relationshipId, seller, buyer, faceValue, dueDate, docHash } = event.args;
  await context.db.insert(schema.invoice).values({
    id,
    relationshipId,
    seller,
    buyer,
    faceValue,
    escrowed: 0n,
    issuedAt: event.block.timestamp,
    dueDate,
    approvedAt: 0n,
    status: STATUS.issued,
    docHash,
    owner: seller,
  }).onConflictDoUpdate({ relationshipId, seller, buyer, faceValue, dueDate, docHash, issuedAt: event.block.timestamp });
  await publish(context, event, "InvoiceIssued", [seller, buyer], { invoiceId: id, relationshipId });
});

ponder.on("ZalInvoice:InvoiceApproved", async ({ event, context }) => {
  const { id, buyer, seller } = event.args;
  await context.db
    .update(schema.invoice, { id })
    .set({ status: STATUS.approved, approvedAt: event.block.timestamp });
  await publish(context, event, "InvoiceApproved", [buyer, seller], { invoiceId: id });
});

ponder.on("ZalInvoice:InvoiceRejected", async ({ event, context }) => {
  const { id, buyer, seller } = event.args;
  await context.db.update(schema.invoice, { id }).set({ status: STATUS.rejected });
  await publish(context, event, "InvoiceRejected", [buyer, seller], { invoiceId: id });
});

ponder.on("ZalInvoice:InvoiceCancelled", async ({ event, context }) => {
  const { id, buyer, seller } = event.args;
  await context.db.update(schema.invoice, { id }).set({ status: STATUS.cancelled });
  await publish(context, event, "InvoiceCancelled", [buyer, seller], { invoiceId: id });
});

ponder.on("ZalInvoice:InvoiceEscrowed", async ({ event, context }) => {
  const { id, amount } = event.args;
  const row = await context.db.update(schema.invoice, { id }).set({ escrowed: amount });
  await publish(context, event, "InvoiceEscrowed", [row.buyer, row.seller], { invoiceId: id });
});

ponder.on("ZalInvoice:InvoicePaid", async ({ event, context }) => {
  const { id, payer } = event.args;
  const row = await context.db.update(schema.invoice, { id }).set({ status: STATUS.paid, escrowed: 0n });
  await publish(context, event, "InvoicePaid", [row.buyer, row.seller], { invoiceId: id, actor: payer });
});

// The mint precedes InvoiceIssued in the same transaction, so a Transfer for an unknown id is skipped and
// InvoiceIssued sets the first owner.
ponder.on("ZalInvoice:Transfer", async ({ event, context }) => {
  const { tokenId, to } = event.args;
  const existing = await context.db.find(schema.invoice, { id: tokenId });
  if (existing === null) return;
  await context.db.update(schema.invoice, { id: tokenId }).set({ owner: to === zeroAddress ? null : to });
});
