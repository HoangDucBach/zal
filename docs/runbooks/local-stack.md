# Local stack

Run the live-mode stack on one machine: Postgres, anvil as the local Zal L1, the contracts, the indexer with the `/v1` API, and the web app (ADR 0012).

## Before you start

- Docker with Compose v2. On this Mac that is OrbStack.
- These host ports are free: 5433 (Postgres), 8545 (anvil), 42069 (indexer), 3100 (web). To use other ports, copy `.env.example` to `.env` and change them there.

## Start the stack

1. From the repository root, run:

   ```bash
   docker compose up -d --build --wait
   ```

   The services start in this order. Compose waits for each health check.

   | Service | What it does | Ready when |
   |---|---|---|
   | `postgres` | PostgreSQL 17. Ponder's tables and the `zal_app` schema | `pg_isready` |
   | `anvil` | Chain 31337. State persists in the `anvil` volume | `cast chain-id` answers |
   | `deploy` | Runs `Deploy.s.sol` once, then exits 0. On a rerun it sees the factory has code and skips | exited 0 |
   | `indexer` | Applies the `zal_app` migrations, then `ponder start` | `GET /ready` returns 200 |
   | `web` | Next.js, live network baked in at build time | `GET /` returns 200 |

2. Check that every service is healthy:

   ```bash
   docker compose ps
   ```

3. Open http://localhost:3100. To use live mode, add a wallet network with RPC `http://localhost:8545` (or your `ZAL_ANVIL_PORT`) and chain id 31337. With the Sandbox switch off, the canvas reads from the API and updates over its stream.
4. To fund a canvas, open **Deposit** in the sidebar footer and mint testnet zUSDC. The faucet shows only on chain 31337.

Sign-in (needed only to save layout and read state) works only from an origin listed in `ZAL_WEB_ORIGIN`. It is a comma-separated allow-list and defaults to `http://localhost:3100,http://localhost:3001`: the docker web and a `next dev -p 3001` server. Each entry is an exact origin (scheme, host and port), with no wildcard. A signed message must name one entry as its URI and that same entry's host as its domain. A web server on any other origin reads and streams from the same API, but its sign-in is refused. To allow another origin, set `ZAL_WEB_ORIGIN` in `.env` with the full list, then rebuild only the indexer:

```bash
docker compose up -d --build --wait indexer
```

If you changed the web port with `ZAL_WEB_PORT`, list that origin in `ZAL_WEB_ORIGIN` too.

## Prove it works

Run the seller demo against the running stack:

```bash
pnpm --filter @zal/indexer test:stack
```

The script creates fresh actors, drives PRD demo steps 1 to 8 through the contracts, and checks after each step that the API and the SSE stream show it. It also signs in, saves a layout, checks that a non-member gets 403, and resumes the stream from a `Last-Event-ID`. It also drops 30 streams mid-handshake and checks that their slots come back. It ends with `stack demo passed`. You can rerun it on the same chain.

To prove that every on-chain table is rebuilt from events, run:

```bash
pnpm --filter @zal/indexer test:reindex
```

It stops the indexer, indexes the chain from block 0 into a scratch schema, waits until that schema reaches the live checkpoint, and compares every table row by row. It prints `same <table>` for each table and exits 1 on any difference. It then drops the scratch schema and starts the indexer again.

If anvil runs on another host port, set `ZAL_RPC_URL`, for example `ZAL_RPC_URL=http://localhost:8546`. `ZAL_API_URL` and `ZAL_WEB_ORIGIN` work the same way. The demo signs in as the first origin in `ZAL_WEB_ORIGIN`.

## Use the API

| Request | Answer |
|---|---|
| `GET /v1/accounts/:address/canvas?wallet=` | The web `CanvasState` and the saved layout |
| `GET /v1/accounts/:address/activity?before=&limit=` | Activity, newest first, paged by cursor |
| `GET /v1/accounts/:address/notifications?wallet=` | The six notification kinds, each with `read` for that wallet |
| `GET /v1/pool?wallet=` | Pool figures, and the wallet's LP position |
| `GET /v1/stream?account=` | SSE: `ready`, then `feed` events with id `<block>-<logIndex>`, and `layout` events. A `Last-Event-ID` more than 2,000 rows back gets `reset` first: refetch state. At most 10 streams per client and 1,000 in all |
| `POST /v1/auth/nonce`, `POST /v1/auth/verify` | Sign-in with Ethereum, then a bearer token |
| `GET`, `DELETE /v1/auth/session` | The session's wallet, or sign out |
| `PUT /v1/accounts/:address/layout` | Approvers and admins only (ADR 0014). Always send `revision` (0 for the first save) to get 409 on a lost update |
| `GET /v1/wallets/:wallet/accounts?limit=&cursor=&acted=&q=` | Canvases the wallet is a member of, acted-on first, 50 per page (max 100). Hints only: the client verifies each on-chain |
| `POST /v1/notifications/read` | Marks keys read for the signed-in wallet |
| `POST /v1/invites`, `GET /v1/invites/:id` | A signed relationship invite behind a link id |

Request bodies are capped at 64 KB, and a layout at 256 KB. Every success carries `asOf { block, updatedAt }`. Amounts are decimal strings in base units. Addresses are lowercase. Errors are `application/problem+json` with a `code`.

## Stop and reset

- Stop and keep all data: `docker compose down`. The next `up` resumes anvil's chain and the indexed data.
- Start over from an empty chain and database: `docker compose down -v`. This deletes the `zal_app` tables too: layouts, read state and invites.

## Troubleshoot

- **A port is in use.** Set the matching variable in `.env`, for example `ZAL_ANVIL_PORT=8546`. The web image bakes in the anvil and API URLs, so rebuild it: `docker compose up -d --build web`.
- **The indexer is not healthy.** Read `docker compose logs indexer`. Each image indexes into a schema named after its indexing code (`zal_index_<hash>`), so a code change reindexes from block 0 into a new schema. Old schemas stay until `down -v`.
- **The deploy job failed.** Read `docker compose logs deploy`. A broken anvil volume can be reset alone: `docker compose down`, then `docker volume rm zal_anvil zal_deployments`, then `docker compose up -d --wait`. Reset `zal_postgres` too, because the indexed data would describe the old chain.
- **The web build fails.** The web image builds `packages/web` as it is on disk. Fix the build with `pnpm --filter @zal/web build` first.
- **The web app shows an old version.** The image is built from the disk at build time. After a change to `packages/web`, run `docker compose up -d --build --wait web`.
- **"Live updates paused" on the canvas.** The page could not reach `GET /v1/stream` for 4 seconds and is polling the chain instead. Check `docker compose logs indexer`; the page switches back by itself when the stream answers.

## Keys

The deploy job and the demo script use anvil's well-known account 0 as the protocol owner. It is a public development key, labelled local-only in `docker-compose.yml`. Never use it on a shared network.

## Anvil state and chain resets
- Anvil keeps every block's state (`--preserve-historical-states`) because the indexer reads past state, so the saved file grows to hundreds of MB. It dumps every 5 minutes and on stop; compose gives it a 120 s stop grace period. Never `docker kill` anvil: a stop in the middle of a dump leaves a truncated `/data/anvil-state.json` that anvil refuses to load.
- If anvil crash-loops with "failed to parse json file", move the file aside instead of deleting the volume: `docker run --rm -v zal_anvil:/data alpine mv /data/anvil-state.json /data/anvil-state.json.corrupt-$(date +%Y%m%d)`, then `docker compose up -d --wait`. Anvil starts a fresh chain, the deploy job redeploys to the same addresses, and the indexer reindexes into a new schema because its schema name includes the chain's genesis hash. Off-chain tables (`zal_app`) survive, but their layouts refer to the old chain's canvases.
- Old `zal_index_*` schemas and `*.corrupt-*` files stay until you remove them (`docker compose down -v` removes everything).
