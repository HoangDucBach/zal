import { describe, expect, test } from "vitest";

import { signaturesNeeded } from "./spend-window";

const usdc = (n: number) => BigInt(n) * 1_000_000n;
const club = { threshold: 2, approvalLimit: usdc(1_000) };

describe("signaturesNeeded (ZR-ACC-11)", () => {
  test("an op that fits what is left of the allowance needs one signature", () => {
    expect(signaturesNeeded(club, { spent: usdc(400) }, usdc(600))).toBe(1);
  });

  test("an op that takes the window over the limit needs the threshold", () => {
    expect(signaturesNeeded(club, { spent: usdc(600) }, usdc(600))).toBe(2);
    expect(signaturesNeeded(club, { spent: usdc(400) }, usdc(600) + 1n)).toBe(
      2,
    );
  });

  test("a split under the limit still counts what the window already spent", () => {
    expect(signaturesNeeded(club, { spent: usdc(1_000) }, 1n)).toBe(2);
  });

  test("an empty window is the per-op rule", () => {
    expect(signaturesNeeded(club, { spent: 0n }, usdc(1_000))).toBe(1);
    expect(signaturesNeeded(club, { spent: 0n }, usdc(1_001))).toBe(2);
  });

  test("a one-of-one account always needs one", () => {
    const wallet = { threshold: 1, approvalLimit: 0n };

    expect(signaturesNeeded(wallet, { spent: usdc(9_000) }, usdc(5_000))).toBe(
      1,
    );
  });
});
