// A pending op, and the invoice it acts on, as the API describes them against what the chain stores. The Inspector
// shows the chain's version and signs only that; a disagreement is named, not hidden.

import type { GatedCall, Invoice, PendingOp } from "./types";

import { isAddressEqual, type Address } from "viem";

import { formatUsdc, shortAddress } from "@/lib/format";

export const opLabel = (call: GatedCall): string => {
  switch (call.fn) {
    case "approveInvoice":
      return `Approve invoice #${call.invoiceId}${call.budgetId === 0n ? "" : ` (budget #${call.budgetId})`}`;
    case "escrowInvoice":
      return `Escrow invoice #${call.invoiceId}`;
    case "payInvoice":
      return `Pay invoice #${call.invoiceId}`;
    case "withdraw":
      return `Withdraw ${formatUsdc(call.amount)} to ${shortAddress(call.to)}`;
    case "createSchedule":
      return call.kind === "payInvoice"
        ? `Schedule invoice #${call.invoiceId} payment`
        : `Schedule ${call.runs} × ${formatUsdc(call.amount)} to ${call.recipient === undefined ? "?" : shortAddress(call.recipient)}`;
  }
};

/** The invoice an op pays, escrows or approves; `undefined` for a withdrawal or a scheduled transfer. */
export function invoiceOf(call: GatedCall): bigint | undefined {
  switch (call.fn) {
    case "withdraw":
      return undefined;
    case "createSchedule":
      return call.invoiceId;
    default:
      return call.invoiceId;
  }
}

const sameCall = (a: GatedCall, b: GatedCall): boolean =>
  a.fn === b.fn &&
  (Object.keys(a) as (keyof GatedCall)[]).every(
    (k) =>
      String(a[k]).toLowerCase() ===
      String((b as Record<string, unknown>)[k]).toLowerCase(),
  );

/** An op and the invoice it acts on, as one side (the API or the chain) describes them. */
export interface OpView {
  readonly op: PendingOp;
  /** The invoice an invoice op refers to; `undefined` for a withdrawal, or when that side has no such invoice. */
  readonly invoice: Invoice | undefined;
}

const sameAddress = (a: Address | undefined, b: Address | undefined) =>
  a === undefined || b === undefined ? a === b : isAddressEqual(a, b);

/** The invoice fields that decide what Confirm moves and to whom, where the API differs from the chain. */
export function invoiceDisagreement(
  api: Invoice | undefined,
  chain: Invoice,
): readonly string[] {
  if (api === undefined) return ["missing"];
  const fields: string[] = [];

  if (api.faceValue !== chain.faceValue) fields.push("face value");
  if (api.status !== chain.status) fields.push("status");
  if (!sameAddress(api.owner, chain.owner)) fields.push("recipient");
  if (
    !sameAddress(api.buyer, chain.buyer) ||
    !sameAddress(api.seller, chain.seller)
  )
    fields.push("parties");
  if (api.escrowed !== chain.escrowed) fields.push("escrow");
  if (api.dueDate !== chain.dueDate) fields.push("due date");

  return fields;
}

/** The fields where the API's op, or the invoice it acts on, differs from the chain's: empty when they agree. */
export function opDisagreement(api: OpView, chain: OpView): readonly string[] {
  const fields: string[] = [];

  if (!sameCall(api.op.call, chain.op.call)) fields.push("call");
  if (api.op.amount !== chain.op.amount) fields.push("amount");
  if (
    api.op.confirmations !== chain.op.confirmations ||
    api.op.required !== chain.op.required
  )
    fields.push("signatures");
  if (api.op.executed !== chain.op.executed || api.op.stale !== chain.op.stale)
    fields.push("status");
  if (chain.invoice !== undefined)
    fields.push(
      ...invoiceDisagreement(api.invoice, chain.invoice).map(
        (f) => `invoice ${f}`,
      ),
    );

  return fields;
}
