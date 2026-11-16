# Requirements, invariants, acceptance tests

IDs are stable. Cite them in NatSpec, test names, and commit bodies. A new behaviour needs a requirement here and an acceptance test. Never edit an invariant or an acceptance test to make a failing test pass.

PRD story codes (C1, R1, I1, …) are in [../product/prd.md](../product/prd.md).

## Contract requirements

| ID | Requirement | PRD |
|---|---|---|
| ZR-SYS-01 | `ZalFactory.wire` shall run once and only by the owner | n/a |
| ZR-SYS-02 | Every state change shall emit an event carrying the ids needed to rebuild both canvases | R1, P1 |
| ZR-ACC-01 | `CanvasAccount.initialize` shall run once, from the factory, and set the first Admin | C1 |
| ZR-ACC-02 | An account shall always have at least one Admin | C1 |
| ZR-ACC-03 | `submit` shall accept only calls to the account itself with an allow-listed gated selector | P3 |
| ZR-ACC-04 | A gated op shall execute when confirmations reach the required count, which is `threshold` above `approvalLimit` and 1 otherwise, and each approver shall count once | P3 |
| ZR-ACC-05 | Changing members or policy shall invalidate every pending op | P3 |
| ZR-ACC-06 | `approveInvoice` with a budget shall roll the period, require `used + face <= limit`, and add `face` to `used` | I2 |
| ZR-ACC-07 | `setRoute` shall require `Σ bps == 10_000` and at most 8 legs, with vault legs only to allowed vaults | P2 |
| ZR-ACC-08 | `receivePayment` shall be callable only by `ZalInvoice` or `ZalFundingPool`, and shall split the amount exactly across legs | P2 |
| ZR-ACC-09 | A failing leg (a vault that reverts, returns malformed data or burns gas, or a failed transfer) shall fall back to Hold and emit `LegFailed` instead of reverting settlement | P1 |
| ZR-REL-01 | A buyer and seller pair shall have at most one `Proposed` or `Active` relationship | R1 |
| ZR-REL-02 | Only the non-proposer shall accept or reject, and only while `Proposed` and not expired | R2 |
| ZR-REL-03 | `acceptInvite` shall verify an EIP-712 invite signed by an Admin of the proposer, before its deadline, with a single-use nonce | R1 |
| ZR-INV-01 | Only the seller of an `Active` relationship shall issue an invoice, with `face > 0` and `dueDate > now` | I1 |
| ZR-INV-02 | Only the buyer shall approve or reject an `Issued` invoice | I2 |
| ZR-INV-03 | Only the buyer shall escrow an `Approved` invoice, once, for exactly `faceValue` | I3 |
| ZR-INV-04 | An Invoice NFT shall transfer only from its seller to the funding pool while `Approved` | F1 |
| ZR-INV-05 | Only the seller, while still the owner, shall cancel an `Issued` invoice | I1 |
| ZR-PAY-01 | `payInvoice` shall settle an `Approved` invoice once, paying `faceValue` to `ownerOf(id)` | P1 |
| ZR-PAY-02 | Only the buyer shall pay a non-escrowed invoice | P1 |
| ZR-PAY-03 | Anyone shall be able to settle an escrowed invoice once `now >= dueDate` | I3, P4 |
| ZR-PAY-04 | Payment to the seller shall pass through the seller's route in the same transaction | P1, P2 |
| ZR-FND-01 | Only the seller, still the owner of an `Approved` and unfunded invoice with `dueDate > now`, shall request an advance | F1 |
| ZR-FND-02 | Principal shall be `face * advanceRateBps / 10_000`, rounded down. The fee shall be fixed at advance time and rounded up | F1 |
| ZR-FND-03 | An advance shall require `principal + fee <= face` and `principal <= idle cash` | F1 |
| ZR-FND-04 | On repayment the pool shall keep `principal + fee` and route `face - principal - fee` to the seller | P1, F1 |
| ZR-FND-05 | LP withdrawals shall be capped by idle cash | n/a |
| ZR-FND-06 | Pool and vault shares shall use a virtual offset of 6 decimals | n/a |
| ZR-FND-07 | An advance shall require the invoice to be fully escrowed, or its buyer to be enrolled by the pool owner with open advance principal plus the new principal at or under its limit | F1 |
| ZR-ACC-10 | An account shall receive a settlement that its own gated operation triggered | P1, I3 |
| ZR-ACC-11 | Single-confirmation spending shall be capped by `approvalLimit` per rolling 24 h across the whole account; an op that would exceed it shall need `threshold` confirmations (ADR 0016) | P3 |
| ZR-SCH-01 | `createSchedule` shall be a gated operation whose policy amount is the total it may pay | P4 |
| ZR-SCH-02 | A schedule shall start at least 60 s after creation, and a recurring schedule shall have an interval of at least 60 s and 1 to 1000 runs | P4 |
| ZR-SCH-03 | A PayInvoice schedule shall run once, for an Approved invoice this account buys; a Transfer schedule shall pay a fixed nonzero recipient other than the account | P4 |
| ZR-SCH-04 | An Approver or Admin shall cancel a schedule directly, and a cancelled schedule never runs | P4 |
| ZR-SCH-05 | Anyone shall run a schedule once its time has come, and it shall pay exactly the approved amount to the approved target | P4 |
| ZR-SCH-06 | A schedule shall run at most once per due time, and at most its run count in total | P4 |
| ZR-SCH-07 | A failed run shall revert without consuming a run | P4 |
| ZR-VLT-01 | `ZalVault` yield shall be simulated, and the app shall state once (shell badge and Docs) that it is simulated (ADR 0017) | P2 |

## Invariants

Each has a Foundry invariant test or a stateful fuzz handler.

- INV-01 `ZalFundingPool.totalAssets == USDC.balanceOf(pool) + Σ open advance principal`.
- INV-02 Every stored route has `Σ bps == 10_000` and at most 8 legs, or is empty.
- INV-03 For every `PaymentRouted`, `Σ legAmounts == amount`.
- INV-04 An invoice reaches `Paid` at most once, and `Paid`, `Rejected`, and `Cancelled` are terminal.
- INV-05 For every funded invoice, `principal + fee + reserve == faceValue` and `reserve >= 0`.
- INV-06 The recipient of a payment is `ownerOf(id)` at the time of payment.
- INV-07 `ZalInvoice.totalEscrowed == Σ escrowed` over invoices that are not `Paid`, and `USDC.balanceOf(ZalInvoice) >= totalEscrowed`. (Changed from `balance == Σ escrowed`: anyone can send USDC to the contract, so exact balance equality cannot hold.)
- INV-08 A gated op executes at most once.
- INV-09 An Invoice NFT is held by its seller or by the pool, or burned.
- INV-12 On an account with threshold above 1, the amounts of ops executed with fewer than `threshold` confirmations since `windowStart` sum to at most the `approvalLimit` in force when each executed (ADR 0016).
- INV-11 For every schedule, runs executed + `remaining` equals the runs it was created with, and `nextAt` = start + runs executed × interval.
- INV-10 For every enrolled buyer, `obligorOutstanding[buyer] == Σ principal` of its open advances that used the credit limit, and it never exceeds the limit at the moment an advance is made.

## Acceptance tests

These mirror the demo script in the PRD, with designer `D`, club `C` (members `c1`, `c2`, `c3`, threshold 2), pool `P`, and LP `L`.

| ID | Scenario | Expect |
|---|---|---|
| AT-01 | D sets route 10% to tax address, 90% Hold. `receivePayment(1000)` | Tax gets 100, D holds 900 |
| AT-02 | D proposes C as buyer. C accepts | Relationship `Active`. A second proposal for the same pair reverts |
| AT-03 | Non-proposer rejects. Proposer accepts own proposal | Rejected. Accept by proposer reverts |
| AT-04 | Invite signed by D's Admin, redeemed by C's account | `Active`. Replay of the same invite reverts |
| AT-05 | D issues a 5,000 invoice due in 30 days | NFT owned by D, status `Issued` |
| AT-06 | C budget "Events" limit 6,000. c1 submits approve, c2 confirms | `Approved`, budget used 5,000. A second 5,000 approval in the same period reverts |
| AT-07 | c1 submits escrow. c1 confirms again | Second confirm by c1 reverts. Executes after c2 confirms. Invoice holds 5,000 |
| AT-08 | L deposits 10,000. D requests an advance at `annualFeeBps` = X | D receives 4,000. Pool owns the NFT. Fee matches the formula |
| AT-09 | C pays the funded invoice | Pool +4,000+fee, D route receives the reserve, split 10% and 90%. One transaction |
| AT-10 | C pays an unfunded invoice | D route receives 5,000 |
| AT-11 | A stranger pays an escrowed invoice before the due date, then after | Reverts, then succeeds |
| AT-12 | D transfers the NFT to any address other than the pool | Reverts |
| AT-13 | Pending op, then admin removes c2 | Op can no longer execute (policy nonce changed) |
| AT-14 | LP tries to withdraw more than idle cash while an advance is open | Reverts. `maxWithdraw` equals idle cash |
| AT-15 | Vault leg to a vault that reverts on deposit | Payment succeeds. Amount held. `LegFailed` emitted |
| AT-16 | Attacker calls `receivePayment` directly | Reverts |
| AT-17 | One wallet creates a buyer and a seller account, approves its own unescrowed invoice, requests an advance | Reverts. Pool cash untouched |
| AT-18 | Owner enrols C with limit 6,000. D advances against a 5,000 unescrowed invoice, then a second 5,000 invoice | First succeeds, second reverts. After C pays the first, a new advance fits again |
| AT-19 | D's own account settles D's escrowed invoice after the due date, unfunded and funded | Both succeed. Pool keeps principal + fee, D's route gets the rest |
| AT-20 | Seller route has a vault leg whose `deposit` returns no data | Payment succeeds. Amount held. `LegFailed` emitted |
| AT-21 | C (2 of 3) schedules 100 zUSDC to D every 60 s for 3 runs; a stranger runs it at t+60, t+120, t+180 and tries a 4th and an early run | 3 payments of 100; the early and the 4th run revert |
| AT-22 | C schedules payment of an approved, unescrowed invoice at t+60; the keeper runs it | Invoice Paid through D's route in one transaction |
| AT-23 | A run when C's balance is short | Reverts; `remaining` and `nextAt` unchanged; succeeds after C is funded |
| AT-24 | An Approver cancels a schedule; anyone tries to run it | Run reverts |
| AT-26 | Threshold 2, limit 1,000: c1 alone withdraws 600, then submits 600 more; after 24 h, 600 again | Second waits for c2; third runs on c1 alone |
| AT-27 | c1 alone creates five 1,000 single-run schedules under limit 1,000 | Only the first runs on one signature; the rest wait |
| AT-25 | createSchedule with start < now + 60, interval 30, or 0 runs | Reverts |
