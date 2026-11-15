import {
  encodeErrorResult,
  getContractError,
  RawContractError,
  type Address,
} from "viem";
import { describe, expect, test } from "vitest";

import { toAppError } from "./errors";

import {
  canvasAccountAbi,
  relationshipRegistryAbi,
  zalInvoiceAbi,
} from "@/contracts/abis";

const WALLET: Address = "0x1111111111111111111111111111111111111111";

/** What simulateContract throws when a call to a CanvasAccount reverts with `data`, built by viem's own mapper. */
const revertFromAccount = (
  data: `0x${string}`,
  functionName: string,
  args: readonly unknown[],
) =>
  getContractError(new RawContractError({ data }), {
    abi: canvasAccountAbi,
    functionName,
    args,
    address: WALLET,
  });

describe("toAppError", () => {
  test("a registry NotAccount bubbling through a CanvasAccount reads as plain language", () => {
    const error = revertFromAccount(
      encodeErrorResult({
        abi: relationshipRegistryAbi,
        errorName: "NotAccount",
        args: [WALLET],
      }),
      "proposeRelationship",
      [WALLET, 1, 0n],
    );

    expect(error.shortMessage).toContain("0x603872fc");
    const app = toAppError(error);

    expect(app.kind).toBe("contract");
    expect(app.message).toBe("Not a Zal canvas");
    expect(app.kind === "contract" && app.errorName).toBe("NotAccount");
  });

  test("an invoice error from a gated call also decodes", () => {
    const error = revertFromAccount(
      encodeErrorResult({
        abi: zalInvoiceAbi,
        errorName: "AlreadyEscrowed",
        args: [7n],
      }),
      "escrowInvoice",
      [7n],
    );

    expect(toAppError(error).message).toBe("Already escrowed");
  });

  test("a revert no Zal ABI knows keeps viem's message", () => {
    const error = revertFromAccount("0xdeadbeef", "proposeRelationship", [
      WALLET,
      1,
      0n,
    ]);

    expect(toAppError(error).message).toBe(error.shortMessage);
  });
});
