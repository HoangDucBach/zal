// The explorer's pure rules: Transfer classification, tx kinds, daily aggregation, cursors, search and chart windows.

import { encodeEventTopics, pad, toHex, type Address, type Hex } from "viem";
import { describe, expect, test } from "vitest";

import { zalInvoiceAbi, zusdcAbi } from "../abis/index.ts";
import {
  aggregateDay,
  classifyTransfer,
  cleanTokenText,
  dayOf,
  selectorOf,
  TRANSFER_TOPIC,
  txKind,
} from "../lib/explorer/chain.ts";
import { decodeZalLog, methodName } from "../lib/explorer/decode.ts";
import { chartWindow, classifySearch, decodeCursor, encodeCursor, escapeLike, fillDays, MAX_CHART_DAYS } from "../lib/explorer/wire.ts";

const TOKEN: Address = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const A: Address = "0x1111111111111111111111111111111111111111";
const B: Address = "0x2222222222222222222222222222222222222222";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const topic = (a: Address) => pad(a, { size: 32 });

describe("classifyTransfer", () => {
  test("3 topics and a 32-byte value is ERC-20", () => {
    expect(
      classifyTransfer({ address: TOKEN, topics: [TRANSFER_TOPIC, topic(A), topic(B)], data: pad(toHex(500n)), logIndex: 0 }),
    ).toEqual({ standard: "erc20", token: TOKEN, from: A, to: B, value: 500n });
  });

  test("4 topics and no data is ERC-721", () => {
    expect(
      classifyTransfer({ address: TOKEN, topics: [TRANSFER_TOPIC, topic(ZERO), topic(B), pad(toHex(7n))], data: "0x", logIndex: 3 }),
    ).toEqual({ standard: "erc721", token: TOKEN, from: ZERO, to: B, tokenId: 7n });
  });

  test("the topic matches what the Zal ABIs emit, for both standards", () => {
    const [erc20] = encodeEventTopics({ abi: zusdcAbi, eventName: "Transfer" });
    const [erc721] = encodeEventTopics({ abi: zalInvoiceAbi, eventName: "Transfer" });
    expect(erc20).toBe(TRANSFER_TOPIC);
    expect(erc721).toBe(TRANSFER_TOPIC);
  });

  test.each<[string, Hex[], Hex]>([
    ["another event", [pad("0x01"), topic(A), topic(B)], pad(toHex(1n))],
    ["too few topics", [TRANSFER_TOPIC, topic(A)], pad(toHex(1n))],
    ["ERC-20 shape with short data", [TRANSFER_TOPIC, topic(A), topic(B)], "0x01"],
    ["ERC-721 shape with data", [TRANSFER_TOPIC, topic(A), topic(B), pad(toHex(1n))], pad(toHex(1n))],
    ["a topic that is not an address", [TRANSFER_TOPIC, pad("0xff", { dir: "right" }), topic(B)], pad(toHex(1n))],
  ])("%s is not a transfer", (_name, topics, data) => {
    expect(classifyTransfer({ address: TOKEN, topics, data, logIndex: 0 })).toBeUndefined();
  });
});

describe("txKind", () => {
  const base = { to: B, toZal: false, hasTokenTransfer: false, input: "0x" as Hex, value: 0n };
  test.each([
    ["deploy", { ...base, to: null, toZal: true }],
    ["zal", { ...base, toZal: true, hasTokenTransfer: true }],
    ["token", { ...base, hasTokenTransfer: true, value: 1n }],
    ["native", { ...base, value: 1n }],
    ["other", { ...base, input: "0x12345678", value: 1n }],
    ["other", base],
  ] as const)("%s", (kind, input) => {
    expect(txKind(input)).toBe(kind);
  });
});

describe("aggregateDay", () => {
  test("sums gas and fees, counts kinds and distinct from/to addresses", () => {
    const delta = aggregateDay([
      { from: A, to: B, kind: "zal", gasUsed: 100n, fee: 1_000n },
      { from: A, to: null, kind: "deploy", gasUsed: 50n, fee: 500n },
      { from: B, to: A, kind: "native", gasUsed: 21n, fee: 210n },
    ]);
    expect(delta.txCount).toBe(3);
    expect(delta.gasUsed).toBe(171n);
    expect(delta.fees).toBe(1_710n);
    expect(delta.kinds).toEqual({ zal: 1, token: 0, native: 1, deploy: 1, other: 0 });
    expect([...delta.addresses].sort()).toEqual([A, B]);
  });

  test("an empty block adds nothing", () => {
    expect(aggregateDay([])).toEqual({
      txCount: 0,
      gasUsed: 0n,
      fees: 0n,
      kinds: { zal: 0, token: 0, native: 0, deploy: 0, other: 0 },
      addresses: [],
    });
  });

  test("days are UTC", () => {
    expect(dayOf(0n)).toBe(0);
    expect(dayOf(86_399)).toBe(0);
    expect(dayOf(86_400n)).toBe(1);
  });
});

describe("decoding", () => {
  test("selectors and Zal method names", () => {
    expect(selectorOf("0x")).toBeNull();
    expect(selectorOf("0xa9059cbb00")).toBe("0xa9059cbb");
    expect(methodName("0xa9059cbb")).toBe("transfer");
    expect(methodName("0xdeadbeef")).toBeNull();
  });

  test("an ERC-721 Transfer decodes with tokenId, an ERC-20 one with value", () => {
    expect(decodeZalLog([TRANSFER_TOPIC, topic(A), topic(B), pad(toHex(9n))], "0x")).toEqual({
      name: "Transfer",
      args: { from: A, to: B, tokenId: "9" },
    });
    expect(decodeZalLog([TRANSFER_TOPIC, topic(A), topic(B)], pad(toHex(5n)))).toEqual({
      name: "Transfer",
      args: { from: A, to: B, value: "5" },
    });
    expect(decodeZalLog([pad("0x01")], "0x")).toBeNull();
  });

  test("token text keeps printable characters and at most 64 of them", () => {
    expect(cleanTokenText(" zUSDC\u0000 ")).toBe("zUSDC");
    expect(cleanTokenText("x".repeat(100))).toHaveLength(64);
    expect(cleanTokenText(42)).toBeNull();
    expect(cleanTokenText("\n")).toBeNull();
  });
});

describe("cursors", () => {
  test("round-trip", () => {
    const cursor = encodeCursor([12n, 3]);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, ["uint", "uint"])).toEqual(["12", "3"]);
    expect(decodeCursor(encodeCursor([5, A]), ["uint", "address"])).toEqual(["5", A]);
  });

  test.each([
    ["empty", ""],
    ["not base64url", "abc$"],
    ["wrong arity", encodeCursor([1])],
    ["wrong part", encodeCursor([1, "x"])],
    ["negative", encodeCursor([-1, 2])],
    ["too long", "A".repeat(300)],
  ])("%s is rejected", (_name, text) => {
    expect(decodeCursor(text, ["uint", "uint"])).toBeUndefined();
  });

  test("an uppercase address is not a cursor part", () => {
    expect(decodeCursor(encodeCursor([1, "0x5FbDB2315678afecb367f032d93F642f64180aa3"]), ["uint", "address"])).toBeUndefined();
  });
});

describe("classifySearch", () => {
  test.each([
    ["  ", undefined],
    ["0x5FbDB2315678afecb367f032d93F642f64180aa3", { kind: "address", address: TOKEN }],
    [pad("0xAB"), { kind: "hash", hash: pad("0xab") }],
    ["42", { kind: "block", number: 42n }],
    ["#7", { kind: "invoice", id: 7n }],
    ["zus", { kind: "text", prefix: "zus" }],
    ["0x1234", { kind: "text", prefix: "0x1234" }],
    ["#x", { kind: "text", prefix: "#x" }],
  ])("%j", (q, expected) => {
    expect(classifySearch(q)).toEqual(expected);
  });

  test("LIKE wildcards match literally", () => {
    expect(escapeLike("a%b_c\\")).toBe("a\\%b\\_c\\\\");
  });
});

describe("charts", () => {
  test("fixed ranges end at the last day", () => {
    expect(chartWindow("1d", 100, 1)).toEqual({ from: 100, to: 100 });
    expect(chartWindow("1w", 100, 1)).toEqual({ from: 94, to: 100 });
    expect(chartWindow("1m", 100, 1)).toEqual({ from: 71, to: 100 });
  });

  test("all starts at the first day, bounded", () => {
    expect(chartWindow("all", 100, 90)).toEqual({ from: 90, to: 100 });
    expect(chartWindow("all", 100, undefined)).toEqual({ from: 100, to: 100 });
    expect(chartWindow("all", 10_000, 0).from).toBe(10_000 - MAX_CHART_DAYS + 1);
  });

  test("missing days are zero-filled, oldest first", () => {
    const days = fillDays({ from: 1, to: 3 }, [{ day: 2, n: 5 }], (day) => ({ day, n: 0 }));
    expect(days).toEqual([
      { day: 1, n: 0 },
      { day: 2, n: 5 },
      { day: 3, n: 0 },
    ]);
  });
});

describe("block notices", () => {
  test("round-trip on the feed channel; a malformed number is dropped", async () => {
    const { decodeNotice, encodeNotice, EXPLORER_SUBJECT } = await import("../lib/feed-channel.ts");
    const notice = { kind: "block", subject: EXPLORER_SUBJECT, number: "42" } as const;
    expect(decodeNotice(encodeNotice(notice))).toEqual(notice);
    expect(decodeNotice(JSON.stringify({ ...notice, number: "4x" }))).toBeUndefined();
  });
});
