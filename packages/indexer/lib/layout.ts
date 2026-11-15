// The stored canvas layout, version 1, as packages/web/lib/canvas/layout.ts serializes it. Bounded, so one
// member cannot fill the database with one account's layout.

import { z } from "zod";

const COMPONENTS = [
  "account",
  "counterparty",
  "endpoint",
  "invoice",
  "budget",
  "approval",
  "schedule",
  "stream",
  "split",
  "escrow",
  "vault",
  "pool",
  "liquidity",
] as const;

/** Text Postgres jsonb can store: no NUL and no lone UTF-16 surrogate. */
const text = z
  .string()
  .refine((t) => !t.includes("\u0000") && t.isWellFormed(), "must not contain NUL or a lone surrogate");
const id = text.min(1).max(128);
const coordinate = z.number().finite().min(-1e7).max(1e7);

export const layoutSchema = z.strictObject({
  version: z.literal(1),
  positions: z.record(id, z.strictObject({ x: coordinate, y: coordinate })).refine((p) => Object.keys(p).length <= 2_000, {
    message: "at most 2000 positions",
  }),
  children: z
    .array(z.strictObject({ id: z.string().regex(/^child-\d{1,12}$/), name: text.max(120), nodeIds: z.array(id).max(2_000) }))
    .max(200),
  drafts: z.array(z.strictObject({ id: z.string().regex(/^draft-\d{1,15}$/), component: z.enum(COMPONENTS) })).max(500).default([]),
  links: z
    .array(z.strictObject({ id, source: id, target: id, lands: id.optional() }))
    .max(1_000)
    .default([]),
});

export type StoredLayout = z.infer<typeof layoutSchema>;

export const LAYOUT_MAX_BYTES = 256 * 1024;
