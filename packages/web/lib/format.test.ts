import { describe, expect, test } from "vitest";

import {
  formatBps,
  formatDaysFrom,
  formatTimeFrom,
  formatNative,
  formatToken,
  formatUsdc,
  parseUsdc,
} from "./format";

describe("amount formatting", () => {
  test("USDC base units read as dollars with cents, keeping every base unit", () => {
    expect(formatUsdc(5_000_000_000n)).toBe("5,000.00");
    expect(formatUsdc(50_013_699n)).toBe("50.013699");
    expect(formatUsdc(0n)).toBe("0.00");
  });

  test("native gas in wei reads as whole tokens, rounded to 4 decimals", () => {
    expect(formatNative(50_000_000_000_000_000n)).toBe("0.05");
    expect(formatNative(123_456_789_000_000_000n)).toBe("0.1235");
    expect(formatNative(0n)).toBe("0.00");
  });

  test("typed amounts parse to base units and reject anything else", () => {
    expect(parseUsdc("5,000")).toBe(5_000_000_000n);
    expect(parseUsdc("0.5")).toBe(500_000n);
    expect(parseUsdc("1.1234567")).toBeUndefined();
    expect(parseUsdc("-1")).toBeUndefined();
    expect(parseUsdc("abc")).toBeUndefined();
  });

  test("basis points read as percent", () => {
    expect(formatBps(8000)).toBe("80%");
    expect(formatBps(1521)).toBe("15.21%");
  });

  test("due dates read relative to chain time", () => {
    expect(formatDaysFrom(0, 30 * 86_400)).toBe("in 30 days");
    expect(formatDaysFrom(86_400, 0)).toBe("1 day ago");
    expect(formatDaysFrom(100, 100)).toBe("today");
  });

  test("time from now picks the largest whole unit, down to the minute", () => {
    expect(formatTimeFrom(0, 30)).toBe("in < 1 min");
    expect(formatTimeFrom(0, 0)).toBe("now");
    expect(formatTimeFrom(0, 125)).toBe("in 2 min");
    expect(formatTimeFrom(0, 7_200)).toBe("in 2 h");
    expect(formatTimeFrom(0, 3 * 86_400)).toBe("in 3 d");
    expect(formatTimeFrom(300, 0)).toBe("5 min ago");
  });
});

describe("formatToken", () => {
  test("keeps every base unit, groups the whole part and drops trailing zeros", () => {
    expect(formatToken(1_250_000_001n, 6)).toBe("1,250.000001");
    expect(formatToken(5_000_000_000n, 6)).toBe("5,000");
    expect(formatToken(21_000_000_000_000n, 18)).toBe("0.000021");
    expect(formatToken(7n, 0)).toBe("7");
    expect(formatToken(-1_500_000n, 6)).toBe("-1.5");
    expect(formatToken(107_378_743_456_320n, 18, 8)).toBe("0.00010737");
    expect(formatToken(1_000_000_000n, 18, 4)).toBe("0");
  });
});
