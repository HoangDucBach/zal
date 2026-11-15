"use client";

import type { ZalNetwork } from "@/config/chains";
import type { QueryProps, QueryResult } from "@/lib/query/types";

import { relationshipRegistryAbi } from "@/contracts/abis";
import { REL_STATUSES, type Relationship } from "@/lib/canvas/types";
import { useChainQuery } from "@/lib/contracts/read";
import { queryKeys } from "@/lib/query/keys";

export interface RelationshipPayload {
  readonly network: ZalNetwork;
  readonly id: bigint;
}

/** One relationship. Accounts act on it through CanvasAccount (useAcceptRelationship and the rest). */
export function useRelationship({
  payload,
  options,
}: QueryProps<RelationshipPayload, Relationship>): QueryResult<Relationship> {
  return useChainQuery({
    network: payload.network,
    queryKey: queryKeys.relationship(payload.network.chain.id, payload.id),
    read: async (client, network) => {
      const rel = await client.readContract({
        address: network.addresses.registry,
        abi: relationshipRegistryAbi,
        functionName: "getRelationship",
        args: [payload.id],
      });

      return {
        id: payload.id,
        buyer: rel.buyer,
        seller: rel.seller,
        proposer: rel.proposer,
        proposedAt: Number(rel.proposedAt),
        expiresAt: Number(rel.expiresAt),
        status: REL_STATUSES[rel.status] ?? "none",
      };
    },
    options,
  });
}
