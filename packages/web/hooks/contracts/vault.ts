"use client";

import type { Address } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type { QueryProps, QueryResult } from "@/lib/query/types";

import { zalVaultAbi } from "@/contracts/abis";
import { useChainQuery } from "@/lib/contracts/read";
import { queryKeys } from "@/lib/query/keys";

export interface VaultPosition {
  readonly shares: bigint;
  /** USDC the shares redeem for. The vault's yield is simulated (ZR-VLT-01). */
  readonly assets: bigint;
}

export function useVaultPosition({
  payload,
  options,
}: QueryProps<
  { readonly network: ZalNetwork; readonly holder: Address },
  VaultPosition
>): QueryResult<VaultPosition> {
  return useChainQuery({
    network: payload.network,
    queryKey: [
      ...queryKeys.vault(payload.network.chain.id),
      payload.holder.toLowerCase(),
    ],
    read: async (client, network) => {
      const shares = await client.readContract({
        address: network.addresses.vault,
        abi: zalVaultAbi,
        functionName: "balanceOf",
        args: [payload.holder],
      });
      const assets =
        shares === 0n
          ? 0n
          : await client.readContract({
              address: network.addresses.vault,
              abi: zalVaultAbi,
              functionName: "convertToAssets",
              args: [shares],
            });

      return { shares, assets };
    },
    options,
  });
}
