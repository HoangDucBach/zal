"use client";

import type { ZalNetwork } from "@/config/chains";
import type { MutationProps, QueryProps, QueryResult } from "@/lib/query/types";

import { waitForTransactionReceipt } from "wagmi/actions";

import { zusdcAbi, zalFundingPoolAbi } from "@/contracts/abis";
import { signerIdentity } from "@/lib/contracts/identity";
import { useChainQuery } from "@/lib/contracts/read";
import {
  simulateAndWrite,
  useContractMutation,
  type WriteResult,
} from "@/lib/contracts/write";
import { queryKeys } from "@/lib/query/keys";

export interface QuotePayload {
  readonly network: ZalNetwork;
  readonly faceValue: bigint;
  readonly dueDate: number;
}

export interface AdvanceQuote {
  readonly principal: bigint;
  readonly fee: bigint;
  /** What the seller receives later through its Split, once the buyer pays. */
  readonly reserve: bigint;
}

/** What `advance` would pay now for an invoice: principal at the advance rate and the fee, fixed at advance time. */
export function useAdvanceQuote({
  payload,
  options,
}: QueryProps<QuotePayload, AdvanceQuote>): QueryResult<AdvanceQuote> {
  return useChainQuery({
    network: payload.network,
    queryKey: [
      ...queryKeys.pool(payload.network.chain.id),
      "quote",
      String(payload.faceValue),
      payload.dueDate,
    ],
    read: async (client, network) => {
      const [principal, fee] = await client.readContract({
        address: network.addresses.pool,
        abi: zalFundingPoolAbi,
        functionName: "quote",
        args: [payload.faceValue, BigInt(payload.dueDate)],
      });

      return { principal, fee, reserve: payload.faceValue - principal - fee };
    },
    options,
  });
}

interface LpProps<TPayload> extends MutationProps<WriteResult, TPayload> {
  readonly network: ZalNetwork | undefined;
}

/** The shares always go to the wallet that signs and pays, never to an address the caller passes. */
export interface LpDepositPayload {
  readonly amount: bigint;
  /** What the wallet already lets the pool pull. Below `amount`, the deposit first approves exactly `amount`. */
  readonly allowance: bigint;
}

/** Deposits testnet zUSDC from the connected wallet into the funding pool and mints LP shares to it. */
export function useLpDeposit({ network, options }: LpProps<LpDepositPayload>) {
  return useContractMutation<LpDepositPayload>({
    network,
    options,
    send: async ({ amount, allowance }, config, net) => {
      const { wallet } = await signerIdentity(config, net);

      if (allowance < amount) {
        const hash = await simulateAndWrite(config, net, {
          address: net.addresses.usdc,
          abi: zusdcAbi,
          functionName: "approve",
          args: [net.addresses.pool, amount],
        });

        await waitForTransactionReceipt(config, {
          chainId: net.chain.id as never,
          hash,
        });
      }

      return simulateAndWrite(config, net, {
        address: net.addresses.pool,
        abi: zalFundingPoolAbi,
        functionName: "deposit",
        args: [amount, wallet],
      });
    },
  });
}

/** Withdraws the signer's own shares, to the signer. */
export interface LpWithdrawPayload {
  readonly amount: bigint;
}

/** Withdraws USDC back to the wallet, up to the pool's idle cash (ZR-FND-05). */
export function useLpWithdraw({
  network,
  options,
}: LpProps<LpWithdrawPayload>) {
  return useContractMutation<LpWithdrawPayload>({
    network,
    options,
    send: async ({ amount }, config, net) => {
      const { wallet } = await signerIdentity(config, net);

      return simulateAndWrite(config, net, {
        address: net.addresses.pool,
        abi: zalFundingPoolAbi,
        functionName: "withdraw",
        args: [amount, wallet, wallet],
      });
    },
  });
}
