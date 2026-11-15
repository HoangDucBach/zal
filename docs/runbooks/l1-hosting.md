# Run Zal on the Zalax L1

Zal runs on the Zalax L1, the Fuji subnet "Zalax Payroll Chain" (chain id 102026, gas token ZAX). The whole stack runs on the L1 node's own EC2 host.

| What | Where |
|---|---|
| EC2 instance | `i-0f0d154a2d9e55447` (c6a.xlarge, us-east-1f), Elastic IP `100.63.191.30` |
| Public RPC | `https://rpc.100-63-191-30.sslip.io/ext/bc/L8z3EMtv6swD96pmVRsRLgYJR6iipDf8tSDe8vVnfqbHX7rxC/rpc` (WebSocket: same path, ending in `/ws`) |
| Web app | `https://app.100-63-191-30.sslip.io` |
| API and SSE | `https://api.100-63-191-30.sslip.io` |
| Node, relayer | Containers `avago` and `relayer`. The data lives in `~/.avalanchego` |
| TLS proxy | Container `caddy` (host network), using `~/caddy/Caddyfile`. The source copy is `deploy/l1/Caddyfile` |
| Zal stack | `~/zal`, run with `deploy/l1/docker-compose.yml`. Secrets are in `deploy/l1/.env` on the host only |

## What is public
- **Caddy routes.** Caddy passes only the Zal chain's `/rpc` and `/ws` paths to the node. `/ext/admin`, `/ext/info`, `/ext/keystore` and `/ext/health` answer 404.
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
  --broadcast --account zalax-admin --sender 0xb87886b6F7EaA40c6D827CEae78E11f5Cf750Dc7
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
