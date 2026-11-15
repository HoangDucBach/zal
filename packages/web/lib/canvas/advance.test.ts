import type { Invoice, PoolState } from "./types";

import { describe, expect, test } from "vitest";

import { advanceEligibility } from "./advance";

const POOL = "0x00000000000000000000000000000000000000c3" as const;
const SELLER = "0x00000000000000000000000000000000000000a1" as const;
const pool: PoolState = {
  address: POOL,
  idleCash: 0n,
  totalAssets: 0n,
  advanceRateBps: 8000,
  annualFeeBps: 0,
};
const face = 5_000_000_000n;
const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 1n,
  relationshipId: 1n,
  seller: SELLER,
  buyer: "0x00000000000000000000000000000000000000b2",
  faceValue: face,
  escrowed: 0n,
  issuedAt: 0,
  dueDate: 1_000,
  approvedAt: 1,
  status: "approved",
  docHash: "0x00",
  owner: SELLER,
  advance: undefined,
  buyerCredit: { limit: 0n, outstanding: 0n },
  ...over,
});

describe("the pool advances against escrow or an enrolled buyer (ADR 0009)", () => {
  test("an escrowed invoice qualifies without credit", () => {
    expect(advanceEligibility(invoice({ escrowed: face }), pool, 0)).toEqual({
      ok: true,
      path: "escrow",
    });
  });

  test("an unescrowed invoice of an enrolled buyer qualifies within the limit", () => {
    expect(
      advanceEligibility(
        invoice({ buyerCredit: { limit: face, outstanding: 0n } }),
        pool,
        0,
      ),
    ).toEqual({ ok: true, path: "credit" });
  });

  test("an unenrolled buyer that has not escrowed is refused with a reason", () => {
    const result = advanceEligibility(invoice(), pool, 0);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/not enrolled/);
  });

  test("a full credit line is refused", () => {
    const result = advanceEligibility(
      invoice({ buyerCredit: { limit: face, outstanding: 2_000_000_000n } }),
      pool,
      0,
    );

    expect(!result.ok && result.reason).toMatch(/credit line/);
  });

  test("not approved, past due, or already financed are refused", () => {
    expect(
      advanceEligibility(invoice({ status: "issued", escrowed: face }), pool, 0)
        .ok,
    ).toBe(false);
    expect(
      advanceEligibility(invoice({ escrowed: face }), pool, 1_000).ok,
    ).toBe(false);
    expect(
      advanceEligibility(invoice({ escrowed: face, owner: POOL }), pool, 0).ok,
    ).toBe(false);
  });
});
