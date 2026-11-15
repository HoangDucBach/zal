# 0016 — approvalLimit is a rolling 24-hour allowance for the whole account
Status: accepted (15 Nov 2026, owner decision)

## Context
`approvalLimit` was applied per operation. A gated op at or below the limit needed one confirmation, and one above it needed `threshold`. An independent review (15 Nov 2026) showed that one approver could split a large spend into many ops, each under the limit, and spend any total on a single signature. This worked for `withdraw` and for `createSchedule` alike, so "2 of 3 above 1,000" was not enforced on totals.

## Decision
- **The allowance.** `approvalLimit` is a rolling 24-hour allowance for single-signature spending, shared by the whole account rather than tracked per approver.
- **How it is counted.** The account stores `windowStart` and `windowSpent`. A gated op needs `threshold` confirmations when `spentInWindow + amount > approvalLimit`, and one confirmation otherwise.
  - `spentInWindow` is `windowSpent`, or 0 once `now >= windowStart + 24 h`.
  - The check runs when the op would execute, not when it was submitted.
- **What counts against it.** When an op executes with fewer than `threshold` confirmations, its amount is added to the window. If the window had expired, it restarts at `now` with that amount. Ops that collected the full threshold do not use the allowance.
- **Single-signer accounts.** With `threshold == 1`, every op runs on one confirmation and the window still records spend, but it never blocks.
- **Amounts.** The amount is the op's policy amount: the face value, the withdraw amount, `amount × runs` for a Transfer schedule, or the face value for a PayInvoice schedule.

## Consequences
- Splitting no longer bypasses M-of-N. The UI states the policy as "2 of 3 above 1,000 per 24 h" and shows how much of the allowance has been used.
- Tightening or loosening the policy bumps `policyNonce` as before. The window is kept.
