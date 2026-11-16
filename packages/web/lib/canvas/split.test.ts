import { describe, expect, test } from "vitest";
import { zeroAddress } from "viem";

import { type DraftLeg, legProblem, splitProblem, withKind } from "./split";
import { CLUB, VAULT } from "./test-fixtures";

const hold = (percent: string): DraftLeg => ({
  kind: "hold",
  target: zeroAddress,
  percent,
});
const transfer = (target: string, percent: string): DraftLeg => ({
  kind: "transfer",
  target,
  percent,
});

describe("Split validation mirrors setRoute (ZR-ACC-07, INV-02)", () => {
  test("a route of legs totalling 100% with a recipient on each transfer is valid", () => {
    expect(splitProblem([hold("40"), transfer(CLUB, "60")])).toBeUndefined();
  });

  test("a transfer leg to the zero address needs a recipient", () => {
    expect(legProblem(transfer(zeroAddress, "50"))).toBe("Recipient required");
    expect(splitProblem([hold("50"), transfer(zeroAddress, "50")])).toBe(
      "Recipient required",
    );
  });

  test("an empty or malformed recipient is rejected", () => {
    expect(legProblem(transfer("", "50"))).toBe("Recipient required");
    expect(legProblem(transfer("0x12", "50"))).toBe("Not an address");
  });

  test("hold and vault legs need no recipient", () => {
    expect(legProblem(hold("10"))).toBeUndefined();
    expect(
      legProblem({ kind: "vault", target: VAULT, percent: "10" }),
    ).toBeUndefined();
  });

  test("the total must be exactly 100%", () => {
    expect(splitProblem([hold("40"), transfer(CLUB, "50")])).toBe(
      "Total must be 100%",
    );
    expect(splitProblem([])).toBe("Total must be 100%");
  });

  test("a negative or non-numeric percent is rejected", () => {
    expect(legProblem(hold("-5"))).toBe("Percent must be 0 or more");
    expect(legProblem(hold("abc"))).toBe("Percent must be 0 or more");
  });

  test("at most 8 legs", () => {
    const legs = [...Array.from({ length: 8 }, () => hold("10")), hold("20")];

    expect(splitProblem(legs)).toBe("At most 8 legs");
  });
});

describe("changing a leg's kind", () => {
  test("hold → transfer clears the zero target instead of showing 0x000…", () => {
    expect(withKind(hold("10"), "transfer", VAULT).target).toBe("");
  });

  test("vault → transfer clears the vault address", () => {
    const vault: DraftLeg = { kind: "vault", target: VAULT, percent: "10" };

    expect(withKind(vault, "transfer", VAULT).target).toBe("");
  });

  test("→ vault points at the vault, → hold at nothing", () => {
    expect(withKind(hold("10"), "vault", VAULT).target).toBe(VAULT);
    expect(withKind(transfer(CLUB, "10"), "hold", VAULT).target).toBe(
      zeroAddress,
    );
  });

  test("picking the same kind keeps the recipient", () => {
    const leg = transfer(CLUB, "10");

    expect(withKind(leg, "transfer", VAULT)).toBe(leg);
  });
});
