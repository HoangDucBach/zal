import { defineChain, type Address, type Chain } from "viem";

import { env } from "@/config/env";
import { deployments } from "@/contracts/deployments";
import { SANDBOX_CHAIN_ID, sandboxDeployment } from "@/lib/sandbox/config";

/** The protocol addresses one network runs. */
export interface ZalAddresses {
  readonly usdc: Address;
  readonly factory: Address;
  readonly registry: Address;
  readonly invoices: Address;
  readonly pool: Address;
  readonly vault: Address;
}

export interface ZalNetwork {
  readonly kind: "live" | "sandbox";
  readonly chain: Chain;
  readonly addresses: ZalAddresses;
}

export const sandboxChain = defineChain({
  id: SANDBOX_CHAIN_ID,
  name: "Zal Sandbox",
  nativeCurrency: { name: "Sandbox gas", symbol: "SBX", decimals: 18 },
  // Never fetched: the sandbox transport answers every request in the browser.
  rpcUrls: { default: { http: ["http://sandbox.invalid"] } },
  testnet: true,
});

export const sandboxNetwork: ZalNetwork = {
  kind: "sandbox",
  chain: sandboxChain,
  addresses: sandboxDeployment,
};

export type LiveNetwork =
  | ({ readonly status: "ready" } & ZalNetwork)
  | { readonly status: "unavailable"; readonly reason: string };

function resolveLive(): LiveNetwork {
  const { l1ChainId, l1Rpc } = env;

  if (l1ChainId === undefined || l1Rpc === undefined) {
    return {
      status: "unavailable",
      reason:
        "The Zal L1 is not configured yet. Set NEXT_PUBLIC_ZAL_CHAIN_ID and NEXT_PUBLIC_ZAL_RPC_URL.",
    };
  }
  const deployment = (deployments as Record<string, ZalAddresses | undefined>)[
    String(l1ChainId)
  ];

  if (deployment === undefined) {
    return {
      status: "unavailable",
      reason: `No deployment for chain ${l1ChainId} in packages/contracts/deployments. Deploy, then run gen:contracts.`,
    };
  }

  return {
    status: "ready",
    kind: "live",
    chain: defineChain({
      id: l1ChainId,
      name: env.l1Name,
      nativeCurrency: {
        name: env.l1NativeSymbol,
        symbol: env.l1NativeSymbol,
        decimals: 18,
      },
      rpcUrls: { default: { http: [l1Rpc] } },
      ...(env.l1Explorer === undefined
        ? {}
        : {
            blockExplorers: {
              default: { name: "Explorer", url: env.l1Explorer },
            },
          }),
    }),
    addresses: {
      usdc: deployment.usdc,
      factory: deployment.factory,
      registry: deployment.registry,
      invoices: deployment.invoices,
      pool: deployment.pool,
      vault: deployment.vault,
    },
  };
}

export const liveNetwork: LiveNetwork = resolveLive();
