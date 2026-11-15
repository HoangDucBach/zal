"use client";

import type { Address } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type { FaucetStatus } from "@/lib/api/wire";
import type {
  MutationProps,
  MutationResult,
  QueryProps,
  QueryResult,
} from "@/lib/query/types";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

import { api, apiUrl } from "@/lib/api/client";
import { useChainQuery } from "@/lib/contracts/read";
import { toAppError, type AppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";

/** The native gas token an address holds, in wei. */
export function useNativeBalance({
  payload,
  options,
}: QueryProps<
  { readonly network: ZalNetwork; readonly holder: Address },
  bigint
>): QueryResult<bigint> {
  return useChainQuery({
    network: payload.network,
    queryKey: queryKeys.nativeBalance(payload.network.chain.id, payload.holder),
    read: (client) => client.getBalance({ address: payload.holder }),
    options,
  });
}

/** The API's gas faucet. Disabled without an API, so the sandbox and chain-only builds never ask. */
export function useGasFaucet({
  payload,
}: {
  readonly payload: { readonly network: ZalNetwork };
}): QueryResult<FaucetStatus> {
  const { network } = payload;

  return useQuery<FaucetStatus, AppError>({
    enabled: network.kind === "live" && apiUrl !== undefined,
    queryKey: queryKeys.faucet(network.chain.id),
    queryFn: async ({ signal }) => {
      try {
        return await api.faucet(signal);
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
}

/** Asks the faucet for gas, waits until the transfer is mined, then rereads the wallet's balance. */
export function useDripGas({
  network,
  options,
}: MutationProps<void, Address> & {
  readonly network: ZalNetwork;
}): MutationResult<void, Address> {
  const config = useConfig();
  const queryClient = useQueryClient();

  return useMutation<void, AppError, Address>({
    ...options,
    mutationFn: async (wallet) => {
      try {
        const { txHash } = await api.drip(wallet);

        await waitForTransactionReceipt(config, {
          hash: txHash,
          chainId: network.chain.id as never,
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.nativeBalance(network.chain.id, wallet),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.faucet(network.chain.id),
        });
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
}
