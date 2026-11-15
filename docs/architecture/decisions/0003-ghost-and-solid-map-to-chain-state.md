# 0003 — Ghost and solid map to on-chain state
Status: accepted

## Context
PRD principle 6: solid means signed and recorded on-chain. Story I1 mints the Invoice NFT while the invoice is still a ghost, so "ghost" cannot simply mean "off-chain".

## Decision
Ghost and solid are derived from contract state, as the table in `contracts.md` lists. A proposed relationship and an issued invoice are on-chain but ghost, because the counterparty has not committed. Only an unredeemed invite link is purely off-chain. The indexer derives the visual state from events. The client never stores it.

## Consequences
- Both canvases agree because both read the same events.
- An invite link needs an EIP-712 signature so the invitee can create the relationship and accept it in one transaction.

## Amendment (15 Nov 2026): drafts
Draft nodes and draft links are presentation state, stored in the canvas layout (ADR 0011) and visible only on the owner's own canvas. A draft link opens the form for its action; when that transaction confirms, the draft link and draft node are removed and the edge is drawn from chain state. Committed edges still come only from chain state.
