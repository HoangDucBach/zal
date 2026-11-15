# Open questions and known issues

Do not fill a TBD yourself. Propose a value, mark it proposed, and ask.

## Product (from the PRD)
1. Can a buyer create an invoice (a purchase order) for the seller to approve, or only the seller? v1 contracts: seller only.
2. Recourse or non-recourse when an invoice is not escrowed? v1 contracts: the pool advances only against escrowed invoices or buyers the owner enrolled with a credit limit (ADR 0009). An unpaid funded invoice stays open in the pool. Who sets the limits, and how, is open.
3. Is the Payee Endpoint public or private by default? On-chain the route is always readable, so "private" hides it in the Zal UI only. Real privacy (for example a commitment plus a route revealed at pay time) breaks one-transaction settlement and is not planned.
4. How long does a ghost proposal live before it expires? `Relationship.expiresAt` exists. Default TTL is TBD.
5. Resolved on 15 Nov 2026, as the coordinator's default, so the owner can still change it. A wallet opens any canvas where `roleOf(wallet)` is not None.
   - You pick the canvas in the sidebar switcher, and the URL carries it as `?account=`.
   - The list of canvases comes from the indexer (`GET /v1/wallets/:wallet/accounts`) or from MemberSet logs. Each entry is checked on-chain before it is shown.
   - Viewer is read-only. Approver confirms, revokes and submits gated payments. Admin can do everything.

## Calibration
6. `annualFeeBps` for the demo. About 1521 bps gives a fee near 50 USDC on a 4,000 principal over 30 days, which matches the PRD's round figure. Proposed, not decided.
7. Does the advance pass through the seller's Split, so tax is taken on the 4,000 too, or land in Hold? v1: Hold, which matches demo step 6.
8. `ZalVault` simulated yield figure. TBD.

## Platform
9. USDC on the Zal L1: `ZUSDC` (zUSDC) on the L1 for v1. Bridged USDC through ICTT later, outside the payment flow (ADR 0013).
10. Gas on the L1: a low fee config plus a native-token faucet (NativeMinter), or a gas relayer. Decide with the L1 genesis.
11. L1 permissions: open, or `TxAllowList` like Zalax. Open makes the demo simpler. Allow-list matches a real deployment.

## Sandbox values (not calibrations)
12. The sandbox seeds the user with 10,000 zUSDC, the demo club with 20,000, the LP deposit with 50,000, and the club's obligor limit with 20,000. The demo club has 2 signers, policy 2 of 2, approval limit 0, and budget #1 "Events" of 10,000. The print shop invoices are 1,200, 800 and 450 USDC, the wallet gets 5,000 zUSDC for the LP role, and the Approval form prefills 2 signatures above 500 USDC. These exist only in the in-browser sandbox (ADR 0007).

## Known issues (accepted for v1)
- K-1. Pool fees are recognised on repayment, not accrued. A depositor who joins just before a repayment captures part of that fee. A fix is linear fee accrual in `totalAssets`.
- K-2. An overdue funded invoice that is never paid leaves its principal in `outstanding`, so `totalAssets` overstates the pool. No write-down exists in v1.
