# Run Zal on the Zalax L1

Zal runs on the Zalax L1, the Fuji subnet "Zalax Payroll Chain" (chain id 102026, gas token ZAX). The whole stack runs on the L1 node's own EC2 host.

| What | Where |
|---|---|
| EC2 instance | `i-0f0d154a2d9e55447` (c6a.xlarge, us-east-1f), Elastic IP `100.63.191.30` |
| Public RPC | `https://rpc.100-63-191-30.sslip.io/ext/bc/L8z3EMtv6swD96pmVRsRLgYJR6iipDf8tSDe8vVnfqbHX7rxC/rpc` (WebSocket: same path, ending in `/ws`) |
| Web app | `https://app.100-63-191-30.sslip.io` |
| API and SSE | `https://api.100-63-191-30.sslip.io` |
| Keeper health and status | `https://keeper.100-63-191-30.sslip.io/health`, `/status` (GET only) |
| Node, relayer | Containers `avago` and `relayer`. The data lives in `~/.avalanchego` |
| TLS proxy | Container `caddy` (host network), using `~/caddy/Caddyfile`. The source copy is `deploy/l1/Caddyfile` |
| Zal stack | `~/zal`, run with `deploy/l1/docker-compose.yml`. Secrets are in `deploy/l1/.env` on the host only |

## Current deployment
Deployed on 15 Nov 2026 at block 24. The source of truth is `packages/contracts/deployments/l1.json`; the indexer mounts it and `gen:contracts` builds the web's addresses from it.

| Contract or wallet | Address |
|---|---|
| ZalFactory | `0xb6fB0bAE55C3B10A52AbFB12a954F9AD7ce10013` |
| CanvasAccount implementation | `0xb67FF575307699dDACd58F581b894C9C316b1EF6` |
| RelationshipRegistry | `0x5FE372365723AAA13F59a790fB09CFC17914a191` |
| ZalInvoice | `0xf95A169Fd0A5190F3661FFd8bcdE45f229f4D972` |
| ZalFundingPool | `0xdfaE31B5d0B46595220788A81821f669f63CF11c` |
| ZalVault | `0x7fF89d37623f70987485deec28ACC7a38bd73F78` |
| ZUSDC | `0x443B9429EA87faAE61c3cCb6b10477D6993E1c30` |
| Owner (keystore `zalax-admin`) | `0x9F7c870D0347989c2aB8c3a3263467874936208f` |
| Schedule keeper (gas only) | `0x5050931129c6dd089ba550354B5746a9b86Dd2f7` |
| Gas faucet | `0xc303d559a991fa0f0d6af475a57df7299dd6bedb` |

A wallet must use the public HTTPS RPC above for chain 102026. A network saved earlier with `http://100.63.191.30:9650/…` fails with "Failed to fetch", because port 9650 is closed to the internet.

## What is public
- **Caddy routes.** Caddy passes only the Zal chain's `/rpc` and `/ws` paths to the node. `/ext/admin`, `/ext/info`, `/ext/keystore` and `/ext/health` answer 404. For the keeper it passes only `GET /health` and `GET /status`; everything else answers 404.
- **Chain APIs.** The chain config enables `eth`, `eth-filter`, `net`, `web3`, `internal-eth`, `internal-blockchain` and `internal-transaction`. The `debug*` and `internal-account` namespaces are off.
- **Security group `sg-0eed73e8101132a42`.**
  - Ports 80 and 443 are open to everyone (ACME and HTTPS).
  - Port 9651 is open to everyone (P2P).
  - Port 9650 is open to two operator IPs only.
  - Port 22 is still open to everyone. Restrict it.
- **TxAllowList.** It is disabled through `~/.avalanchego/configs/chains/<blockchainID>/upgrade.json` (precompile upgrade, `disable: true`, timestamp 1794716999). Anyone can transact; gas is the only brake. Re-enabling needs a new precompile upgrade with a later timestamp.

## Deploy the contracts (once per chain)
The broadcast needs the keystore password, so the owner runs it:

```
cd packages/contracts
ZAL_NETWORK=l1 forge script script/Deploy.s.sol \
  --rpc-url https://rpc.100-63-191-30.sslip.io/ext/bc/L8z3EMtv6swD96pmVRsRLgYJR6iipDf8tSDe8vVnfqbHX7rxC/rpc \
  --broadcast --account zalax-admin --sender 0x9F7c870D0347989c2aB8c3a3263467874936208f
```

The script refuses any chain other than 102026. Then:
1. Run `pnpm --filter @zal/web gen:contracts`.
2. Commit `deployments/l1.json` and the regenerated `packages/web/contracts/*`.

## Ship or update the stack
From the repository root, on a machine with SSH access:

```
git ls-files -co --exclude-standard | grep -v '^packages/contracts/lib' > /tmp/zal-files
rsync -az --files-from=/tmp/zal-files -e "ssh -i <key>" ./ ubuntu@100.63.191.30:zal/
ssh -i <key> ubuntu@100.63.191.30 'cd ~/zal && docker compose -f deploy/l1/docker-compose.yml --env-file deploy/l1/.env up -d --build --wait'
```

The web image inlines the chain, RPC and API URLs and the contract addresses at build time. Rebuild it after any of these changes.

`deploy/l1/.env` is created once on the host and never leaves it. It holds:
- `POSTGRES_PASSWORD`, generated with `openssl rand -hex 24`.
- `ZAL_KEEPER_PRIVATE_KEY`, the schedule keeper's key (see Keeper). Compose refuses to start without it.
- `ZAL_FAUCET_PRIVATE_KEY`, the gas faucet's key (see Faucet). Optional `ZAL_FAUCET_DRIP_WEI` and `ZAL_FAUCET_MIN_BALANCE_WEI` override the drip (0.05 ZAX) and the threshold (0.01 ZAX).

## Node config pitfalls
- Avalanchego reads every file that matches `config.*` (and `upgrade.*`) in a chain config directory, and stops with "too many files matched" if there is more than one. Keep backups in `~/zal-backups`, never next to the live file.
- The node finds its public IP through OpenDNS. After an IP change, restart `avago` (`docker restart avago`).

## Faucet
A new wallet holds no ZAX, so it cannot pay gas to mint zUSDC or create its canvas. `POST /v1/faucet` (body `{ "wallet": "0x…" }`) sends it 0.05 ZAX from a dedicated faucet wallet. The API refuses a wallet that already holds 0.01 ZAX or more, and gives one drip per wallet and five per IP in 24 hours. The web shows a "Get gas" button in Deposit while the wallet is below that minimum. `GET /v1/faucet` shows whether the faucet is on, its address and its balance.

Set it up once, on the host:

```
cd ~/zal
echo "ZAL_FAUCET_PRIVATE_KEY=0x$(openssl rand -hex 32)" >> deploy/l1/.env
chmod 600 deploy/l1/.env
cast wallet address --private-key "$(grep ^ZAL_FAUCET_PRIVATE_KEY= deploy/l1/.env | cut -d= -f2)"
```

The last command prints the faucet's address. The admin funds it once from their own machine:

```
cast send <faucet address> --value 100ether \
  --rpc-url https://rpc.100-63-191-30.sslip.io/ext/bc/L8z3EMtv6swD96pmVRsRLgYJR6iipDf8tSDe8vVnfqbHX7rxC/rpc \
  --account zalax-admin
```

Then recreate the indexer (`docker compose -f deploy/l1/docker-compose.yml --env-file deploy/l1/.env up -d indexer`). Top it up the same way when `faucetBalanceWei` in `GET /v1/faucet` runs low. The key never leaves `deploy/l1/.env`, and the API never logs or returns it. Without the key, `POST /v1/faucet` answers 503.

## Keeper
Scheduled payments live in each `CanvasAccount` (ADR 0015). `runSchedule(id)` is permissionless, so the keeper only triggers runs that are due. Every `KEEPER_TICK_MS` (10 s by default) it reads `GET /v1/schedules/due` from the indexer on the compose network, simulates each run at the next block's time, and sends `runSchedule` from its own wallet, one transaction at a time. A run that would revert, for example on an empty balance, is skipped and retried with exponential backoff (15 s doubling to 10 min). The wallet pays gas only. It holds no authority over funds, and the chain's `nextAt` refuses a second run, so a keeper outage makes payments late but never lost or doubled.

Set it up once, on the host:

```
cd ~/zal
echo "ZAL_KEEPER_PRIVATE_KEY=0x$(openssl rand -hex 32)" >> deploy/l1/.env
chmod 600 deploy/l1/.env
cast wallet address --private-key "$(grep ^ZAL_KEEPER_PRIVATE_KEY= deploy/l1/.env | cut -d= -f2)"
```

The admin funds the printed address with a little ZAX from their own machine. One run costs well under 0.01 ZAX at the chain's gas price, so 5 ZAX lasts a long time:

```
cast send <keeper address> --value 5ether \
  --rpc-url https://rpc.100-63-191-30.sslip.io/ext/bc/L8z3EMtv6swD96pmVRsRLgYJR6iipDf8tSDe8vVnfqbHX7rxC/rpc \
  --account zalax-admin
```

Then start it: `docker compose -f deploy/l1/docker-compose.yml --env-file deploy/l1/.env up -d --build --wait keeper`. Copy `deploy/l1/Caddyfile` to `~/caddy/Caddyfile` and reload Caddy (`docker exec caddy caddy reload --config /etc/caddy/Caddyfile`) to publish `keeper.100-63-191-30.sslip.io`.

- `GET /health` reports `ok`, the keeper address, `gasBalanceWei`, the last tick and counts. It answers 503 when no tick has finished in the last 3 ticks plus a minute. Top the wallet up when `gasBalanceWei` runs low.
- `GET /status` lists the last 100 runs (with transaction hashes) and the last 100 failures (with the revert reason and the retry time).
- `docker compose -f deploy/l1/docker-compose.yml logs keeper` prints one JSON line per run (`ran`) and per failure (`run_failed`). The key is never logged or returned.
