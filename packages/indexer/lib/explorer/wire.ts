// The /v1/explorer request side: opaque list cursors, search query classification and chart windows. Pure, so the
// parsing rules are unit-tested without a database.

import type { Address, Hex } from "viem";

/** One part of a cursor: a non-negative integer or a lowercase address. */
export type CursorPart = "uint" | "address";

const PART_PATTERN: Record<CursorPart, RegExp> = {
  uint: /^\d{1,78}$/,
  address: /^0x[0-9a-f]{40}$/,
};
const MAX_CURSOR_LENGTH = 256;

/**
 * Encodes the sort key of the last row of a page. Clients pass it back as `before` and must not parse it: the
 * layout may change between releases.
 */
export const encodeCursor = (parts: readonly (string | number | bigint)[]): string =>
  Buffer.from(parts.map(String).join(":"), "utf8").toString("base64url");

/** The parts of a cursor of this shape, or undefined when it is malformed or of another shape. */
export function decodeCursor(text: string, shape: readonly CursorPart[]): string[] | undefined {
  if (text.length === 0 || text.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  const parts = Buffer.from(text, "base64url").toString("utf8").split(":");
  if (parts.length !== shape.length) return undefined;
  return parts.every((p, i) => PART_PATTERN[shape[i]!].test(p)) ? parts : undefined;
}

export type SearchQuery =
  | { readonly kind: "address"; readonly address: Address }
  | { readonly kind: "hash"; readonly hash: Hex }
  | { readonly kind: "block"; readonly number: bigint }
  | { readonly kind: "invoice"; readonly id: bigint }
  | { readonly kind: "text"; readonly prefix: string };

/** Longest free-text query; longer input cannot be a name or symbol prefix worth matching. */
export const MAX_SEARCH_LENGTH = 100;

/**
 * `0x` + 40 hex is an address, `0x` + 64 hex a tx or block hash, digits a block number, `#123` an invoice id, any
 * other text a name prefix. Undefined for an empty query.
 */
export function classifySearch(raw: string): SearchQuery | undefined {
  const q = raw.trim();
  if (q === "") return undefined;
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) return { kind: "address", address: q.toLowerCase() as Address };
  if (/^0x[0-9a-fA-F]{64}$/.test(q)) return { kind: "hash", hash: q.toLowerCase() as Hex };
  if (/^\d{1,20}$/.test(q)) return { kind: "block", number: BigInt(q) };
  const invoice = /^#(\d{1,20})$/.exec(q);
  if (invoice?.[1] !== undefined) return { kind: "invoice", id: BigInt(invoice[1]) };
  return { kind: "text", prefix: q.slice(0, MAX_SEARCH_LENGTH) };
}

/** Escapes `%`, `_` and `\` so user text matches literally in a LIKE pattern. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export const CHART_RANGES = ["1d", "1w", "1m", "all"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

const RANGE_DAYS: Record<Exclude<ChartRange, "all">, number> = { "1d": 1, "1w": 7, "1m": 30 };
/** The longest series `all` returns, so the response stays bounded on an old chain. */
export const MAX_CHART_DAYS = 3_650;

/** The inclusive day window for a range, ending at `lastDay`. `all` starts at the first indexed day. */
export function chartWindow(range: ChartRange, lastDay: number, firstDay: number | undefined): { from: number; to: number } {
  const span = range === "all" ? lastDay - (firstDay ?? lastDay) + 1 : RANGE_DAYS[range];
  const days = Math.max(1, Math.min(span, MAX_CHART_DAYS));
  return { from: lastDay - days + 1, to: lastDay };
}

/** One entry per day of the window, oldest first, with zeros where nothing happened. */
export function fillDays<T extends { day: number }>(window: { from: number; to: number }, rows: readonly T[], empty: (day: number) => T): T[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const days: T[] = [];
  for (let day = window.from; day <= window.to; day++) days.push(byDay.get(day) ?? empty(day));
  return days;
}
