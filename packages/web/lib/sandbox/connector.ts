// A wagmi connector whose EIP-1193 provider is the sandbox. It reports the address of the wallet the visitor
// connected and applies `eth_sendTransaction` straight to the in-browser chain as that address, so the sandbox
// asks for no signatures.

import {
  getAddress,
  isAddress,
  isHex,
  numberToHex,
  SwitchChainError,
  UserRejectedRequestError,
  type Address,
  type EIP1193Parameters,
  type Hex,
} from "viem";
import { ChainNotConfiguredError, createConnector } from "wagmi";
import { z } from "zod";

import { SANDBOX_CHAIN_ID } from "./config";
import { getSandboxMode } from "./mode";
import { loadRuntime } from "./runtime-loader";

export const SANDBOX_CONNECTOR_ID = "zalSandbox";

const address = z.custom<Address>(
  (v) => typeof v === "string" && isAddress(v, { strict: false }),
);
const hex = z.custom<Hex>((v) => typeof v === "string" && isHex(v));
const sendSchema = z.tuple([
  z.object({
    from: address.optional(),
    to: address.optional(),
    data: hex.optional(),
  }),
]);

export interface SandboxProvider {
  readonly request: (args: EIP1193Parameters) => Promise<unknown>;
}

function impersonated(): Address {
  const mode = getSandboxMode();

  if (!mode.enabled)
    throw new UserRejectedRequestError(new Error("Sandbox mode is off."));

  return mode.account;
}

const provider: SandboxProvider = {
  async request({ method, params }: EIP1193Parameters): Promise<unknown> {
    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return [impersonated()];
      case "eth_chainId":
        return numberToHex(SANDBOX_CHAIN_ID);
      case "wallet_switchEthereumChain":
        throw new SwitchChainError(
          new Error("The sandbox wallet stays on the sandbox chain."),
        );
      case "eth_sendTransaction": {
        const [tx] = sendSchema.parse(params);
        const runtime = await loadRuntime();

        return runtime.sendTransaction({
          from: tx.from === undefined ? impersonated() : getAddress(tx.from),
          ...(tx.to === undefined ? {} : { to: getAddress(tx.to) }),
          data: tx.data ?? "0x",
        });
      }
      case "personal_sign":
      case "eth_sign":
      case "eth_signTypedData_v4":
        throw new UserRejectedRequestError(
          new Error("The sandbox wallet does not sign messages."),
        );
      default: {
        const runtime = await loadRuntime();

        return runtime.request(method, params);
      }
    }
  },
};

export function sandboxConnector() {
  return createConnector<SandboxProvider>((config) => ({
    id: SANDBOX_CONNECTOR_ID,
    name: "Zal Sandbox",
    type: "sandbox",
    async connect({ chainId } = {}) {
      if (chainId !== undefined && chainId !== SANDBOX_CHAIN_ID) {
        throw new SwitchChainError(new ChainNotConfiguredError());
      }
      // wagmi types `accounts` by the `withCapabilities` flag; its own connectors widen here the same way.
      const accounts: readonly Address[] = [impersonated()];

      return { accounts: accounts as never, chainId: SANDBOX_CHAIN_ID };
    },
    async disconnect() {},
    async getAccounts() {
      return [impersonated()];
    },
    async getChainId() {
      return SANDBOX_CHAIN_ID;
    },
    async getProvider() {
      return provider;
    },
    async isAuthorized() {
      return getSandboxMode().enabled;
    },
    async switchChain({ chainId }) {
      const chain = config.chains.find((c) => c.id === chainId);

      if (chain === undefined || chainId !== SANDBOX_CHAIN_ID) {
        throw new SwitchChainError(new ChainNotConfiguredError());
      }

      return chain;
    },
    onAccountsChanged() {},
    onChainChanged(chainId) {
      config.emitter.emit("change", { chainId: Number(chainId) });
    },
    onDisconnect() {
      config.emitter.emit("disconnect");
    },
  }));
}
