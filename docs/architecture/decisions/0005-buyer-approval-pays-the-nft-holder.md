# 0005 — Buyer approval is an agreement to pay the Invoice NFT holder
Status: accepted

## Context
Reverse factoring needs the buyer's obligation to follow the receivable when the funder buys it. A freely transferable NFT would let a seller assign the receivable to anyone.

## Decision
The payment recipient is always `ownerOf(invoiceId)`. An Invoice NFT may move only from its seller to `ZalFundingPool`, while the invoice is `Approved`. Approving an invoice means agreeing to pay its holder.

## Consequences
- The buyer always knows the possible recipients: the seller or the pool.
- A secondary market for receivables would need a new decision and a transfer allow-list.
