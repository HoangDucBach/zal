// The single-signature allowance of an account (ZR-ACC-11). `approvalLimit` caps what one signature
// may spend per rolling 24 h across the whole account; an op that would go over it needs `threshold` signatures.

import type { AccountState } from "./types";

/** `CanvasAccount.spendWindow()`. `spent` is already 0 once the window has expired on the chain. */
export interface SpendWindow {
  readonly start: number;
  readonly spent: bigint;
  readonly remaining: bigint;
}

type Policy = Pick<AccountState, "threshold" | "approvalLimit">;

/** What `requiredConfirmations(amount)` returns now: the window plus this op over the limit needs the threshold. */
export function signaturesNeeded(
  policy: Policy,
  window: Pick<SpendWindow, "spent">,
  amount: bigint,
): number {
  return window.spent + amount > policy.approvalLimit ? policy.threshold : 1;
}
