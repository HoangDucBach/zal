import { getAddress } from "viem";
import { describe, expect, test } from "vitest";

import { keysForStreamEvent, parseStreamEvent } from "./stream";

import { queryKeys } from "@/lib/query/keys";

const ACCOUNT = "0x206a7e277be02587782007fdb172a7668db60047";
const feed = JSON.stringify({
  subjects: [ACCOUNT],
  name: "InvoiceIssued",
  key: `0x${"ab".repeat(32)}:1`,
  blockNumber: "63",
  logIndex: 1,
  transactionHash: `0x${"ab".repeat(32)}`,
  timestamp: 1_800_057_494,
  relationshipId: null,
  invoiceId: "3",
  opId: null,
  budgetId: null,
});

describe("stream events", () => {
  test("a feed event carries its id and parsed ids", () => {
    const event = parseStreamEvent("feed", feed, "63-1");

    expect(event).toMatchObject({ type: "feed", id: "63-1" });
    expect(event?.type === "feed" && event.feed.invoiceId).toBe(3n);
  });

  test("a layout event names the account checksummed and its revision", () => {
    expect(
      parseStreamEvent(
        "layout",
        JSON.stringify({ account: ACCOUNT, revision: 5 }),
        "",
      ),
    ).toEqual({ type: "layout", account: getAddress(ACCOUNT), revision: 5 });
  });

  test("ready and reset parse; unknown types and broken bodies are ignored", () => {
    expect(parseStreamEvent("ready", '{"cursor":"70-3"}', "")).toEqual({
      type: "ready",
      cursor: "70-3",
      asOfBlock: undefined,
    });
    expect(
      parseStreamEvent(
        "ready",
        '{"cursor":"70-3","asOf":{"block":72,"updatedAt":1800000000}}',
        "",
      ),
    ).toEqual({ type: "ready", cursor: "70-3", asOfBlock: 72 });
    expect(parseStreamEvent("reset", "{}", "")).toEqual({ type: "reset" });
    expect(parseStreamEvent("ping", "{}", "")).toBeUndefined();
    expect(parseStreamEvent("feed", "not json", "1-1")).toBeUndefined();
    expect(parseStreamEvent("feed", '{"name":"X"}', "1-1")).toBeUndefined();
  });
});

describe("invalidation map", () => {
  const chainId = 31_337;
  const wallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
  /** TanStack matches by prefix: a key invalidates every query it prefixes. */
  const covers = (
    keys: readonly (readonly unknown[])[],
    query: readonly unknown[],
  ) => keys.some((key) => key.every((part, i) => part === query[i]));
  const canvas = queryKeys.canvas(chainId, wallet);
  const notifications = queryKeys.notifications(chainId, wallet, wallet);
  const balance = queryKeys.balance(chainId, wallet);
  const sandbox = queryKeys.canvas(7_357_001, wallet);

  test("a feed event refreshes every read on the chain, and nothing on another chain", () => {
    const keys = keysForStreamEvent(
      chainId,
      parseStreamEvent("feed", feed, "63-1")!,
    );

    expect(covers(keys, canvas)).toBe(true);
    expect(covers(keys, notifications)).toBe(true);
    expect(covers(keys, balance)).toBe(true);
    expect(covers(keys, sandbox)).toBe(false);
  });

  test("a layout event refreshes the canvas snapshot only", () => {
    const keys = keysForStreamEvent(chainId, {
      type: "layout",
      account: getAddress(ACCOUNT),
      revision: 2,
    });

    expect(covers(keys, canvas)).toBe(true);
    expect(covers(keys, notifications)).toBe(false);
    expect(covers(keys, balance)).toBe(false);
  });

  test("reset refetches everything", () => {
    expect(
      covers(keysForStreamEvent(chainId, { type: "reset" }), notifications),
    ).toBe(true);
  });

  test("ready catches up unless the page's snapshots already reach the API's head", () => {
    const ready = { type: "ready", cursor: "1-0", asOfBlock: 40 } as const;

    expect(covers(keysForStreamEvent(chainId, ready), canvas)).toBe(true);
    expect(covers(keysForStreamEvent(chainId, ready, 39), canvas)).toBe(true);
    expect(keysForStreamEvent(chainId, ready, 40)).toEqual([]);
    expect(
      covers(
        keysForStreamEvent(chainId, { ...ready, asOfBlock: undefined }, 40),
        canvas,
      ),
    ).toBe(true);
  });
});
