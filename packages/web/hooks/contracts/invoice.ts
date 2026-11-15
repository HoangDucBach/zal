"use client";

import type { ZalNetwork } from "@/config/chains";
import type { MutationProps, QueryProps, QueryResult } from "@/lib/query/types";

import { zalInvoiceAbi } from "@/contracts/abis";
import { INVOICE_STATUSES } from "@/lib/canvas/types";
import { useChainQuery } from "@/lib/contracts/read";
import {
  simulateAndWrite,
  useContractMutation,
  type WriteResult,
} from "@/lib/contracts/write";
import { queryKeys } from "@/lib/query/keys";

export interface InvoicePayload {
  readonly network: ZalNetwork;
  readonly id: bigint;
}

export interface InvoiceRecord {
  readonly status: (typeof INVOICE_STATUSES)[number];
  readonly faceValue: bigint;
  readonly escrowed: bigint;
  readonly dueDate: number;
  /** The payment recipient (INV-06). `undefined` after a cancelled invoice is burned. */
  readonly owner: `0x${string}` | undefined;
}

export function useInvoice({
  payload,
  options,
}: QueryProps<InvoicePayload, InvoiceRecord>): QueryResult<InvoiceRecord> {
  return useChainQuery({
    network: payload.network,
    queryKey: queryKeys.invoice(payload.network.chain.id, payload.id),
    read: async (client, network) => {
      const [inv, owner] = await Promise.all([
        client.readContract({
          address: network.addresses.invoices,
          abi: zalInvoiceAbi,
          functionName: "getInvoice",
          args: [payload.id],
        }),
        client
          .readContract({
            address: network.addresses.invoices,
            abi: zalInvoiceAbi,
            functionName: "ownerOf",
            args: [payload.id],
          })
          .catch(() => undefined),
      ]);

      return {
        status: INVOICE_STATUSES[inv.status] ?? "none",
        faceValue: inv.faceValue,
        escrowed: inv.escrowed,
        dueDate: Number(inv.dueDate),
        owner,
      };
    },
    options,
  });
}

/**
 * Settles an escrowed invoice once its due date has passed. Anyone may call it (ZR-PAY): the seller does not
 * have to wait for the buyer. Before the due date only the buyer's account can pay, through its gated op.
 */
export function useSettleEscrowedInvoice({
  network,
  options,
}: MutationProps<WriteResult, { readonly id: bigint }> & {
  readonly network: ZalNetwork | undefined;
}) {
  return useContractMutation<{ readonly id: bigint }>({
    network,
    options,
    send: ({ id }, config, net) =>
      simulateAndWrite(config, net, {
        address: net.addresses.invoices,
        abi: zalInvoiceAbi,
        functionName: "payInvoice",
        args: [id],
      }),
  });
}
