# 0015 — Scheduled payments live on-chain in the account; a keeper only triggers them
Status: accepted (15 Nov 2026, owner request; supersedes ADR 0010)

## Context
The owner wants scheduled payments that really work in live mode: pay an invoice at a chosen time, and pay on a recurring interval, with a smallest interval of 1 minute. ADR 0010 made Schedule an off-chain keeper job on top of the permissionless pay. That covered one case only, an escrowed invoice settled once it is due. Paying at a chosen time from the account's own balance, or paying on a recurrence, needs the account to authorise the payment ahead of time. An off-chain service cannot do that safely.

## Decision
- **Where schedules live.** `CanvasAccount` stores them. A schedule has one of two kinds:
  - **Transfer:** send `amount` zUSDC to a fixed `recipient`.
  - **PayInvoice:** pay one invoice where this account is the buyer.

  Each schedule has a `start`, an `interval` (0 means once) and a `remaining` run count.
- **Minimum timing.** `start >= block.timestamp + 60` when the schedule is created, and a recurring `interval >= 60`. The chain enforces both.
- **Who may create and cancel.** Creating is a gated operation (`createSchedule`), approved like any spend. The policy amount is the total commitment, `amount × runs`. Cancelling is a direct Approver or Admin action, so stopping money is never harder than starting it.
- **Who may run.** `runSchedule(id)` is permissionless. It requires `block.timestamp >= nextAt`, then performs exactly the authorised payment and advances `nextAt` by `interval`. It can only move the amount already approved, to the target already approved, so the caller needs no rights.
- **Keeper.** `packages/keeper` (Node 24 and Hono, the same runtime as the indexer) reads due schedules from the indexer and sends `runSchedule` from its own gas wallet. Its HTTP surface is only health and status. It holds no authority over funds.

## Consequences
- **Keeper downtime.** If the keeper is down, payments are late but never lost or doubled. Anyone can run a due schedule, and `nextAt` guards against a second run.
- **Failed runs.** A run that fails, for example on insufficient balance, reverts. The schedule stays due and is retried. The keeper backs off and reports the failure.
- **Contract change.** `CanvasAccount` changes, so this lands before the first L1 deploy. A full audit pass is required.
- **ADR 0010 is superseded.** The sandbox keeper bot calls `runSchedule` as well.
