import { describe, expect, it } from "vitest";

import { classifySearch, directHref, resultHref } from "./search";

const ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const HASH = `0x${"Ab".repeat(32)}`;

describe("classifySearch", () => {
  it("routes an address and a block number directly", () => {
    expect(directHref(classifySearch(` ${ADDRESS.toLowerCase()} `))).toBe(
      `/app/explorer/address/${ADDRESS.toLowerCase()}`,
    );
    expect(directHref(classifySearch("120"))).toBe("/app/explorer/block/120");
  });

  it("leaves a 32-byte hash to the API: it may be a tx or a block", () => {
    const query = classifySearch(HASH);

    expect(query).toEqual({ kind: "hash", hash: HASH.toLowerCase() });
    expect(directHref(query)).toBeUndefined();
  });

  it("sends text, an invoice id and malformed hex to the API", () => {
    for (const text of ["zUSDC", "#12", "0x1234", "Zal canvas"])
      expect(classifySearch(text).kind).toBe("text");
    expect(classifySearch("   ").kind).toBe("empty");
  });
});

describe("resultHref", () => {
  it("opens each result type", () => {
    expect(resultHref({ type: "tx", id: HASH, label: null }, undefined)).toBe(
      `/app/explorer/tx/${HASH.toLowerCase()}`,
    );
    expect(resultHref({ type: "block", id: "7", label: null }, undefined)).toBe(
      "/app/explorer/block/7",
    );
    expect(
      resultHref({ type: "invoice", id: "12", label: null }, ADDRESS),
    ).toBe(`/app/explorer/token/${ADDRESS.toLowerCase()}`);
    expect(
      resultHref({ type: "invoice", id: "12", label: null }, undefined),
    ).toBeUndefined();
  });
});
