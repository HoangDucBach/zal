"use client";

// Real time (PRD principle 5, ADR 0008): one watcher per Zal contract. Each log invalidates exactly the queries
// it makes stale, so both canvases of a relationship redraw within one polling interval.

import type { Abi, Address } from "viem";
import type { ZalNetwork } from "@/config/chains";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useConfig } from "wagmi";
import { watchContractEvent } from "wagmi/actions";

import {
  canvasAccountAbi,
  zusdcAbi,
  relationshipRegistryAbi,
  zalFactoryAbi,
  zalFundingPoolAbi,
  zalInvoiceAbi,
  zalVaultAbi,
} from "@/contracts/abis";
import { keysForEvent, type ZalContract } from "@/lib/contracts/event-keys";

export function useZalEvents(network: ZalNetwork | undefined): void {
  const config = useConfig();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (network === undefined) return;
    const chainId = network.chain.id;
    const { addresses } = network;
    const watched: ReadonlyArray<
      readonly [ZalContract, Address | undefined, Abi]
    > = [
      ["usdc", addresses.usdc, zusdcAbi],
      ["factory", addresses.factory, zalFactoryAbi],
      ["registry", addresses.registry, relationshipRegistryAbi],
      ["invoices", addresses.invoices, zalInvoiceAbi],
      ["pool", addresses.pool, zalFundingPoolAbi],
      ["vault", addresses.vault, zalVaultAbi],
      // Every CanvasAccount: a counterparty's account can change what this canvas shows.
      ["account", undefined, canvasAccountAbi],
    ];
    const unwatch = watched.map(([contract, address, abi]) =>
      watchContractEvent(config, {
        chainId: chainId as never,
        ...(address === undefined ? {} : { address }),
        abi,
        poll: true,
        onLogs: (logs: readonly { address: Address }[]) => {
          for (const log of logs) {
            const { eventName, args } = log as unknown as {
              eventName?: string;
              args?: Record<string, unknown>;
            };

            if (eventName === undefined) continue;
            for (const queryKey of keysForEvent(chainId, {
              contract,
              address: log.address,
              eventName,
              args: args ?? {},
            })) {
              void queryClient.invalidateQueries({ queryKey });
            }
          }
        },
      } as never),
    );

    return () => {
      for (const stop of unwatch) stop();
    };
  }, [config, queryClient, network]);
}
