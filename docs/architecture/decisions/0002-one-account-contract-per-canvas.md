# 0002 — One CanvasAccount contract per canvas; roles live on relationships
Status: accepted

## Context
PRD principle 2 gives every user the same canvas. Principle 3 says buyer, seller and funder are labels on a relationship, not account types. Spending needs per-canvas members, M-of-N approval and budgets. Receiving needs a per-canvas route (Split).

## Decision
Every canvas, personal or organisation, is a `CanvasAccount` clone (ERC-1167) from `ZalFactory`. The account holds the USDC, its members and policy, budgets and receive route, and it is the party in every relationship and invoice. Nothing on-chain marks an account as buyer or seller. `RelationshipRegistry` stores the role per relationship. Spending runs through a gated submit and confirm flow restricted to the account's own allow-listed selectors. It is not a general multisig.

## Consequences
- A personal canvas is an account with one Admin and threshold 1, so it behaves like a wallet.
- Settlement can route the seller's share through the seller's own Split in the buyer's transaction (PRD story P1).
- Restricting gated calls to known selectors keeps the account from becoming an arbitrary-call wallet, at the cost of adding a selector for each new spending action.

## Note (15 Nov 2026)
One `CanvasAccount` per canvas still holds. A wallet may act on several canvases. Before every write, the client checks its target: the signer's wallet plus a canvas confirmed on-chain with `factory.isAccount` and `roleOf`. It never takes the target from an API or URL value (`packages/web/lib/contracts/identity.ts`).
