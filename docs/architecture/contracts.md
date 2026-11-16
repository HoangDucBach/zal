# Contracts specification

This file is the build spec for `packages/contracts`. Requirement IDs (`ZR-*`) and invariants (`INV-*`) live in [requirements.md](requirements.md). Cite them in NatSpec and tests.

Solidity 0.8.25, `evm_version = cancun` (the same pair Zalax runs on Subnet-EVM), Foundry, OpenZeppelin Contracts 5.x. Every amount is USDC with 6 decimals.

## Contract set

| Contract | Kind | Owns |
|---|---|---|
| `ZUSDC` (zUSDC) | ERC-20, 6 decimals | Testnet dollars. The app shows one testnet badge (ADR 0017) |
| `ZalFactory` | Ownable | Deploys `CanvasAccount` clones (ERC-1167). Answers `isAccount`. Holds the protocol wiring (USDC, registry, invoices, pool, allowed vaults) |
| `CanvasAccount` | Clone, initializer | One per canvas. Holds USDC. Members and roles, approval policy, budgets, the receive route (Split), and every action the canvas takes |
| `RelationshipRegistry` | Plain | Buyer and seller relationships between two accounts: propose, accept, reject, cancel, invite links |
| `ZalInvoice` | ERC-721 | Invoice NFTs, the invoice state machine, escrow balances, and settlement |
| `ZalFundingPool` | ERC-4626 over USDC | LP deposits, advances against approved invoices, repayment split |
| `ZalVault` | ERC-4626 over USDC | Simulated yield for idle cash. Stated once in the shell and Docs (ADR 0017) |

Parties are always `CanvasAccount` addresses, never EOAs. A person's wallet (EOA) is a member of one or more accounts. `ZalFactory.isAccount(a)` gates every party argument.

## Why one account contract per canvas

PRD principle 2 says every user gets the same canvas, and principle 3 says roles belong to relationships. One contract type for every canvas gives both: a student club and a freelancer deploy the same `CanvasAccount`, and nothing on-chain records "buyer" or "seller" against an account. Role lives only on a `Relationship` (ADR 0002).

## Data shapes

```solidity
enum MemberRole { None, Viewer, Approver, Admin }        // Admin can also approve
enum Role       { Buyer, Seller }                         // a party's role in one relationship
enum RelStatus  { None, Proposed, Active, Rejected, Cancelled }
enum InvoiceStatus { None, Issued, Approved, Paid, Rejected, Cancelled }
enum LegKind    { Hold, Transfer, Vault }

struct Relationship {
    address buyer;      // CanvasAccount
    address seller;     // CanvasAccount
    address proposer;   // buyer or seller
    uint64  proposedAt;
    uint64  expiresAt;  // 0 = never. Default TTL is TBD (open question 4)
    RelStatus status;
}

struct Invoice {
    uint256 relationshipId;
    address seller;     // fixed at issue; the payee of record
    address buyer;      // fixed at issue; the obligor
    uint128 faceValue;
    uint128 escrowed;   // 0 or faceValue
    uint64  issuedAt;
    uint64  dueDate;
    uint64  approvedAt;
    InvoiceStatus status;
    bytes32 docHash;    // hash of the off-chain invoice document
}

struct Leg {             // one branch of a Split
    LegKind kind;
    address target;      // ignored for Hold; recipient for Transfer; ERC-4626 vault for Vault
    uint16  bps;         // Σ bps = 10_000
}

struct Budget {
    uint128 limit;       // per period
    uint128 used;        // in the current period
    uint64  periodStart;
    uint64  periodLength; // seconds; default 30 days
}

struct Advance {         // in ZalFundingPool
    address seller;
    uint128 principal;
    uint128 fee;
    uint64  fundedAt;
    bool    onCredit;  // true when the advance used the buyer's obligor limit (ADR 0009)
}
```

"Funded" is not stored on the invoice. An invoice is funded exactly when `ownerOf(id) == pool`. The Payment Recipient is always `ownerOf(id)` (INV-06). Derive these; do not duplicate them.

## Ghost and solid on-chain

The canvas draws ghost for "not yet committed" and solid for "signed and recorded on-chain" (PRD principle 6, ADR 0003).

| Canvas object | Ghost when | Solid when |
|---|---|---|
| Counterparty node | `Relationship.status == Proposed`, or an invite link not yet redeemed (off-chain only) | `Active` |
| Invoice | `Issued` | `Approved` or `Paid` |
| Escrow badge | n/a | `escrowed == faceValue` |
| "Funded" badge | n/a | `ownerOf == pool` and not yet `Paid`. The pool keeps the NFT as the paid record |

Rejected and Cancelled are terminal. The UI fades them out.

## CanvasAccount

Created by `ZalFactory.createAccount(admin, salt)` as an ERC-1167 clone, so the address is predictable before deploy. `initialize` runs once (ZR-ACC-01).

### Members and approval policy
- `setMember(address, MemberRole)` (Admin). The last Admin cannot be removed (ZR-ACC-02).
- `setPolicy(uint8 threshold, uint128 approvalLimit)` (Admin). `threshold >= 1` and `threshold <= approver count` (Admins count as approvers).
- A gated operation needs `threshold` confirmations when `spentInWindow + amount > approvalLimit`, and one confirmation otherwise (ZR-ACC-11, ADR 0016). `approvalLimit` is a single-signature allowance per rolling 24 h, shared by the whole account. The check runs when the op would execute, so an op priced at one confirmation at submit can need `threshold` once the window has filled. A personal canvas with one Admin and threshold 1 behaves like a plain wallet.
- The window is `windowStart` and `windowSpent`. An op that executes with fewer than `threshold` confirmations adds its amount to the window and emits `SpendWindowCharged(opId, amount, windowSpent, windowStart)`; an op that collected the full threshold adds nothing. A window with nothing in it, or older than 24 h (`now >= windowStart + 24 h`), restarts at `now`. With threshold 1 every op is recorded, saturating at `type(uint128).max`, and never blocks. `spendWindow()` returns `(start, spent, remaining)`, with `spent` 0 once expired and `remaining` floored at 0. Policy changes keep the window.

### Gated operations
Spending actions go through `submit(bytes call) returns (uint256 opId)` and `confirm(opId)`. `call` is an ABI-encoded call to this account. Only the selectors below are allowed. Arbitrary targets are not (ZR-ACC-03). The submitter's confirmation counts. The operation executes inside the confirmation that reaches the required count. Each approver confirms once (ZR-ACC-04). `revoke(opId)` withdraws a confirmation before execution. An executed or cancelled op cannot run again (INV-08).

Each operation stores the policy nonce from submission. Changing members or policy bumps the nonce and invalidates pending ops (ZR-ACC-05). Without this, a removed approver's confirmation would still count.

| Gated selector | Amount used for the policy |
|---|---|
| `approveInvoice(invoiceId, budgetId)` | invoice `faceValue` |
| `escrowInvoice(invoiceId)` | invoice `faceValue` |
| `payInvoice(invoiceId)` | invoice `faceValue` |
| `withdraw(to, amount)` | `amount` |
| `createSchedule(kind, recipient, invoiceId, amount, start, interval, runs)` | `amount × runs` (Transfer) or the invoice `faceValue` (PayInvoice) |

These five functions are `onlySelf`. Members reach them only through `submit` and `confirm`.

### Direct actions (Admin)
`proposeRelationship(counterparty, Role myRole, uint64 expiresAt)`, `acceptRelationship(id)`, `rejectRelationship(id)`, `cancelRelationship(id)`, `acceptInvite(Invite, sig)`, `issueInvoice(relationshipId, faceValue, dueDate, docHash)`, `cancelInvoice(id)`, `rejectInvoice(id)`, `requestAdvance(invoiceId)`, `setRoute(Leg[])`, `setBudget(budgetId, limit, periodLength)`, `vaultDeposit(vault, amount)`, `vaultRedeem(vault, shares)`.

### Budgets (buyer side, ZR-ACC-06)
`approveInvoice` takes a `budgetId`. `0` means unbudgeted. Otherwise the account rolls the period forward when `now >= periodStart + periodLength`, so `used` resets to 0. It then requires `used + faceValue <= limit` and adds the face value. Approval reserves budget. Payment does not charge it again.

### Receive route, the Split (seller side, ZR-ACC-07)
- `setRoute(Leg[])` requires `Σ bps == 10_000` and at most 8 legs (INV-02). A `Vault` leg's target must be on `ZalFactory.allowedVault`. An empty route means hold everything.
- `receivePayment(uint256 invoiceId, uint256 amount)` can be called only by `ZalInvoice` or `ZalFundingPool`, after they have transferred `amount` to the account. The account splits it. A `Hold` leg keeps the funds. A `Transfer` leg sends USDC to the target. A `Vault` leg deposits with `receiver = this account`. Each leg gets `amount * bps / 10_000`, rounded down, and the remainder goes to the last leg, so the legs sum to exactly `amount` (INV-03). Emits `PaymentRouted(invoiceId, amount, legAmounts)`.
- A leg that would revert must not block settlement. A vault deposit that reverts, returns no or short data, or runs out of gas falls back to Hold and emits `LegFailed`. Call the vault with a low-level call and check the return data length before decoding. A Transfer leg that fails also falls back to Hold. A Transfer leg to the zero address is rejected in `setRoute`.
- `receivePayment` is not `nonReentrant`. It is reachable only from `ZalInvoice` and `ZalFundingPool`, which hold their own guards, and an account must be able to receive inside its own gated call (the seller settling its own escrowed invoice, ZR-ACC-10). A vault called by a leg is not a member, so it cannot reach any account action.

### Payee Endpoint visibility
`endpointPublic` is an off-chain display flag, not on-chain privacy. Any chain reader sees the route. The PRD's private mode hides the route in the Zal UI only (open question 3).

### Scheduled payments (ADR 0015)
```solidity
enum ScheduleKind { Transfer, PayInvoice }
struct Schedule {
    ScheduleKind kind;
    address recipient;   // Transfer only; nonzero
    uint256 invoiceId;   // PayInvoice only; this account must be its buyer
    uint128 amount;      // Transfer: per run. PayInvoice: the invoice face value at creation (informational)
    uint64  nextAt;      // next run time (unix seconds)
    uint32  interval;    // 0 = once; otherwise >= 60
    uint32  remaining;   // runs left; >= 1 at creation, <= 1000
    bool    active;
}
```
- `createSchedule(kind, recipient, invoiceId, amount, start, interval, runs)` is a gated operation (`onlySelf`, reached through `submit`/`confirm`). The policy amount is `amount × runs` for Transfer and the face value for PayInvoice. Requirements:
  - `start >= block.timestamp + 60`.
  - `interval == 0 && runs == 1`, or `interval >= 60 && 1 <= runs <= 1000`.
  - A Transfer recipient is not zero and not this account.
  - A PayInvoice schedule is once only, and its invoice is `Approved` with this account as buyer.
  - It emits `ScheduleCreated(id, kind, recipient, invoiceId, amount, start, interval, runs)` (ZR-SCH-01..03).
- `cancelSchedule(id)` is direct, for an Approver or Admin. It sets `active = false` and emits `ScheduleCancelled(id, by)` (ZR-SCH-04).
- `runSchedule(id)` is permissionless and `nonReentrant`. It requires `active`, `remaining > 0` and `block.timestamp >= nextAt`. Effects come first: decrement `remaining`, set `nextAt += interval`, and if `remaining == 0` set `active = false`. Then the payment:
  - **Transfer:** `safeTransfer(usdc, recipient, amount)`.
  - **PayInvoice:** approve exactly the face value, then call `invoices.payInvoice(invoiceId)`.

  It emits `ScheduleRan(id, runAt, amountPaid, remaining)`. A failing payment reverts the whole run, so the schedule stays due (ZR-SCH-05..07).
- `getSchedule(id)` and `scheduleCount()` are views.
- Budgets are not charged by schedules in v1. Approval of the schedule is the spend control.

## RelationshipRegistry

- `propose(counterparty, Role proposerRole, expiresAt)`. `msg.sender` is the proposing account. Both sides must be accounts. A pair has at most one `Proposed` or `Active` relationship per direction (buyer, seller) (ZR-REL-01). Emits `RelationshipProposed(id, buyer, seller, proposer)`.
- `accept(id)` and `reject(id)` are callable only by the non-proposer party, while `Proposed` and not expired (ZR-REL-02). `cancel(id)` is callable by the proposer while `Proposed`.
- `acceptInvite(Invite inv, bytes sig)` redeems an off-chain EIP-712 invite in one transaction. The signer must be an Admin of `inv.proposer`, checked through `CanvasAccount.roleOf`. The invite holds `proposer`, `proposerRole`, `inviteeEmailHash` (unused on-chain), `nonce`, and `deadline`. The caller becomes the counterparty, the relationship is created `Active`, and the nonce is consumed (ZR-REL-03). This is how a link invite reaches someone who has no account yet.
- An `Active` relationship has no end state in v1. Ending one is out of scope.

## ZalInvoice (ERC-721 "Zal Invoice", symbol "ZINV")

State machine. Every transition not in this table reverts.

| From | Call | Caller | To | Notes |
|---|---|---|---|---|
| None | `issue(relId, face, due, docHash)` | seller of an `Active` relationship | Issued | Mints the NFT to the seller. `face > 0`, `due > now` (ZR-INV-01) |
| Issued | `approve(id)` | buyer | Approved | Sets `approvedAt` (ZR-INV-02) |
| Issued | `reject(id)` | buyer | Rejected | Terminal |
| Issued | `cancel(id)` | seller, still the owner | Cancelled | Terminal. Burns the NFT |
| Approved | `escrow(id)` | buyer | Approved | Pulls `faceValue` from the buyer. Sets `escrowed = faceValue`. Once only (ZR-INV-03) |
| Approved | `pay(id)` | buyer, or anyone if `escrowed == face` and `now >= dueDate` | Paid | See Settlement (ZR-PAY-01..04) |

`approve` is named `approveInvoice` in the external ABI so it does not collide with ERC-721 `approve(address,uint256)`. Use `issueInvoice`, `approveInvoice`, `rejectInvoice`, `cancelInvoice`, `escrowInvoice`, and `payInvoice` on `ZalInvoice` too.

### Transfer restriction (ZR-INV-04)
An Invoice NFT moves only from its seller to `ZalFundingPool`, while `Approved`, and only when the pool itself pulls it inside `advance`. Every other transfer reverts, including a seller pushing the NFT to the pool without an advance, which would leave an unpayable invoice. Approval is the buyer's agreement to pay whoever holds the NFT, which is what reverse factoring needs (ADR 0005). A general secondary market is out of scope.

### Settlement: `payInvoice(id)` in one transaction
1. Funds come from escrow when `escrowed == faceValue`. Otherwise the buyer account approves exactly `faceValue` to `ZalInvoice` inside its own `payInvoice`, and `ZalInvoice` pulls it from the buyer straight to the recipient, so the allowance ends at 0. `escrowInvoice` works the same way. Payment resets `escrowed` to 0, and `totalEscrowed` tracks open escrow (INV-07).
2. Mark `Paid` before any external call (checks, effects, interactions) (INV-04).
3. Let `r = ownerOf(id)`.
   - If `r == seller`, transfer `faceValue` to the seller and call `seller.receivePayment(id, faceValue)`.
   - If `r == pool`, transfer `faceValue` to the pool and call `pool.onRepaid(id, faceValue)`. The pool keeps `principal + fee` and sends the reserve to the seller through `receivePayment` (ZR-FND-04).
4. Emit `InvoicePaid(id, payer, recipient, faceValue)`.

The NFT is not burned on payment. It stays as the paid record.

Payment before `dueDate` is allowed. The demo cannot warp time on a live L1, so "drag the timeline to maturity, then pay" is a UI replay. The contract accepts the payment early, and the pool's fee was fixed at advance time (ZR-FND-02).

Overdue invoices, disputes, and recourse are out of scope (open question 2).

## ZalFundingPool (ERC-4626 "Zal Funding Pool LP", symbol "zFP")

- Owner parameters: `advanceRateBps` (PRD fixes it at 8000) and `annualFeeBps`. The fee rate is TBD. Demo calibration in open question 6.
- `setObligorLimit(buyer, limit)` (owner) enrols a buyer account the pool has underwritten, with a cap on its open advance principal. `obligorOutstanding[buyer]` tracks that principal (ADR 0009).
- `advance(invoiceId)`. The caller must be `invoice.seller` and the current owner. The invoice must be `Approved`, `dueDate > now`, and not yet funded. The invoice must also be fully escrowed (`escrowed == faceValue`), or its buyer must be enrolled with `obligorOutstanding[buyer] + principal <= obligorLimit[buyer]` (ZR-FND-07). A buyer approval alone is free, so without this rule one actor could pair two accounts and drain the pool. The pool pulls the NFT with `transferFrom` (the seller account approved the pool first). It then computes:
  - `principal = face * advanceRateBps / 10_000`, rounded down.
  - `fee = ceil(principal * annualFeeBps * (dueDate - now) / (10_000 * 365 days))`, rounded up, because rounding favours the pool.
  - It requires `principal + fee <= face`, so the reserve is never negative (INV-05), and `principal <= idle cash`.
  - It stores `Advance`, adds `principal` to `outstanding` (and to `obligorOutstanding[buyer]` when the advance used the credit limit), and transfers `principal` to the seller account (Hold, not routed. Open question 7). Emits `Advanced(id, seller, principal, fee, onCredit)` (ZR-FND-01..03).
- `onRepaid(id, amount)` can only be called by `ZalInvoice`. It requires an existing, unsettled advance and `amount == face`. It sets `reserve = face - principal - fee`, subtracts `principal` from `outstanding` (and from `obligorOutstanding[buyer]` if it was counted there), deletes the advance, transfers `reserve` to the seller, and calls `seller.receivePayment(id, reserve)`. Emits `Repaid(id, principal, fee, reserve)` (ZR-FND-04).
- `totalAssets = USDC.balanceOf(pool) + outstanding`. Fees are recognised on repayment, not accrued (known issue K-1).
- `maxWithdraw` and `maxRedeem` are capped by idle cash, so LPs cannot pull out money that is lent out (ZR-FND-05).
- `_decimalsOffset() = 6`, a virtual-share offset against the first-depositor inflation attack (ZR-FND-06).

Demo check: face 5,000, advance rate 80%, 30 days. Principal is 4,000. A fee of 50 needs `annualFeeBps ≈ 1521`: 4,000 × 0.1521 × 30 / 365 = 50.005479…, and the ceil gives 50.005480. The PRD's "fee 50" is a round figure. The exact demo rate is open question 6. Do not hard-code it.

## ZalVault (ERC-4626 "Zal Simulated Vault", symbol "zSV")

Simulated yield for idle cash. `simulateYield(amount)` (owner or keeper) pulls USDC into the vault and raises the share price. It has no strategy and no oracle. It uses `_decimalsOffset() = 6`. Every UI labels it simulated (ZR-VLT-01). The yield figure is TBD.

## ZalFactory

- `createAccount(address admin, bytes32 salt) returns (address)`, a deterministic clone. `predictAccount(admin, salt)`. `isAccount(address)`.
- One-time `wire(usdc, registry, invoices, pool)` by the owner breaks the deploy cycle (invoices need the factory, the pool needs invoices). Calling it again reverts (ZR-SYS-01).
- `setAllowedVault(vault, bool)` (owner).

## Events (the indexer's only input)

Every state change emits an event that carries the ids needed to rebuild both canvases: `relationshipId`, `invoiceId`, `opId`, and the accounts involved. The indexer never reads storage to learn that something happened (ZR-SYS-02).

`CanvasAccount`: `MemberSet` and `PolicySet` (both carry the new `policyNonce`), `OpSubmitted(opId, selector, amount, by, data)`, `OpConfirmed`, `OpRevoked`, `OpExecuted`, `BudgetSet`, `BudgetCharged`, `RouteSet`, `PaymentRouted` (an empty route emits `legAmounts = [amount]`), `LegFailed`, `Withdrawn`, `VaultDeposited`, `VaultRedeemed`, `EndpointVisibilitySet`, `SpendWindowCharged`, `ScheduleCreated`, `ScheduleCancelled`, `ScheduleRan`.
`RelationshipRegistry`: `RelationshipProposed` (with `expiresAt`), `RelationshipAccepted`, `RelationshipRejected`, `RelationshipCancelled`. `acceptInvite` emits `RelationshipProposed` then `RelationshipAccepted`.
`ZalFactory`: `Wired`, `AccountCreated`, `AllowedVaultSet`. (The indexer skips `Wired` and `KeeperSet`: no view depends on them.)
`ZalVault`: `KeeperSet`, `YieldSimulated`, plus ERC-4626 events.
`ZalInvoice`: `InvoiceIssued`, `InvoiceApproved`, `InvoiceRejected`, `InvoiceCancelled`, `InvoiceEscrowed`, `InvoicePaid`, plus ERC-721 `Transfer`.
`ZalFundingPool`: `Advanced(invoiceId, seller, principal, fee, onCredit)`, `Repaid`, `RatesSet`, `ObligorLimitSet`, plus ERC-4626 events. `onCredit` lets the indexer rebuild `obligorOutstanding` from events alone.

## Access and safety rules

1. Only `ZalInvoice` and `ZalFundingPool` may call `CanvasAccount.receivePayment`. The function trusts that the transfer already happened, so any other caller is rejected.
2. Every external entry that moves USDC is `nonReentrant` (OpenZeppelin `ReentrancyGuard`; transient storage is fine on cancun), except `CanvasAccount.receivePayment` (ZR-ACC-10). That function is caller-restricted to the guarded `ZalInvoice` and `ZalFundingPool`, and it snapshots the route into memory before it pays out.
3. Use `SafeERC20` for every token move.
4. Rounding favours the pool and the protocol. Leg remainders go to the last leg.
5. No price oracle and no upgradeability in v1. Clones are not upgradeable proxies.
6. No `tx.origin`. No `selfdestruct`. No arbitrary `delegatecall` or `call` from accounts.
7. Do not invent calibration numbers. `annualFeeBps`, the vault yield, and the relationship TTL come from config and stay TBD in docs.

## Implementation decisions (14 Nov 2026)
The spec left these open. The code and tests follow them.

- **Deploy wiring.** The factory deploys the `CanvasAccount` implementation in its constructor. The registry and `ZalInvoice` take the factory, and the pool takes `ZalInvoice`. `wire` runs once, checks each address against the others (`WiringMismatch`), and `createAccount` reverts until wired. Accounts copy the wiring at `initialize`, and `ZalInvoice` reads the pool through `factory.pool()`.
- **Account creation.** `createAccount` is open to anyone. The clone salt is `keccak256(admin, salt)`, so nobody can take an address predicted for another admin. A new account starts with threshold 1 and `approvalLimit` 0.
- **Members.** `setMember` reverts if it would leave fewer approvers than `threshold`.
- **Gated ops.** There is no op-cancel. A stale `policyNonce` is the only cancellation. Pending ops never expire by time. If the gated call reverts, the confirming transaction reverts, and it can be sent again later.
- **Budgets.** `setBudget` rejects id 0. `approveInvoice(id, 0)` means unbudgeted. `periodLength` 0 means 30 days. Periods stay aligned to the first one, and editing a budget keeps its usage.
- **Routes.** A Transfer leg to the zero address is rejected in `setRoute`. A vault leg whose vault was de-listed after `setRoute` falls back to Hold. `vaultRedeem` works on de-listed vaults, so funds can always leave.
- **Relationships.** A `propose` over an expired proposal cancels the old one and replaces it. The proposer may cancel after expiry. Invites use an unordered per-proposer nonce, and the signer must be an EOA Admin at redemption time.
- **Invoices.** `approveInvoice` does not check the due date.
- **Pool.**
  - `advance` reverts on zero principal. `setRates(advanceRateBps, annualFeeBps)` is one owner call, with `advanceRateBps` in 1..10,000, and it affects later advances only.
  - A repayment with zero reserve skips `receivePayment`.
  - `maxWithdraw` is computed from the share balance, capped by idle cash.
  - `setObligorLimit`: limit 0 means not enrolled, and lowering a limit below open principal blocks new advances but never repayment. The ZR-FND-07 revert is `ObligorLimitExceeded(buyer, required, limit)`. An escrowed invoice never uses the limit.
- **Mocks.** `ZUSDC` (zUSDC) has an open `mint`. `ZalVault` has no on-chain rate. The keeper reads `simulated_apy_bps` from config, and it stays TBD (open question 8).

## Out of scope for v1 contracts
Stream (P2): it needs a flow-rate token and is not built. Schedules are in v1, on-chain (ADR 0015, superseding ADR 0010). Also out of scope: ending relationships, disputes, overdue handling, credit scoring, protocol fees, multi-asset, and upgradeability.
