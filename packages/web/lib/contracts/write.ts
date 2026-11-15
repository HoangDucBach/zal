import type { Hash, TransactionReceipt } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type { MutationProps, MutationResult } from "@/lib/query/types";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConfig, type Config } from "wagmi";
import {
  getConnection,
  switchChain,
  waitForTransactionReceipt,
} from "wagmi/actions";

import { apiUrl, waitForIndexed } from "@/lib/api/client";
import { ContractError, toAppError, type AppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";

export interface WriteResult {
  readonly hash: Hash;
  readonly receipt: TransactionReceipt;
}

/** Live only: the sandbox connector never leaves the sandbox chain. */
export async function ensureChain(
  config: Config,
  chainId: number,
): Promise<void> {
  if (getConnection(config).chainId !== chainId)
    await switchChain(config, { chainId: chainId as never });
}

interface ContractMutationParams<TPayload> extends MutationProps<
  WriteResult,
  TPayload
> {
  readonly network: ZalNetwork | undefined;
  /**
   * Simulates the call, then sends it, and returns the transaction hash. Simulating first turns a revert into an
   * error before the wallet asks the user to sign.
   */
  readonly send: (
    payload: TPayload,
    config: Config,
    network: ZalNetwork,
  ) => Promise<Hash>;
}

/**
 * Shared body of every contract write: switch chain (live), send, wait for the receipt, throw on a reverted
 * receipt, then invalidate every read on that chain. Event watching (useZalEvents) refreshes the other canvas.
 */
export function useContractMutation<TPayload>({
  network,
  send,
  options,
}: ContractMutationParams<TPayload>): MutationResult<WriteResult, TPayload> {
  const config = useConfig();
  const queryClient = useQueryClient();

  return useMutation<WriteResult, AppError, TPayload>({
    ...options,
    mutationFn: async (payload) => {
      try {
        if (network === undefined)
          throw new ContractError(
            "No network: connect to the Zal L1 or turn on the sandbox.",
            undefined,
          );
        const chainId = network.chain.id;

        if (network.kind === "live") await ensureChain(config, chainId);
        const hash = await send(payload, config, network);
        const receipt = await waitForTransactionReceipt(config, {
          chainId: chainId as never,
          hash,
        });

        if (receipt.status === "reverted")
          throw new ContractError(`Transaction ${hash} reverted.`, undefined);
        // Live reads come from the indexer, which trails the chain by a poll.
        if (network.kind === "live" && apiUrl !== undefined)
          await waitForIndexed(receipt.blockNumber);
        await queryClient.invalidateQueries({
          queryKey: queryKeys.chain(chainId),
        });

        return { hash, receipt };
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
}

interface CallParams {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args: readonly unknown[];
}

/** Simulate as the connected account, then send the simulated request. */
export async function simulateAndWrite(
  config: Config,
  network: ZalNetwork,
  call: CallParams,
): Promise<Hash> {
  const { simulateContract, writeContract } = await import("wagmi/actions");
  const account = getConnection(config).address;
  // wagmi infers argument types from a literal ABI; the per-contract hooks keep those types at their own call sites.
  const { request } = await simulateContract(config, {
    chainId: network.chain.id,
    account,
    ...call,
  } as never);

  return writeContract(config, request as never);
}
