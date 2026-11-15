"use client";

// A pending op and the invoice it acts on, read from the chain, so Confirm and the panel around it show what the chain
// holds, not what the API says.

import type { Address, PublicClient } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type { Invoice } from "@/lib/canvas/types";
import type { QueryResult } from "@/lib/query/types";

import { useQuery } from "@tanstack/react-query";
import { useConfig, type Config } from "wagmi";
import { getPublicClient } from "wagmi/actions";

import {
  readChainInvoice,
  readChainOp,
  type ChainOp,
  type ChainVerified,
} from "@/lib/contracts/chain-verified";
import { toAppError, type AppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";

export interface ChainOpPayload {
  readonly network: ZalNetwork;
  /** The canvas the snapshot verified on the chain (`CanvasSnapshot.access`). */
  readonly account: Address;
  readonly wallet: Address;
  readonly opId: bigint;
}

async function chainRead<T>(
  config: Config,
  network: ZalNetwork,
  read: (client: PublicClient) => Promise<T>,
): Promise<T> {
  try {
    const client = getPublicClient(config, {
      chainId: network.chain.id as never,
    }) as PublicClient | undefined;

    if (client === undefined)
      throw new Error(`No client for chain ${network.chain.id}.`);

    return await read(client);
  } catch (error) {
    throw toAppError(error);
  }
}

/** `null` when the account stores no op with this id. Refreshed with every read of the account. */
export function useChainOp({
  payload,
}: {
  readonly payload: ChainOpPayload;
}): QueryResult<ChainVerified<ChainOp> | null> {
  const config = useConfig();
  const { network, account, wallet, opId } = payload;

  return useQuery<ChainVerified<ChainOp> | null, AppError>({
    queryKey: [
      ...queryKeys.account(network.chain.id, account),
      "op",
      String(opId),
      wallet.toLowerCase(),
    ],
    queryFn: () =>
      chainRead(
        config,
        network,
        async (client) =>
          (await readChainOp(
            client,
            network.addresses,
            account,
            opId,
            wallet,
          )) ?? null,
      ),
  });
}

/** One invoice as `ZalInvoice` stores it, with `ownerOf` as the payment recipient. */
export function useChainInvoice({
  payload,
}: {
  readonly payload: { readonly network: ZalNetwork; readonly id: bigint };
}): QueryResult<ChainVerified<Invoice>> {
  const config = useConfig();
  const { network, id } = payload;

  return useQuery<ChainVerified<Invoice>, AppError>({
    queryKey: [...queryKeys.invoice(network.chain.id, id), "chain"],
    queryFn: () =>
      chainRead(config, network, (client) =>
        readChainInvoice(client, network.addresses, id),
      ),
  });
}
