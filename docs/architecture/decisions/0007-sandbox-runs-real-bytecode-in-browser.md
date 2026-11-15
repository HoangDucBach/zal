# 0007 — The sandbox runs the real contracts in an in-browser EVM
Status: accepted (prototype passed 14 Nov 2026)

## Context
Users should try Zal at once: connect a wallet, flip a Sandbox switch, and run the whole PRD demo alone, with no faucet, no gas and no network setup. Zalax built its sandbox as a TypeScript re-implementation of its contracts behind a transport switch (`frontend/src/lib/sandbox`). The transport switch worked well. The re-implementation needed differential tests to stay true to the Solidity. A shared sandbox deployment on the L1 would need a server faucet, bot accounts and gas, and it still could not move time forward for the timeline demo.

## Decision
Keep Zalax's shape: a sandbox mode store, a `sandboxAware(http())` transport, and a sandbox wallet connector. Replace the hand-written engine with an in-browser EVM (tevm, or `@ethereumjs/vm` directly if tevm fails) that deploys the compiled artifacts from `packages/contracts/out` at load. The user still connects a real wallet. In the sandbox, the node impersonates that address, so there are no signing prompts. A seed script creates the user's `CanvasAccount`, funds it with `MockUSDC`, and creates bot counterparties (a demo club and an LP) that accept and approve on their own. The sandbox clock can be advanced, so the timeline can really reach the due date. State persists in the browser and has a reset.

## Consequences
- No sandbox logic to keep in sync with Solidity. The sandbox is the same bytecode.
- The engine loads by dynamic import, so live mode does not bundle it.
- To prove before accepting: tevm deploys every Zal contract, runs AT-09 (one-transaction settlement through pool and Split), supports transient-storage reentrancy guards (cancun), and advances time. The bundle cost is measured.

## Evidence (14 Nov 2026)
- `packages/web/lib/sandbox/engine/demo-flow.test.ts` deploys every artifact from `packages/contracts/out`, using Deploy.s.sol's wiring. It then runs PRD demo steps 1 to 7 against the real bytecode:
  - Settlement is one transaction. The pool gains exactly the fee, and the reserve splits 90/10 through the seller's route.
  - Transient-storage reentrancy guards work across consecutive transactions.
  - Time advance reaches the EVM. A stranger's `payInvoice` reverts before the due date and succeeds after it.
  - Replaying the saved journal rebuilds the same chain.
- The same flow passes in a headless browser with an injected wallet, with zero console errors.
- The engine is one lazy chunk, 1.37 MB (351 KB gzipped). It loads only when Sandbox turns on and is not in the live page manifest.

## Implementation notes
- tevm is pinned to `1.0.0-rc.151` (`@tevm/actions`, `@tevm/node`, `@tevm/memory-client`, `@tevm/common`). `rc.153` imports an export that `@tevm/errors@rc.151` lacks, and the `latest` tag (`next.148`) imports a chain viem 2.57 removed. Re-test before bumping.
- `@tevm/node` imports `fs` for an option Zal never uses. `next.config.mjs` aliases it to `lib/sandbox/fs-browser-stub.ts` in the browser build.
- The sandbox runs on its own chain id (7357001) with an in-browser `custom()` transport, instead of Zalax's `sandboxAware(http())` on the live chain id. Live may not exist yet, and a separate id keeps sandbox state out of live caches.
- The sandbox connector reports the real wallet's address and sends without prompts. A wallet's canvas is `predictAccount(wallet, 0x0)`.
- State is a per-wallet journal in localStorage, keyed by a hash of the bytecode, and replayed on load.

## Seed and bots (updated 14 Nov 2026)
- **Demo club.** It buys from you, signs 2 of 2, escrows, and pays at the due date.
- **Demo print shop.** It sells to you. It proposes at seed, then issues one invoice at a time (1,200, then 800, then 450 USDC, each due in 14 days).
- **Sandbox co-signer.** It is an approver on your account at policy 1 of 2, and signs only when asked. The Approval component raises the policy, prefilled to 2 signatures above 500 USDC.
- **Keeper.** It settles scheduled, escrowed invoices at the due date (ADR 0010). Its job list is persisted beside the journal.
- **Your wallet.** It gets 5,000 MockUSDC for the LP role.
- **Storage.** The journal key is v2.
