import { http, type Transport } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

import { liveNetwork, sandboxChain } from "@/config/chains";
import { sandboxConnector } from "@/lib/sandbox/connector";
import { sandboxTransport } from "@/lib/sandbox/transport";

const liveChains =
  liveNetwork.status === "ready"
    ? ([liveNetwork.chain] as const)
    : ([] as const);
const liveTransports: Record<number, Transport> =
  liveNetwork.status === "ready" ? { [liveNetwork.chain.id]: http() } : {};

/**
 * The visitor connects a real wallet (`injected`). Turning the sandbox on connects the sandbox connector as well,
 * which reports that same address and sends its transactions to the in-browser chain without a signing prompt.
 */
export const wagmiConfig = createConfig({
  chains: [sandboxChain, ...liveChains],
  connectors: [injected(), sandboxConnector()],
  multiInjectedProviderDiscovery: false,
  transports: { [sandboxChain.id]: sandboxTransport(), ...liveTransports },
  pollingInterval: 1_000,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
