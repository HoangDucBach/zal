// The Split form's rules, mirrored from `CanvasAccount.setRoute` (ZR-ACC-07, INV-02) so a route the contract would
// revert with `InvalidRoute` is caught before signing: legs total 100%, at most 8 legs, and a Transfer leg needs a
// recipient (USDC reverts on a transfer to the zero address).

import { isAddress, isAddressEqual, zeroAddress, type Address } from "viem";

export const MAX_SPLIT_LEGS = 8;
const FULL_BPS = 10_000;

export type LegKind = "hold" | "transfer" | "vault";

/** One leg as typed in the form: `percent` and `target` are raw input. */
export interface DraftLeg {
  readonly kind: LegKind;
  readonly target: string;
  readonly percent: string;
}

/** `percent` in basis points, or `undefined` when it is not a non-negative number. */
export function legBps(leg: DraftLeg): number | undefined {
  const percent = Number(leg.percent);

  return leg.percent.trim() === "" || !Number.isFinite(percent) || percent < 0
    ? undefined
    : Math.round(percent * 100);
}

/** Why this leg cannot be saved, shown under it; `undefined` when it can. */
export function legProblem(leg: DraftLeg): string | undefined {
  if (legBps(leg) === undefined) return "Percent must be 0 or more";
  if (leg.kind !== "transfer") return undefined;
  if (leg.target.trim() === "") return "Recipient required";
  if (!isAddress(leg.target, { strict: false })) return "Not an address";
  if (isAddressEqual(leg.target, zeroAddress)) return "Recipient required";

  return undefined;
}

/** Why the whole route cannot be saved; `undefined` when `setRoute` will accept it. */
export function splitProblem(legs: readonly DraftLeg[]): string | undefined {
  if (legs.length > MAX_SPLIT_LEGS) return `At most ${MAX_SPLIT_LEGS} legs`;
  const legIssue = legs.map(legProblem).find((p) => p !== undefined);

  if (legIssue !== undefined) return legIssue;
  const total = legs.reduce((sum, leg) => sum + (legBps(leg) ?? 0), 0);

  return total === FULL_BPS ? undefined : "Total must be 100%";
}

/**
 * The leg after its kind changes. A Vault leg points at the Zal vault; a Hold leg needs no target; a Transfer leg
 * keeps a recipient only if it already was a Transfer, so a Hold's zero target never shows up as the recipient.
 */
export function withKind(
  leg: DraftLeg,
  kind: LegKind,
  vault: Address,
): DraftLeg {
  if (kind === leg.kind) return leg;
  const target = kind === "vault" ? vault : kind === "hold" ? zeroAddress : "";

  return { ...leg, kind, target };
}
