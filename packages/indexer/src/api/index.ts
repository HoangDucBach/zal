// Ponder's API entry: the /v1 routes on Ponder's Hono server, reading Ponder's tables and the chain, writing
// zal_app. Ponder itself serves /health, /ready, /status and /metrics.

import { getConnInfo } from "@hono/node-server/conninfo";
import { publicClients } from "ponder:api";
import { getAddress } from "viem";

import { canvasAccountAbi, relationshipRegistryAbi, zalFactoryAbi } from "../../abis/index.ts";
import { createAppDb } from "../../lib/app-db/client.ts";
import { createApp } from "../../lib/app.ts";
import { config } from "./config.ts";
import { readAsOf, readCanvasRows, readFeedPage, readLp, readPool, readWalletAccounts } from "./read.ts";
import { streamFeed } from "./stream.ts";

const client = publicClients.zal;
const { db: appDb } = createAppDb(config.databaseUrl);

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
