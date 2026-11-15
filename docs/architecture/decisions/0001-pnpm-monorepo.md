# 0001 — One pnpm monorepo with packages
Status: accepted

## Context
Zal has contracts, a web client, and soon an indexer that pushes events to the canvas. The client and the indexer both need the contract ABIs and addresses. Zalax kept Foundry at the repo root next to `frontend/` and `agent/`, which mixed Foundry paths with the workspace.

## Decision
One pnpm workspace. Every unit is a package under `packages/`: `contracts` (Foundry), `web` (Next.js and HeroUI), and `indexer` when it is built. Each package owns its build and test scripts, and the root only runs them recursively. Foundry dependencies are git submodules under `packages/contracts/lib`.

## Consequences
- `pnpm -r build` and `pnpm -r test` cover everything. CI can filter by package path.
- ABIs move from `contracts` to the other packages through a generated, typed export, not hand-copied JSON.
