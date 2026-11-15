// localStorage round trip for one visitor's sandbox: the journal of transactions and clock moves, which the engine
// replays on load. Anything that fails to parse reads as "nothing saved", so an outdated blob reseeds instead of
// crashing.

import type { JournalEntry } from "./engine/chain";

import { getAddress, isAddress, isHex, type Address } from "viem";
import { z } from "zod";

import { STORAGE_KEY_JOURNAL } from "./config";

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value) => getAddress(value));
const hex = z.string().refine((value): value is `0x${string}` => isHex(value));

const entrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tx"),
    from: address,
    to: address.optional(),
    data: hex,
    timestamp: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("mine"),
    timestamp: z.number().int().nonnegative(),
  }),
]);

const envelopeSchema = z.object({
  version: z.literal(1),
  /** Hash of the compiled contracts the journal ran against. A rebuild of the contracts starts over. */
  codeHash: z.string(),
  offsetSeconds: z.number().int(),
  journal: z.array(entrySchema),
  /** Invoice ids the keeper settles at their due date. Off-chain, like any keeper's job list. */
  scheduled: z.array(z.string().regex(/^\d+$/)).default([]),
});

export interface PersistedSandbox {
  readonly codeHash: string;
  readonly offsetSeconds: number;
  readonly journal: readonly JournalEntry[];
  readonly scheduled?: readonly string[];
}

export function encodeSandbox(persisted: PersistedSandbox): string {
  return JSON.stringify({ version: 1, ...persisted });
}

/** `undefined` for anything that is not a valid envelope of the current version. */
export function decodeSandbox(text: string): PersistedSandbox | undefined {
  try {
    const parsed = envelopeSchema.safeParse(JSON.parse(text));

    if (!parsed.success) return undefined;
    const { codeHash, offsetSeconds, journal, scheduled } = parsed.data;

    return { codeHash, offsetSeconds, journal, scheduled };
  } catch {
    return undefined;
  }
}

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

const keyFor = (user: Address) =>
  `${STORAGE_KEY_JOURNAL}:${user.toLowerCase()}`;

export function loadSandbox(user: Address): PersistedSandbox | undefined {
  const text = storage()?.getItem(keyFor(user));

  return text === null || text === undefined ? undefined : decodeSandbox(text);
}

export function saveSandbox(user: Address, persisted: PersistedSandbox): void {
  try {
    storage()?.setItem(keyFor(user), encodeSandbox(persisted));
  } catch {
    // Quota or privacy mode: the sandbox keeps running in memory and starts fresh next time.
  }
}

export function clearSandbox(user: Address): void {
  try {
    storage()?.removeItem(keyFor(user));
  } catch {
    // Nothing saved, or storage blocked.
  }
}
