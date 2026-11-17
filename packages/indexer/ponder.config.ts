import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";

import {
  canvasAccountAbi,
  zusdcAbi,
  relationshipRegistryAbi,
  zalFactoryAbi,
  zalFundingPoolAbi,
  zalInvoiceAbi,
  zalVaultAbi,
} from "./abis/index.ts";
import { readDeployment } from "./lib/deployment.ts";

const { chainId, rpcUrl, startBlock, addresses } = readDeployment(process.env);

export default createConfig({
  database: { kind: "postgres", connectionString: process.env.DATABASE_URL },
  chains: {
    zal: {
      id: chainId,
      rpc: rpcUrl,
      pollingInterval: Number(process.env.ZAL_POLLING_INTERVAL_MS ?? 1_000),
      // A local anvil is reset at will, so cached blocks from an earlier chain with the same id would be wrong.
      cacheRpcRequests: chainId !== 31337,
    },
  },
  contracts: {
    ZalFactory: { chain: "zal", abi: zalFactoryAbi, address: addresses.factory, startBlock },
    // Every canvas is a clone the factory announces with AccountCreated.
    CanvasAccount: {
      chain: "zal",
      abi: canvasAccountAbi,
      address: factory({
        address: addresses.factory,
        event: getAbiItem({ abi: zalFactoryAbi, name: "AccountCreated" }),
        parameter: "account",
      }),
      startBlock,
    },
    RelationshipRegistry: {
      chain: "zal",
      abi: relationshipRegistryAbi,
      address: addresses.registry,
      startBlock,
    },
    ZalInvoice: { chain: "zal", abi: zalInvoiceAbi, address: addresses.invoices, startBlock },
    ZalFundingPool: { chain: "zal", abi: zalFundingPoolAbi, address: addresses.pool, startBlock },
    ZalVault: { chain: "zal", abi: zalVaultAbi, address: addresses.vault, startBlock },
    ZUSDC: { chain: "zal", abi: zusdcAbi, address: addresses.usdc, startBlock },
  },
  // The explorer reads every block from genesis, not just Zal's (docs/plans/explorer.md). Block events run after
  // the block's log events, so the explorer handler sees the Zal tables as of the end of the block.
  blocks: {
    Explorer: { chain: "zal", startBlock: 0, interval: 1 },
  },
});
