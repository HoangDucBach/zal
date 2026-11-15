# 0009 — The pool advances only against escrow or an underwritten buyer
Status: accepted

## Context
The audit on 14 Nov 2026 found that one wallet can drain the pool with no capital. Two adversaries reproduced it independently (AT-17). Account creation is open, so the wallet creates a buyer and a seller account, relates them, issues an invoice, approves it at no cost, and takes the advance. ZR-FND-01..03 allowed this because they trusted any buyer approval. In reverse factoring the funder underwrites the buyer (the obligor), not the seller. That underwriting step was missing.

## Decision
`ZalFundingPool.advance` requires one of two conditions:
- The invoice is fully escrowed. The buyer's money is already locked, and anyone can settle once the due date passes (ZR-PAY-03). The pool carries no credit risk. Demo step 5 escrows before step 6 advances, so the demo needs no extra setup.
- The pool owner has enrolled the buyer account with `setObligorLimit`, and the buyer's open advance principal plus the new principal stays within that limit.

## Consequences
- A self-dealing pair can only borrow against its own escrowed money, so the attack gains nothing.
- Unescrowed financing becomes a curated program, as real approved-payables programs are. Credit scoring stays on the roadmap. Who sets limits, and on what evidence, is open question 2.
- The sandbox seeds its demo club as an enrolled buyer, so both paths can be shown.
