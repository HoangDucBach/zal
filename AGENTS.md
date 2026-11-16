# Zal

Zal is an on-chain payment canvas on an Avalanche L1. Every user gets the same canvas and programs where money goes with nodes and edges. Two canvases form a buyer and seller relationship. The seller issues Invoice NFTs. The buyer approves, escrows and pays them in one transaction that runs through both parties' flows. A funding pool advances money to sellers against buyer-approved invoices (reverse factoring). Testnet USDC only. Product: [docs/product/prd.md](docs/product/prd.md).

## Read before changing anything
- `docs/architecture/README.md` is the index. Start there.
- `docs/architecture/contracts.md` is the contract spec. `docs/architecture/requirements.md` has `ZR-*` IDs, invariants `INV-*`, and acceptance tests `AT-*`. Cite them in NatSpec, test names and commit bodies.
- `docs/architecture/decisions/` explains why. Read the relevant ADR before changing a design.
- `docs/architecture/open-questions.md` lists TBDs. Do not fill a TBD yourself.
- If code, docs and the PRD disagree, stop and ask.

## Layout (pnpm monorepo, ADR 0001)
| Path | What | Commands |
|---|---|---|
| `packages/contracts` | Foundry, Solidity 0.8.25, cancun, OpenZeppelin 5 | `pnpm --filter @zal/contracts build`, `test`, `fmt`, `sizes`, `mutate` |
| `packages/web` | Next.js 16, HeroUI v3, xyflow, wagmi, tevm sandbox. Read `packages/web/AGENTS.md` first | `pnpm --filter @zal/web dev`, `lint`, `typecheck`, `test`, `build`, `gen:contracts` (after any contract ABI change) |
| `packages/indexer` | Ponder indexer and `/v1` API (Hono), Postgres, SSE (ADR 0012) | `pnpm --filter @zal/indexer test`, `test:stack` (needs the docker stack), `test:reindex` |
| `docker-compose.yml` | postgres, anvil, deploy, indexer, web | `docker compose up -d --build --wait`; see `docs/runbooks/local-stack.md` |
| `docs/` | PRD, architecture, ADRs, runbooks | n/a |

## Rules that must hold
1. Roles belong to relationships, not accounts. Every canvas is the same `CanvasAccount` contract (ADR 0002).
2. Ghost and solid come from on-chain state, never from client state (ADR 0003).
3. The payment recipient is `ownerOf(invoiceId)`. An Invoice NFT moves only from its seller to the funding pool, while approved (ADR 0005).
4. Settlement is one transaction: buyer, then the pool if funded, then the seller's Split.
5. Rounding favours the pool. Split remainders go to the last leg.
6. `CanvasAccount.receivePayment` trusts its caller, so only `ZalInvoice` and `ZalFundingPool` may call it.
7. No oracles, no upgradeability, no arbitrary calls from accounts.
8. `ZUSDC` (zUSDC) is testnet money and `ZalVault` yield is simulated. The app says so once: a "testnet" badge in the shell and in Docs, not next to every amount (ADR 0017).
9. Do not invent calibration numbers (`annualFeeBps`, vault yield, relationship TTL). Mark them TBD and ask.
10. Frontend: HeroUI through its CLI, default look, xyflow defaults (ADR 0006). The `heroui_cli_guard` hook enforces this.
11. The funding pool advances only against a fully escrowed invoice or a buyer the pool owner enrolled with a credit limit (ADR 0009).
12. After any change to a contract ABI, run `forge build` and then `pnpm --filter @zal/web gen:contracts`. The sandbox runs the same bytecode (ADR 0007).

## Do not
- Edit invariants or acceptance tests to make a failing test pass.
- Put a role ("buyer", "seller") on an account.
- Add custom CSS, decorative Tailwind, or a second icon set to the web package.

## When you change the design
1. Write a new ADR in `docs/architecture/decisions/` (Context, Decision, Consequences).
2. Update `contracts.md`, `requirements.md` and the diagrams it affects.
3. Tell the user which PRD sections need the same change.

## Commits
Conventional Commits (`.claude/rules/project/commits.md`). Do not commit unless asked.
