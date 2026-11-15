"use client";

import type { ZalNetwork } from "@/config/chains";
import type { MutationProps, QueryProps, QueryResult } from "@/lib/query/types";

import { isAddressEqual, zeroHash, type Address } from "viem";

import { zalFactoryAbi } from "@/contracts/abis";
import { accountOfWallet } from "@/lib/contracts/canvas-reads";
import { signerIdentity } from "@/lib/contracts/identity";
import { useChainQuery } from "@/lib/contracts/read";
import {
  simulateAndWrite,
  useContractMutation,
  type WriteResult,
} from "@/lib/contracts/write";
import { queryKeys } from "@/lib/query/keys";

export interface WalletPayload {
  readonly network: ZalNetwork;
  readonly wallet: Address;
}

export interface CanvasAccountRef {
  readonly account: Address;
  readonly exists: boolean;
}

/** The wallet's canvas: the account `predictAccount(wallet, 0)`, and whether it has been created. */
export function useCanvasAccountOf({
  payload,
  options,
}: QueryProps<WalletPayload, CanvasAccountRef>): QueryResult<CanvasAccountRef> {
  return useChainQuery({
    network: payload.network,
    queryKey: queryKeys.accountOf(payload.network.chain.id, payload.wallet),
    read: (client, network) =>
      accountOfWallet(client, network.addresses, payload.wallet),
    options,
  });
}

/**
 * Creates the signer's canvas: one CanvasAccount clone with the connected wallet as its first Admin (ZR-ACC-01).
 * It takes no address, so the Admin is always the wallet that signs.
 */
export function useCreateAccount({
  network,
  options,
}: MutationProps<WriteResult, void> & {
  readonly network: ZalNetwork | undefined;
}) {
  return useContractMutation<void>({
    network,
    options,
    send: async (_, config, net) =>
      simulateAndWrite(config, net, {
        address: net.addresses.factory,
        abi: zalFactoryAbi,
        functionName: "createAccount",
        args: [(await signerIdentity(config, net)).wallet, zeroHash],
      }),
  });
}

/** What a pasted counterparty address is, checked before proposing so the call never reverts with NotAccount. */
export type CounterpartyCheck =
  | { readonly kind: "canvas" }
  /** Your own canvas, or the wallet that owns it. */
  | { readonly kind: "self" }
  /** A wallet that has a canvas: propose to that canvas instead. */
  | { readonly kind: "wallet"; readonly canvas: Address }
  | { readonly kind: "not-canvas" };

export interface CounterpartyPayload {
  readonly network: ZalNetwork;
  readonly address: Address;
  /** The visitor's own canvas. */
  readonly self: Address;
}

export function useCounterpartyCheck({
  payload,
  options,
}: QueryProps<
  CounterpartyPayload,
  CounterpartyCheck
>): QueryResult<CounterpartyCheck> {
  const { network, address, self } = payload;

  return useChainQuery({
    network,
    queryKey: [
      ...queryKeys.accountOf(network.chain.id, address),
      "counterparty",
      self.toLowerCase(),
    ],
    read: async (client, net): Promise<CounterpartyCheck> => {
      if (isAddressEqual(address, self)) return { kind: "self" };
      const isAccount = await client.readContract({
        address: net.addresses.factory,
        abi: zalFactoryAbi,
        functionName: "isAccount",
        args: [address],
      });

      if (isAccount) return { kind: "canvas" };
      const { account, exists } = await accountOfWallet(
        client,
        net.addresses,
        address,
      );

      if (!exists) return { kind: "not-canvas" };

      return isAddressEqual(account, self)
        ? { kind: "self" }
        : { kind: "wallet", canvas: account };
    },
    options,
  });
}
