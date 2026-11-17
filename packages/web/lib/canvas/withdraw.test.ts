import { describe, expect, test } from "vitest";
import { getAddress, zeroAddress } from "viem";

import { withdrawInput } from "./withdraw";
import { CLUB } from "./test-fixtures";

const BALANCE = 500_000_000n;

describe("Account withdraw form builds the gated withdraw call", () => {
  test("a valid address and amount within the balance give the call", () => {
    expect(withdrawInput(CLUB.toLowerCase(), "120.5", BALANCE)).toEqual({
      ok: true,
      call: { fn: "withdraw", to: getAddress(CLUB), amount: 120_500_000n },
    });
  });

  test("the whole balance can be withdrawn", () => {
    expect(withdrawInput(CLUB, "500", BALANCE).ok).toBe(true);
  });

  test.each([
    ["", "10", "To: a 0x address"],
    ["0x123", "10", "To: a 0x address"],
    [zeroAddress, "10", "To: not the zero address"],
    [CLUB, "abc", "Amount: zUSDC, up to 6 decimals"],
    [CLUB, "1.0000001", "Amount: zUSDC, up to 6 decimals"],
    [CLUB, "0", "Amount: above 0"],
    [CLUB, "500.000001", "Above balance"],
  ])("to %s, amount %s is refused: %s", (to, amount, reason) => {
    expect(withdrawInput(to, amount, BALANCE)).toEqual({ ok: false, reason });
  });
});
