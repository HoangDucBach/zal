import type { PublicClient } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type { QueryProps, QueryResult } from "@/lib/query/types";

import { useQuery, type QueryKey } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";

import { toAppError, type AppError } from "@/lib/query/errors";

interface ChainQueryParams<TData> {
  readonly network: ZalNetwork;
  readonly queryKey: QueryKey;
  readonly read: (client: PublicClient, network: ZalNetwork) => Promise<TData>;
  readonly options?: QueryProps<void, TData>["options"];
}

/** Shared body of every contract read: the network's public client, errors mapped to AppError. */
export function useChainQuery<TData>({
  network,
  queryKey,
  read,
  options,
}: ChainQueryParams<TData>): QueryResult<TData> {
  const config = useConfig();

  return useQuery<TData, AppError>({
    ...options,
    queryKey,
    queryFn: async () => {
      try {
        const client = getPublicClient(config, {
          chainId: network.chain.id as never,
        }) as PublicClient | undefined;

        if (client === undefined)
          throw new Error(`No client for chain ${network.chain.id}.`);

        return await read(client, network);
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
}
