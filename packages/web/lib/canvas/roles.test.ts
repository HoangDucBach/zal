// Member roles on a canvas the wallet opened from the switcher: what the palette offers and what a write may send.
import type { MemberRole } from "./types";

import { describe, expect, test } from "vitest";

import { buildCanvasGraph, nodeId } from "./graph";
import { canConnect, palette, type PaletteContext } from "./palette";
import { allows, ROLE_FOR_CALL } from "./roles";
import { VAULT, account, invoice, rel, state } from "./test-fixtures";

const LIVE: PaletteContext = { keeper: false, scheduled: [] };

/** A canvas that buys from CLUB: an issued invoice to approve, a budget to charge, two members. */
const buyer = (myRole: MemberRole) =>
  state({
    account: account({
      myRole,
      budgets: [
        {
          id: 1n,
          limit: 10_000_000_000n,
          used: 0n,
          periodStart: 0,
          periodLength: 2_592_000,
        },
      ],
      members: [
        {
          address: "0x00000000000000000000000000000000000000e5",
          role: "admin",
        },
        {
          address: "0x00000000000000000000000000000000000000e6",
          role: "approver",
        },
      ],
    }),
    relationships: [
      rel({
        buyer: account().address,
        seller: "0x00000000000000000000000000000000000000b2",
        status: "active",
      }),
    ],
    invoices: [
      invoice({
        buyer: account().address,
        seller: "0x00000000000000000000000000000000000000b2",
        owner: "0x00000000000000000000000000000000000000b2",
      }),
    ],
  });
const invoiceNode = (s: ReturnType<typeof buyer>) => {
  const data = buildCanvasGraph(s, { vault: VAULT }).nodes.find(
    (n) => n.id === nodeId.invoice(7n),
  )?.data;

  if (data === undefined) throw new Error("no invoice node");

  return data;
};
const ready = (
  s: ReturnType<typeof buyer>,
  target = undefined as ReturnType<typeof invoiceNode> | undefined,
) =>
  palette(s, target, LIVE)
    .filter(
      (e) =>
        e.availability.status === "ready" || e.availability.status === "draft",
    )
    .map((e) => e.component);

describe("member roles", () => {
  test("a viewer is read-only: the palette offers nothing a canvas role signs, and places no drafts", () => {
    const s = buyer("viewer");

    expect(ready(s)).toEqual(["liquidity"]);
    expect(ready(s, invoiceNode(s))).toEqual([]);
  });

  test("an approver approves an invoice it pays against a budget, and nothing an admin signs", () => {
    const s = buyer("approver");

    expect(ready(s, invoiceNode(s))).toEqual(["budget"]);
    expect(ready(s)).toEqual(["liquidity"]);
  });

  test("an admin keeps every action", () => {
    const s = buyer("admin");

    expect(ready(s)).toEqual(
      expect.arrayContaining(["counterparty", "split", "budget", "approval"]),
    );
  });

  test("a connection a viewer draws is refused with the rule", () => {
    const s = buyer("viewer");
    const budget = buildCanvasGraph(s, { vault: VAULT }).nodes.find(
      (n) => n.id === nodeId.budget(1n),
    )?.data;

    if (budget === undefined) throw new Error("no budget node");
    expect(
      canConnect(
        { kind: "node", data: budget },
        { kind: "node", data: invoiceNode(s) },
        s,
        LIVE,
      ),
    ).toEqual({
      ok: false,
      reason: "Approvers and admins only",
    });
  });

  test("the write gate matches the contract: approvers confirm, revoke and submit; admins do the rest", () => {
    const approverCalls = Object.entries(ROLE_FOR_CALL)
      .filter(([, needed]) => allows("approver", needed))
      .map(([call]) => call)
      .sort();

    expect(approverCalls).toEqual(["confirm", "revoke", "submit"]);
    expect(
      Object.keys(ROLE_FOR_CALL).filter((call) =>
        allows("viewer", ROLE_FOR_CALL[call as keyof typeof ROLE_FOR_CALL]),
      ),
    ).toEqual([]);
  });
});
