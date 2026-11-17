# @zal/web

The Zal client: a landing page and an app shell around one canvas. Next.js 16 (app router), HeroUI v3, xyflow, wagmi 3, viem 2 and TanStack Query 5.

Read [AGENTS.md](AGENTS.md) before adding UI. Components come from HeroUI and are looked up through the HeroUI CLI or MCP server, not written by hand.

## Commands

```bash
pnpm --filter @zal/web dev            # http://localhost:3000
pnpm --filter @zal/web lint
pnpm --filter @zal/web typecheck
pnpm --filter @zal/web test           # vitest: pure logic and the sandbox demo flow on the real bytecode
pnpm --filter @zal/web build
pnpm --filter @zal/web gen:contracts  # after `forge build` or a redeploy in packages/contracts
```

## Networks

The app runs on one of two networks.

- **Sandbox.** Connect any wallet, then turn on the Sandbox switch in the sidebar footer (or follow a "Try sandbox" link, `?sandbox=1`). The compiled contracts from `packages/contracts/out` run in an in-browser EVM (tevm). The sandbox uses the connected address without signing prompts. It seeds your account with 10,000 zUSDC (testnet) and a sandbox co-signer as its second approver, puts 5,000 zUSDC in your wallet for the LP role, and adds three counterparties: a demo club that buys from you (two signers, an Events budget, enrolled with the pool), a demo print shop that sells to you (it has already proposed, and issues one invoice at a time once you accept), and an LP. A keeper settles the escrowed invoices you schedule, at their due date. Advance the clock from the canvas (+1 day, +30 days) or jump to a due date from the Timeline. Reset starts over. State is saved in the browser as a journal of transactions plus the keeper's schedule, and replayed on load. Every seeded amount is a sandbox value.
- **Live.** The Zal L1. It is off until these variables are set and `packages/contracts/deployments/<name>.json` has a deployment for that chain id (then run `gen:contracts`):

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_ZAL_CHAIN_ID` | Chain id of the L1 |
| `NEXT_PUBLIC_ZAL_RPC_URL` | HTTP RPC URL |
| `NEXT_PUBLIC_ZAL_CHAIN_NAME` | Display name, default `Zal L1` |
| `NEXT_PUBLIC_ZAL_NATIVE_SYMBOL` | Gas token symbol, default `ZAL` |
| `NEXT_PUBLIC_ZAL_EXPLORER_URL` | Optional block explorer |
| `NEXT_PUBLIC_ZAL_API_URL` | The indexer's `/v1` API, for example `http://localhost:42069`. Without it, live mode reads the chain directly and keeps layout and read state in the browser |

A local anvil deployment (`deployments/local.json`, chain 31337) works the same way. The docker stack bakes all of these into the web image; see [docs/runbooks/local-stack.md](../../docs/runbooks/local-stack.md).

### Live mode with the API

- **Reads.** The canvas, activity and pool come from `GET /v1/accounts/:address/canvas`, and the Inbox from `GET /v1/accounts/:address/notifications`. Responses are zod-parsed into the same types the chain reads give (`lib/api/wire.ts`). If the API is down or answers 5xx, the canvas falls back to reading the chain.
- **Real time.** One `EventSource` on `GET /v1/stream?account=` per page (`hooks/use-live-updates.ts`). A `feed` event refetches the chain's reads, a `layout` event refetches the canvas snapshot, and `reset` refetches everything. While the stream is down for more than 4 seconds, the page polls the chain instead and the canvas shows "Live updates paused".
- **Sign-in.** Reads work signed out. The first layout edit shows a one-line prompt; signing it (EIP-4361, domain and URI are the page's origin) gets a bearer token, kept in memory and `sessionStorage` until the tab closes or the wallet disconnects. The API accepts sign-in only from an origin in its `ZAL_WEB_ORIGIN` allow-list (default `http://localhost:3100,http://localhost:3001`).
- **Layout.** Positions, child canvases and drafts save to `PUT /v1/accounts/:address/layout` with the revision they started from. On 409 the client reloads the layout and replays its unsaved edits on it (`lib/api/layout-sync.ts`). Chain-derived positions never trigger a save or a sign-in by themselves.
- **Read state.** Kept in the browser as before, and also sent to `POST /v1/notifications/read` while signed in, so other browsers see it.
- **Invite links (PRD R1).** In the Counterparty form, "Copy invite link" has the Admin sign the EIP-712 invite, stores it with `POST /v1/invites`, and copies `/app/invite/<id>`. That page shows the proposer as a ghost, creates the invitee's canvas if needed, and redeems with `acceptInvite`.
- **Deposit.** The profile toolbar's Deposit item shows the canvas and wallet balances on the L1. On chain 31337 it also mints 1,000 testnet zUSDC.

## End-to-end proofs

Browser drivers in `e2e/` click through the app in headless Chromium with `playwright-core`. Each prints `pass` or `FAIL` per check, saves screenshots, and exits 1 on any failure.

```bash
pnpm --filter @zal/web exec playwright-core install chromium-headless-shell   # once per playwright-core version
ZAL_ANVIL_PORT=8546 pnpm --filter @zal/web e2e:live                           # the docker stack, live mode
BASE=http://localhost:3001 pnpm --filter @zal/web e2e:sandbox                 # any running web server
```

- **`e2e:live`** runs `e2e/zal-live.mjs` against the docker stack in live mode. It needs the stack from [docs/runbooks/local-stack.md](../../docs/runbooks/local-stack.md) running, and the web image built for the same anvil port. Each browser context gets its own funded key, so sign-in, invites and transactions carry real signatures (`e2e/wallet.mjs`). It runs the PRD seller demo with a designer and a club in two browsers and checks each update reaches the other page over the stream without a reload. The club account runs a 2-of-2 policy above 0 USDC: the club Admin submits the approval, escrow and payment in the browser, and a second approver wallet confirms each one. The run checks that the approval waits at the Approval node (1 of 2, invoice still a ghost on both canvases) until the second signature, and then turns solid on both. The second approver signs from its wallet directly, not through the UI, because the app opens only a wallet's own canvas. The run then checks layout saves and sign-in, an invite link, and the fallback when the stream is down. It creates fresh wallets each run, so it can run again on the same chain.
- **`e2e:sandbox`** runs `e2e/sandbox.mjs`: `zal-connect`, `zal-canvas`, `zal-check --seller` and `zal-partners`, one after another, with a stub wallet on `?sandbox=1`. It needs only a web server. The chain runs in the page.

| Variable | Default | Meaning |
|---|---|---|
| `BASE` | `http://localhost:3100` | The web app under test |
| `API` | `http://localhost:42069` | The indexer API (`e2e:live` only) |
| `ZAL_ANVIL_PORT` | `8545` | Host port of anvil (`e2e:live` only). `RPC` overrides the whole URL |
| `PLAYWRIGHT_CHROMIUM` | Playwright's own install | Path to a Chromium or `chrome-headless-shell` binary |

Screenshots go to `e2e/.out` (gitignored), or to the folder given as the first argument, for example `pnpm --filter @zal/web e2e:live /tmp/zal-shots`. `e2e:live` hardcodes the factory and zUSDC addresses of the local anvil deployment.

## Layout

| Path | What |
|---|---|
| `scripts/gen-contracts.ts` | Writes `contracts/abis.ts` and `contracts/bytecode.ts` (`as const`) from the forge artifacts, and `contracts/deployments.ts` from the deployment files and `script/config/local.toml`. Generated files are not edited by hand |
| `config/` | `env.ts` (zod), `chains.ts` (sandbox chain, live network or the reason it is off), `wagmi.ts` |
| `lib/query/` | Query keys, `AppError` mapping (including `ApiError` for RFC 9457 problems), `QueryProps` and `MutationProps` |
| `lib/api/` | The `/v1` client (`client.ts`), wire parsers (`wire.ts`), the SIWE session store (`session.ts`), stream events and their invalidations (`stream.ts`), layout sync (`layout-sync.ts`), invite links (`invite.ts`) |
| `lib/contracts/` | `useContractMutation` (simulate, write, wait, invalidate), `canvas-reads.ts` (one canvas from events and views), `event-keys.ts` (event to stale queries) |
| `hooks/contracts/` | One file per contract: reads and writes. `canvas-account.ts` has the gated op flow (`useSubmitOp`, `useConfirmOp`, `useRevokeOp`). `events.ts` watches every Zal contract |
| `lib/canvas/` | The domain model, chain state to nodes and edges with ghost and solid (`graph.ts`), and advance eligibility (`advance.ts`) |
| `lib/sandbox/` | Mode store, transport, wallet connector, session. `engine/` (tevm chain, deploy and seed, demo bots) loads only by dynamic import |
| `lib/canvas/palette.ts` | Story C2: which palette component fits the selection and chain state, and the action it starts, or why not |
| `lib/canvas/guided-demo.ts` | Story S1: the eight PRD demo steps and the buyer and LP steps, detected from chain state |
| `app/` | `/` landing, `/app` (redirects to `/app/canvas`), `/app/overview`, `/app/canvas`, `/app/docs`, `/app/invite/[id]` |
| `components/shell/` | Sidebar, profile toolbar (wallet, network, Deposit, Sandbox switch, theme, disconnect) |
| `components/invite/` | The invite link page |
| `components/canvas/` | The canvas, node types, palette, tool bar, Inspector and its action forms, Inbox, guided demo, sandbox clock, Timeline |
| `components/overview/` | The read-only Overview. Rows link to `/app/canvas?focus=<nodeId>` |

## Bundle

Live mode does not load the sandbox. The engine and the bytecode build into one lazy chunk, fetched only when the Sandbox switch is turned on.
