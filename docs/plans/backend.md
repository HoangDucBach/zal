# Plan: live-mode backend (ADR 0012)

Goal: the canvas works completely in live mode, with storage, real-time updates and notifications, and the whole stack runs from `docker compose up`.

## Phase 1: service and stack
This runs in parallel with the canvas work and does not touch `packages/web` components.

1. `packages/indexer`: Ponder with exact pins and Postgres. The config reads chain id, RPC and addresses from env, or from `packages/contracts/deployments/<name>.json`. ABIs come from `packages/contracts/out`.
2. On-chain schema and handlers for every event in `docs/architecture/contracts.md`, "Events". Done when every table is rebuilt from events, checked by a test that replays the sandbox demo flow against anvil.
3. `zal_app` schema in Drizzle: `layouts`, `notification_reads`, `invites`, and `sessions`, with migrations.
4. REST `/v1`:
   - Reads:
     - `GET /v1/accounts/:address/canvas` (graph state in the web `CanvasState` shape)
     - `GET /v1/accounts/:address/activity`
     - `GET /v1/accounts/:address/notifications`
     - `GET /v1/pool`
   - Auth: `POST /v1/auth/nonce`, `POST /v1/auth/verify`.
   - Writes:
     - `PUT /v1/accounts/:address/layout`
     - `POST /v1/notifications/read`
     - `POST /v1/invites`, `GET /v1/invites/:id`
   - Every response carries `asOf { block, updatedAt }`. Amounts are decimal strings in base units. Addresses are lowercase.
5. `GET /v1/stream?account=` sends SSE through Postgres `LISTEN/NOTIFY`, with a heartbeat and `Last-Event-ID` resume.
6. Docker:
   - Dockerfiles for indexer and web (multi-stage, non-root, pinned base images).
   - `docker-compose.yml` with services postgres, anvil, deploy (one-shot), indexer and web, with healthchecks and `depends_on` conditions.
   - `.env.example`.
   - `docs/runbooks/local-stack.md`.
7. Done when `docker compose up` brings everything healthy and a script drives the seller demo on anvil through the contracts, then confirms the API and the SSE stream reflect each step.

## Phase 2: web on the API
Starts after the current canvas work lands, so no two agents edit the same files.

1. Typed client in `packages/web/lib/api` (zod-parsed), with query keys and an SSE hook that invalidates queries.
2. In live mode, the canvas reads from the API, saves layout and read state to the API after signing in, and the Inbox comes from the API stream. The sandbox path is unchanged.
3. Invite links (PRD R1) through `/v1/invites`.
4. Playwright run of the seller demo against the docker stack, in live mode with anvil.

## Gates (every phase)
- Independent review of the API's auth and writes. It is a new trust boundary.
- `pnpm -r lint typecheck test build`, forge tests, and `docker compose config`.
