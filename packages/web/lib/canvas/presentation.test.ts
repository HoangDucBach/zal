import { afterEach, describe, expect, test, vi } from "vitest";

import { layoutStorageKey } from "./layout";
import { notificationsStorageKey } from "./notifications";
import {
  clearPresentation,
  presentationEpoch,
  presentationKeys,
  subscribePresentation,
} from "./presentation";

const SANDBOX = 31_337;
const LIVE = 43_114;

describe("sandbox Reset clears the chain's presentation", () => {
  test("every layout and notification key of the reset chain goes, other chains and other data stay", () => {
    const keys = [
      layoutStorageKey(SANDBOX, "0xAbC"),
      notificationsStorageKey(SANDBOX, "0xDeF"),
      `zal.canvas-layout.v0:${SANDBOX}:0xabc`,
      `zal.notifications.v7:${SANDBOX}:0xdef`,
      layoutStorageKey(LIVE, "0xAbC"),
      notificationsStorageKey(LIVE, "0xDeF"),
      `zal.canvas-layout.v1:${SANDBOX}0:0xabc`,
      "zal.sandbox.journal:0xabc",
      "theme",
    ];

    expect(presentationKeys(keys, SANDBOX)).toEqual(keys.slice(0, 4));
  });
});

describe("clearPresentation", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("removes the stored keys and tells every holder to reload", () => {
    const stored = new Map([
      [layoutStorageKey(SANDBOX, "0xabc"), "{}"],
      [layoutStorageKey(LIVE, "0xabc"), "{}"],
    ]);
    const keys = () => [...stored.keys()];

    vi.stubGlobal("window", {
      localStorage: {
        get length() {
          return stored.size;
        },
        key: (i: number) => keys()[i] ?? null,
        removeItem: (key: string) => stored.delete(key),
      },
    });
    const before = presentationEpoch();
    const reloaded = vi.fn();
    const unsubscribe = subscribePresentation(reloaded);

    clearPresentation(SANDBOX);
    unsubscribe();

    expect(keys()).toEqual([layoutStorageKey(LIVE, "0xabc")]);
    expect(presentationEpoch()).toBe(before + 1);
    expect(reloaded).toHaveBeenCalledOnce();
  });
});
