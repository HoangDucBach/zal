# Plan: credit design, public pool and private pools

Status: design only. Not built. The live L1 keeps the single shared pool until this ships.

Zal grants no credit. The public pool takes no credit risk. Credit lives only in private pools, where the pool owner (the pooler) decides it and backs it with its own liquidity. Zal enforces the rules.

## Roles
| Role | Who | Does |
|---|---|---|
| Buyer | A canvas | Approves, escrows, pays |
| Seller | A canvas | Chooses an advance now or 100% at the due date |
| LP | Any wallet | Deposits into the public pool |
| Pooler | Any wallet | Creates a private pool, funds it, sets credit limits for its buyers |

## Public pool: escrow only, rewards early buyers
| Topic | Decision |
|---|---|
| Credit | None. Advances only against fully escrowed invoices. `setObligorLimit` is removed from the public pool |
| Buyer incentive | Buyer rebate: on repayment of an escrowed, advanced invoice, the pool pays `fee × buyerRebateBps / 10,000` to the buyer canvas. Escrow de-risks the pool, so part of the fee goes back to whoever de-risked it |
| Early payment | The fee is charged on the days actually outstanding. A buyer who pays before the due date lowers the fee, and the unearned part returns to the seller's reserve |
| Seller choice | Per invoice: "Advance now" (`advance` now, reserve later) or "Wait" (100% of face at payment). The form shows both in numbers |
| Values | `buyerRebateBps` and the fee rate are TBD. No defaults |

Seller choice, shown in the Advance form:

```
Advance now : advance = 80% × face now · reserve = face − advance − fee at payment
Wait        : face at payment, no fee
```

## Private pools: pooler credit, always covered
| Topic | Decision |
|---|---|
| Creator | Any wallet, through `ZalPoolFactory.createPool(advanceRateBps, annualFeeBps)` |
| Scope | Only buyers the pooler enrolled (`creditLimit[buyer] > 0`). Their invoices may be escrowed or on credit |
| Limit basis | Set by the pooler. Zal provides a read-only credit profile from the indexer: invoices paid, paid on time, late, volume, escrow ratio, relationship age. Off-chain checks are up to the pooler |
| Liquidity guarantee | Every unused credit line is reserved. `reserved = Σ (creditLimit[b] − outstanding[b])`. A limit increase needs `free ≥ increase`, where `free = idle − reserved`. LP and pooler withdrawals and escrow-backed advances draw only from `free` |
| Default risk | The pooler, and any LPs it admits. Write-down stays open (K-2) |
| Seller | Picks the pool when requesting an advance, from the pools that enrolled its buyer plus the public pool |

New invariant, per private pool:
- INV-P1 `idle ≥ Σ (creditLimit[b] − outstanding[b])`. A granted, unused limit can always be drawn.

## Contracts
| Contract | Change |
|---|---|
| `ZalPoolFactory` (new) | `createPool`, `isPool(address)`, `PoolCreated(pool, owner)`. Deploys with `new`, so `ZalFactory` stays under the size limit |
| `ZalFundingPool` | Constructor takes `owner` and `isPublic`. Public: escrow-only advances, buyer rebate. Private: credit limits with reservation (INV-P1). Both: fee on days actually outstanding |
| `ZalInvoice` | `_update` checks `poolFactory.isPool(to)`. `payInvoice` calls `onRepaid` on the pool holding the NFT |
| `CanvasAccount` | `requestAdvance(invoiceId, pool)` requires `isPool(pool)`. `receivePayment` accepts `ZalInvoice` or any `isPool` caller. The rebate arrives as a plain transfer, outside the Split |
| `ZalFactory` | `wire` takes `poolFactory`. The public pool is created through it |

## Requirement deltas
| ID | Change |
|---|---|
| ZR-INV-04 | "to the funding pool" becomes "to a registered pool" |
| ZR-FND-02 | Fee on days actually outstanding, not fixed at advance |
| ZR-FND-07 | Public pool: escrow only. Private pool: escrowed or within the buyer's limit |
| ZR-FND-08 (new) | Any wallet shall create a private pool with its own rates |
| ZR-FND-09 (new) | Only registered pools may hold an Invoice NFT or call `receivePayment` |
| ZR-FND-10 (new) | The public pool shall pay the buyer rebate on repayment of an escrowed advance |
| ZR-FND-11 (new) | A private pool shall keep INV-P1 on every limit change, withdrawal and advance |
| INV-01 | Holds per pool |
| INV-09 | "or by the pool" becomes "or by the registered pool that advanced it" |
| K-1 | Superseded by the fee on days outstanding |
| AGENTS.md rules 3, 6, 11 | "the funding pool" becomes "a registered pool". Rule 11 splits public and private |

## Acceptance tests (new)
| ID | Test |
|---|---|
| AT-P1 | Public pool: an advance on a non-escrowed invoice reverts |
| AT-P2 | Public pool: an escrowed advance, repaid, pays the buyer rebate and the reserve to the seller's Split |
| AT-P3 | Payment before the due date lowers the fee, and the seller's reserve grows by the unearned part |
| AT-P4 | Private pool: an advance for a buyer with no limit reverts |
| AT-P5 | Private pool: a limit increase above `free` reverts |
| AT-P6 | Private pool: a withdrawal that would break INV-P1 reverts |
| AT-P7 | NFT transfer to an unregistered address, and `receivePayment` from one, revert |
| AT-P8 | Two private pools stay independent |

## Indexer
- Ponder factory source on `PoolCreated`. Tables keyed by `pool`.
- `GET /v1/accounts/:account/credit-profile`: paid, on time, late, volume, escrow ratio, relationship age. Read-only. No score.

## Web
- Advance form: an "Advance now" / "Wait" choice with numbers, and a pool selector.
- Canvas palette: "New pool" (pooler).
- Pool node, pooler only: enrol a buyer, set its limit, see the buyer's credit profile, `free` and `reserved`.
- Escrow form: shows the buyer rebate when the seller later takes an advance.
- Sandbox: seed one private pool that enrolled the demo club.

## Rollout
1. Contracts and tests, `forge build`, `gen:contracts`.
2. Indexer, web, sandbox.
3. Redeploy the L1. Update `deployments/l1.json` and the README. Live canvases and invoices are reset.

## Open questions
- P-1. Value of `buyerRebateBps`, and the fee rates of the public pool.
- P-2. Is a private pool open to outside LPs, or funded by the pooler only?
- P-3. Bounds on pooler rates. The only current check is `principal + fee <= face`.
- P-4. Is there a creation fee or a minimum deposit, to stop spam pools in the seller's selector?
- P-5. Must a buyer accept enrolment before a pool can set its limit?
- P-6. Write-down of a defaulted credit advance (K-2) in private pools.
