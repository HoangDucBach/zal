# 0010 — Schedule is an off-chain keeper job on the permissionless pay
Status: accepted

## Context
The PRD's Schedule component pays once, on a recurrence, or on the due date. The v1 contracts have no scheduler. They do let anyone settle an escrowed invoice once `now >= dueDate` (ZR-PAY-03).

## Decision
In v1, Schedule means "settle this escrowed invoice at its due date". A keeper keeps a job list off-chain and calls `ZalInvoice.payInvoice` when an invoice falls due. The palette offers Schedule only on an approved, escrowed invoice you pay, and only when a keeper is available. The sandbox runs a keeper bot. In live mode, Schedule is disabled with "needs a keeper" until one is deployed.

## Consequences
- The schedule itself is not on-chain, so it is an exception to ADR 0003 (ghost and solid come from chain state), like an unredeemed invite link. The canvas must not draw a schedule as committed. The escrow and the due date are the binding part.
- Anyone can run a keeper, because settlement is permissionless. A missed run delays payment but never loses it.
- Recurring payments and Stream need new contracts and are out of scope for v1.
