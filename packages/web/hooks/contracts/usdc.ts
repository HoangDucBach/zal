"use client";

import type { Address } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type { MutationProps, QueryProps, QueryResult } from "@/lib/query/types";

import { zusdcAbi } from "@/contracts/abis";
import { useSelectedAccount } from "@/hooks/use-selected-account";
import { signerIdentity, type TrustedIdentity } from "@/lib/contracts/identity";
import { useChainQuery } from "@/lib/contracts/read";
import {
  simulateAndWrite,
  useContractMutation,
  type WriteResult,
} from "@/lib/contracts/write";
import { queryKeys } from "@/lib/query/keys";

export interface HolderPayload {
  readonly network: ZalNetwork;
  readonly holder: Address;
}

/** zUSDC (testnet) balance in base units, 6 decimals. */
export function useUsdcBalance({
  payload,
  options,
}: QueryProps<HolderPayload, bigint>): QueryResult<bigint> {
  return useChainQuery({
    network: payload.network,
    queryKey: queryKeys.balance(payload.network.chain.id, payload.holder),
    read: (client, network) =>
      client.readContract({
        address: network.addresses.usdc,
        abi: zusdcAbi,
        functionName: "balanceOf",
        args: [payload.holder],
      }),
    options,
  });
}

export interface MintPayload {
  /** The signer's wallet or its canvas: the faucet never mints to an address the caller passes. */
  readonly to: keyof Pick<TrustedIdentity, "wallet" | "account">;
  readonly amount: bigint;
}

/** zUSDC has an open faucet: anyone can mint testnet dollars to any address. The app mints only to the signer or the canvas it verified. */
export function useMintTestUsdc({
  network,
  options,
}: MutationProps<WriteResult, MintPayload> & {
  readonly network: ZalNetwork | undefined;
}) {
  const selected = useSelectedAccount();

  return useContractMutation<MintPayload>({
    network,
    options,
    send: async ({ to, amount }, config, net) =>
      simulateAndWrite(config, net, {
        address: net.addresses.usdc,
        abi: zusdcAbi,
        functionName: "mint",
        args: [(await signerIdentity(config, net, selected))[to], amount],
      }),
  });
}
