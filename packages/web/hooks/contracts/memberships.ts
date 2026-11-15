"use client";

// The canvases the connected wallet may open, for the sidebar switcher: its own canvas, then one page at a time of the
// others, each page verified on the chain before it is shown (lib/contracts/memberships.ts).

import type { Address, PublicClient } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type { QueryResult } from "@/lib/query/types";

import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { useConfig, type Config } from "wagmi";
import { getPublicClient } from "wagmi/actions";

import { api, apiUrl } from "@/lib/api/client";
import {
  chainCandidatePage,
  readOwnCanvas,
  verifyCandidates,
  type CandidatePage,
  type Membership,
  type MembershipGroup,
  type MembershipPage,
} from "@/lib/contracts/memberships";
import { ApiError, toAppError, type AppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";

function clientFor(config: Config, network: ZalNetwork): PublicClient {
  const client = getPublicClient(config, {
    chainId: network.chain.id as never,
  }) as PublicClient | undefined;

  if (client === undefined)
    throw new Error(`No client for chain ${network.chain.id}.`);

  return client;
}

async function candidatePage(
  client: PublicClient,
  network: ZalNetwork,
  wallet: Address,
  group: MembershipGroup,
  query: string | undefined,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<CandidatePage> {
  if (
    network.kind === "live" &&
    apiUrl !== undefined &&
    cursor?.startsWith("chain:") !== true
  ) {
    try {
      const page = await api.walletAccounts(
        wallet,
        { cursor, acted: group === "acted", q: query },
        signal,
      );

      return {
        accounts: page.accounts.map((a) => a.address),
        next: page.nextCursor ?? undefined,
      };
    } catch (error) {
      // Down or failing: the chain still has every MemberSet.
      if (
        !(error instanceof ApiError) ||
        (error.status !== 0 && error.status < 500)
      )
        throw error;
    }
  }

  return chainCandidatePage(client, wallet, group, query, cursor);
}

/** The wallet's own canvas, verified on the chain. */
export function useOwnCanvas({
  payload,
}: {
  readonly payload: {
    readonly network: ZalNetwork | undefined;
    readonly wallet: Address | undefined;
  };
}): QueryResult<Membership> {
  const config = useConfig();
  const { network, wallet } = payload;

  return useQuery<Membership, AppError>({
    enabled: network !== undefined && wallet !== undefined,
    queryKey:
      network === undefined || wallet === undefined
        ? queryKeys.all
        : [...queryKeys.memberships(network.chain.id, wallet), "own"],
    queryFn: async () => {
      try {
        if (network === undefined || wallet === undefined)
          throw new Error("No network or wallet.");

        return await readOwnCanvas(clientFor(config, network), network, wallet);
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
}

/**
 * The other canvases of one group, a page at a time (`fetchNextPage` for "Show more"). `query` is lowercase hex
 * the address contains. Runs only while `enabled`, so nothing is read for a closed switcher or a collapsed group.
 */
export function useMemberships({
  payload,
}: {
  readonly payload: {
    readonly network: ZalNetwork | undefined;
    readonly wallet: Address | undefined;
    readonly group: MembershipGroup;
    readonly query?: string;
    readonly enabled: boolean;
  };
}): UseInfiniteQueryResult<InfiniteData<MembershipPage>, AppError> {
  const config = useConfig();
  const { network, wallet, group, query, enabled } = payload;

  return useInfiniteQuery<
    MembershipPage,
    AppError,
    InfiniteData<MembershipPage>,
    readonly unknown[],
    string | undefined
  >({
    enabled: enabled && network !== undefined && wallet !== undefined,
    queryKey:
      network === undefined || wallet === undefined
        ? queryKeys.all
        : [
            ...queryKeys.memberships(network.chain.id, wallet),
            group,
            query ?? "",
          ],
    initialPageParam: undefined,
    getNextPageParam: (last) => last.next,
    queryFn: async ({ pageParam, signal }) => {
      try {
        if (network === undefined || wallet === undefined)
          throw new Error("No network or wallet.");
        const client = clientFor(config, network);
        const page = await candidatePage(
          client,
          network,
          wallet,
          group,
          query,
          pageParam,
          signal,
        );

        return {
          entries: await verifyCandidates(
            client,
            network,
            wallet,
            page.accounts,
          ),
          next: page.next,
        };
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
}
