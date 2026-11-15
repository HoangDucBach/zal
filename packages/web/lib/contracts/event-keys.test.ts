import { describe, expect, test } from "vitest";

import { keysForEvent } from "./event-keys";

import { queryKeys } from "@/lib/query/keys";

const A = "0x00000000000000000000000000000000000000a1" as const;
const B = "0x00000000000000000000000000000000000000b2" as const;

describe("each contract event invalidates what it changed", () => {
  test("every event refreshes the canvases", () => {
    expect(
      keysForEvent(1, {
        contract: "vault",
        address: A,
        eventName: "Deposit",
        args: {},
      }),
    ).toContainEqual(queryKeys.canvases(1));
  });

  test("an invoice event refreshes that invoice, an NFT transfer too", () => {
    expect(
      keysForEvent(1, {
        contract: "invoices",
        address: A,
        eventName: "InvoiceApproved",
        args: { id: 3n },
      }),
    ).toContainEqual(queryKeys.invoice(1, 3n));
    expect(
      keysForEvent(1, {
        contract: "invoices",
        address: A,
        eventName: "Transfer",
        args: { tokenId: 3n },
      }),
    ).toContainEqual(queryKeys.invoice(1, 3n));
  });

  test("an advance refreshes the pool and the invoice it funded", () => {
    const keys = keysForEvent(1, {
      contract: "pool",
      address: A,
      eventName: "Advanced",
      args: { invoiceId: 9n },
    });

    expect(keys).toContainEqual(queryKeys.pool(1));
    expect(keys).toContainEqual(queryKeys.invoice(1, 9n));
  });

  test("a USDC transfer refreshes both balances", () => {
    const keys = keysForEvent(1, {
      contract: "usdc",
      address: A,
      eventName: "Transfer",
      args: { from: A, to: B },
    });

    expect(keys).toContainEqual(queryKeys.balance(1, A));
    expect(keys).toContainEqual(queryKeys.balance(1, B));
  });

  test("an account event refreshes that account, and a routed payment the vault and balances", () => {
    const keys = keysForEvent(1, {
      contract: "account",
      address: B,
      eventName: "PaymentRouted",
      args: {},
    });

    expect(keys).toContainEqual(queryKeys.account(1, B));
    expect(keys).toContainEqual(queryKeys.vault(1));
    expect(keys).toContainEqual(queryKeys.balances(1));
  });

  test("a new account refreshes its admin's lookup", () => {
    expect(
      keysForEvent(5, {
        contract: "factory",
        address: A,
        eventName: "AccountCreated",
        args: { account: B, admin: A },
      }),
    ).toContainEqual(queryKeys.accountOf(5, A));
  });
});
