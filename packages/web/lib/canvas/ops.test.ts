import type { Invoice, PendingOp } from "./types";

import { describe, expect, test } from "vitest";

import { opDisagreement as opViewDisagreement } from "./ops";

const opDisagreement = (api: PendingOp, chain: PendingOp) =>
  opViewDisagreement(
    { op: api, invoice: undefined },
    { op: chain, invoice: undefined },
  );

const chain: PendingOp = {
  opId: 3n,
  call: {
    fn: "withdraw",
    to: "0x00000000000000000000000000000000000000A1",
    amount: 2_000_000n,
  },
  amount: 2_000_000n,
  confirmations: 1,
  required: 2,
  executed: false,
  stale: false,
  confirmedByMe: false,
};

describe("pending op: API against chain", () => {
  test("an API op that matches the chain (addresses in any case) raises no flag", () => {
    expect(
      opDisagreement(
        {
          ...chain,
          call: {
            ...chain.call,
            to: "0x00000000000000000000000000000000000000a1",
          } as never,
        },
        chain,
      ),
    ).toEqual([]);
  });

  test("a tampered recipient, amount or signature count is named", () => {
    expect(
      opDisagreement(
        {
          ...chain,
          call: {
            fn: "withdraw",
            to: "0x00000000000000000000000000000000000000b2",
            amount: 1n,
          },
          amount: 1n,
          confirmations: 2,
        },
        chain,
      ),
    ).toEqual(["call", "amount", "signatures"]);
  });

  test("another call on the same op id is a call difference", () => {
    expect(
      opDisagreement(
        { ...chain, call: { fn: "payInvoice", invoiceId: 1n } },
        chain,
      ),
    ).toEqual(["call"]);
  });
});

const INVOICE: Invoice = {
  id: 7n,
  relationshipId: 1n,
  seller: "0x00000000000000000000000000000000000000C1",
  buyer: "0x00000000000000000000000000000000000000B1",
  faceValue: 4_000_000_000n,
  escrowed: 0n,
  issuedAt: 1,
  dueDate: 2,
  approvedAt: 1,
  status: "approved",
  docHash: "0x11",
  owner: "0x00000000000000000000000000000000000000C1",
  advance: undefined,
  buyerCredit: { limit: 0n, outstanding: 0n },
};
const payOp: PendingOp = {
  ...chain,
  call: { fn: "payInvoice", invoiceId: 7n },
  amount: INVOICE.faceValue,
};

describe("invoice op: the invoice it pays, API against chain", () => {
  test("the same invoice (addresses in any case) raises no flag", () => {
    expect(
      opViewDisagreement(
        {
          op: payOp,
          invoice: {
            ...INVOICE,
            owner: "0x00000000000000000000000000000000000000c1",
          },
        },
        { op: payOp, invoice: INVOICE },
      ),
    ).toEqual([]);
  });

  test("an API invoice with another face value, status or recipient is named, though the op itself agrees", () => {
    expect(
      opViewDisagreement(
        {
          op: payOp,
          invoice: {
            ...INVOICE,
            faceValue: 1_000_000n,
            status: "issued",
            owner: "0x00000000000000000000000000000000000000E1",
          },
        },
        { op: payOp, invoice: INVOICE },
      ),
    ).toEqual(["invoice face value", "invoice status", "invoice recipient"]);
  });

  test("an invoice op whose invoice the API does not serve is named", () => {
    expect(
      opViewDisagreement(
        { op: payOp, invoice: undefined },
        { op: payOp, invoice: INVOICE },
      ),
    ).toEqual(["invoice missing"]);
  });
});
