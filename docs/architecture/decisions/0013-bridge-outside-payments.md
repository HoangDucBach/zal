# 0013 — Bridging stays outside the payment flow; Zal is token-agnostic
Status: accepted

## Context
Zal runs on its own L1. Real USDC lives on Avalanche C-Chain. Avalanche ICM/ICTT can move it to the L1 (`ERC20TokenHome` on C-Chain, `ERC20TokenRemote` on the L1, plus a relayer). The owner asked whether payments need a bridge, or whether bridging can live outside and only bring assets onto the L1.

## Decision
Bridging is onboarding, not payment. Zal never calls a bridge inside a payment. A user or a club treasury moves USDC to the L1 once, through any ICTT interface. After that, every payment, split and advance runs on the L1 in one transaction (PRD principle on one-transaction settlement). The Zal contracts take the asset address through `ZalFactory.wire`, so switching from `ZUSDC` (zUSDC) to the bridged token is a redeploy with a different address and no contract change. The app offers a light "Deposit" entry (balance on the L1 and how to bridge), not a canvas node.

## Consequences
- Payments stay synchronous and independent of relayer uptime.
- Running ICTT (one deploy per side, a relayer) is an operations task for when the L1 is configured. Estimated one to two days with Zalax's relayer setup.
- Until then the L1 uses `ZUSDC` (zUSDC), labelled testnet.
