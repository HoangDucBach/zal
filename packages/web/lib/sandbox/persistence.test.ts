import { describe, expect, test } from "vitest";

import { decodeSandbox, encodeSandbox } from "./persistence";

describe("sandbox persistence", () => {
  test("a journal survives a round trip", () => {
    const saved = {
      codeHash: "0xabc",
      offsetSeconds: 2_592_000,
      journal: [
        {
          kind: "tx",
          from: "0x1111111111111111111111111111111111111111",
          data: "0x60",
          timestamp: 10,
        },
        { kind: "mine", timestamp: 11 },
      ],
      scheduled: ["3"],
    } as const;

    expect(decodeSandbox(encodeSandbox(saved))).toEqual(saved);
  });

  test("anything else reads as nothing saved", () => {
    expect(decodeSandbox("not json")).toBeUndefined();
    expect(decodeSandbox(JSON.stringify({ version: 0 }))).toBeUndefined();
    expect(
      decodeSandbox(
        JSON.stringify({
          version: 1,
          codeHash: "x",
          offsetSeconds: 0,
          journal: [{ kind: "tx" }],
        }),
      ),
    ).toBeUndefined();
  });
});
