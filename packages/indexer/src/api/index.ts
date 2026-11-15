// Ponder's API entry: the /v1 routes on Ponder's Hono server, reading Ponder's tables and the chain, writing
// zal_app. Ponder itself serves /health, /ready, /status and /metrics.

import { getConnInfo } from "@hono/node-server/conninfo";
import { publicClients } from "ponder:api";
import { createWalletClient, getAddress, http } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";

import { canvasAccountAbi, relationshipRegistryAbi, zalFactoryAbi } from "../../abis/index.ts";
import { createAppDb } from "../../lib/app-db/client.ts";
import { createApp } from "../../lib/app.ts";
import { type Faucet } from "../../lib/faucet.ts";
import { config } from "./config.ts";
import { readAsOf, readCanvasRows, readFeedPage, readLp, readPool, readWalletAccounts } from "./read.ts";
import { streamFeed } from "./stream.ts";

const client = publicClients.zal;
const { db: appDb } = createAppDb(config.databaseUrl);

function createFaucet(): Faucet | undefined {
  const { privateKey, dripWei, minBalanceWei } = config.faucet;
  if (privateKey === undefined) return undefined;
  // The nonce manager counts this process's pending transfers, so a drip sent before the last one is mined still
  // takes the next nonce.
  const account = privateKeyToAccount(privateKey, { nonceManager });
  const wallet = createWalletClient({ account, transport: http(config.rpcUrl) });
  return {
    address: account.address,
    dripWei,
    minBalanceWei,
    balanceOf: (address) => client.getBalance({ address }),
    send: (to, value) => wallet.sendTransaction({ to, value, chain: null }),
  };
}

export default createApp({
  config: {
    chainId: config.chainId,
    webOrigins: config.webOrigins,
    registry: config.addresses.registry,
    sessionTtlSeconds: config.sessionTtlSeconds,
    nonceTtlSeconds: config.nonceTtlSeconds,
  },
  appDb,
  asOf: readAsOf,
  canvasRows: readCanvasRows,
  feedPage: readFeedPage,
  walletAccounts: readWalletAccounts,
  pool: readPool,
  lp: readLp,
  async roleOf(account, wallet) {
    const isAccount = await client.readContract({
      address: config.addresses.factory,
      abi: zalFactoryAbi,
      functionName: "isAccount",
      args: [account],
    });
    if (!isAccount) return 0;
    return client.readContract({ address: account, abi: canvasAccountAbi, functionName: "roleOf", args: [wallet] });
  },
  inviteNonceUsed: (proposer, nonce) =>
    client.readContract({
      address: config.addresses.registry,
      abi: relationshipRegistryAbi,
      functionName: "inviteNonceUsed",
      args: [proposer, nonce],
    }),
  verifyMessage: ({ address, message, signature }) =>
    client.verifyMessage({ address: getAddress(address), message, signature }),
  stream: streamFeed,
  faucet: createFaucet(),
  clientIp(c) {
    if (config.trustProxy) {
      // The proxy appends the address it saw; entries to its left are whatever the client sent.
      const forwarded = c.req.header("X-Forwarded-For")?.split(",").at(-1)?.trim();
      if (forwarded !== undefined && forwarded !== "") return forwarded;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  },
});
