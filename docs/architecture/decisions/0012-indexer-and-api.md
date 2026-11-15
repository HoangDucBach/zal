# 0012 — Ponder indexer, Postgres, and SSE for live mode
Status: accepted

## Context
In live mode the canvas needs four things that the chain alone does not give well:
- Fast reads of each account's whole graph.
- History for the timeline and Overview.
- Real-time updates on both canvases (PRD principle 5).
- Somewhere to keep presentation state that is not on-chain: canvas layout and child canvases (ADR 0011), notification read state, and invite links.

The client polls logs every second today (ADR 0008). AvaCloud does not serve our L1 (ADR 0008). The sandbox runs in the browser and needs none of this (ADR 0007).

## Decision
- **Indexer and API.** One service in `packages/indexer`, built on Ponder (exact pinned version). It indexes every Zal contract from the deployment block. Handlers store what events say and read contract state where an event alone is not enough; they never recompute contract math. Custom REST routes live under `/v1` on Ponder's Hono server. Ponder's generated GraphQL is not part of the contract with the web app.
- **Database.** PostgreSQL 17. Ponder owns the on-chain schema. Off-chain tables live in a separate schema (`zal_app`), written with Drizzle:
  - layouts per (chain, account),
  - notification read state per (chain, wallet),
  - invites.
- **Real time.** `GET /v1/stream?account=…` is a Server-Sent Events stream. Indexing handlers publish through Postgres `LISTEN/NOTIFY`, so the stream works whether the API and the indexer share a process or not. The web app keeps `watchContractEvent` only as a fallback when the stream is down.
- **Writes.** Off-chain writes require a wallet signature (a SIWE-style message, then a short-lived session). Only an Approver or Admin of the account may write its layout (ADR 0014; originally any member). Notification read state belongs to the signing wallet.
- **Notifications.** Derived on the server from indexed events with the same six kinds the web app uses. Read state is stored per wallet. The web app's local derivation stays for the sandbox.
- **Docker.** `docker compose up` runs postgres, anvil (the local stand-in for the Zal L1), a one-shot deploy job (`forge script script/Deploy.s.sol`), the indexer, and the web app. Pointing at the real L1 later is an env change.

## Consequences
- Live mode gets one consistent read model, plus history and push updates.
- Presentation state survives across devices in live mode. It stays in browser storage in the sandbox.
- Re-indexing from the deployment block rebuilds every on-chain table. The off-chain tables are the only data that needs backup.

## Implementation notes (15 Nov 2026)
- Ponder 0.18.7, Postgres 17.12, viem 2.57.16, hono 4.13.18, drizzle-orm 0.41.0. Base images pinned by tag and digest.
- Sessions: SIWE (EIP-4361) then a bearer token (32 random bytes, sha256 stored, 1 hour, chain-scoped). Bearer, not cookies: web and API are different origins, and a bearer token carries no ambient authority, so there is no CSRF surface. Ponder already sends `Access-Control-Allow-Origin: *`; without cookies that grants nothing. SIWE binds sign-in to `ZAL_WEB_ORIGIN` (domain, URI, chain id, issuedAt age, expiry).
- Nonces are claimed atomically after the signature check, so a replayed message fails.
- Layout writes require `factory.isAccount(account)` and `roleOf(wallet) != None`, read at chain head; `revision` gives optimistic concurrency (409 on stale).
- Anvil runs with `--preserve-historical-states` and `init: true`, because handlers read state at each event's block and anvil otherwise loses history on restart.
- Each build indexes into `zal_index_<hash of indexing inputs>`, so an indexing change reindexes into a new schema. Old schemas remain until `docker compose down -v`.
- Known follow-ups: expired nonce and session cleanup, per-IPv6-/64 rate-limit keys, every pool event waking every stream.
- Web client (Phase 2): `packages/web/lib/api/*`.
  - **Reads.** Live mode reads canvas, activity, notifications and pool from the API. It falls back to chain reads when the API is unreachable or answers 5xx.
  - **Writes.** In live mode, a transaction resolves only after the API has indexed its block.
  - **Stream.** On `feed`, the client refetches active reads on that chain, batched over 150 ms. On `layout`, it refetches the canvas snapshot. On `reset`, it refetches everything.
  - **Sign-in.** It is asked for only when a user edit needs saving. The token is kept in memory and sessionStorage, and is sent only to the API.
  - **Layout saves.** The first save sends no `revision`. On 409, the client replays its pending edits over the newer layout.
  - **Read state.** It works signed out from browser storage, and is sent to the API once signed in.
- Security review (15 Nov 2026, independent, fable). Ten findings, all fixed with regression tests in `packages/indexer/test/{security,stream}.test.ts`:
  - HEAD on the stream leaked a slot.
  - An invite with a used nonce was stored.
  - A stale `Last-Event-ID` left the stream silent.
  - SIWE time parsing failed open.
  - Invite nonces had more than one spelling, and an r = 0 signature crashed recovery.
  - Layout input was not checked for jsonb-safety or bounds, and the first write ran no revision check.
- `GET /v1/wallets/:wallet/accounts` lists the canvases a wallet belongs to, from MemberSet. The client treats the list as hints only. Pending ops shown for signing are read and decoded from chain storage, and the client flags any API description that differs from the chain.
