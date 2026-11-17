// What a signing control may show: values this client read from the chain itself, never from the API (the API is a
// read model). Only the readers in this file brand a value, so a component that takes
// `ChainVerified<T>` cannot be handed an API answer without a cast a reviewer sees.

import type { ZalAddresses } from "@/config/chains";
import type { Invoice, PendingOp } from "@/lib/canvas/types";

import { type Address, type PublicClient } from "viem";

import { invoiceOf } from "@/lib/canvas/ops";
import { readInvoice, readOp } from "@/lib/contracts/canvas-reads";

declare const fromChain: unique symbol;
export type ChainVerified<T> = T & { readonly [fromChain]: true };

const verified = <T>(value: T) => value as ChainVerified<T>;

/** A pending op and, for an invoice op, the invoice it acts on: what Confirm moves and who it pays. */
export interface ChainOp {
  readonly op: PendingOp;
  /** `undefined` for a withdrawal or a scheduled transfer, which name their amount and recipient in the call. */
  readonly invoice: Invoice | undefined;
}

/** `ZalInvoice.getInvoice` and `ownerOf` (the payment recipient), with the pool's advance when it holds the NFT. */
export async function readChainInvoice(
  client: PublicClient,
  addresses: ZalAddresses,
  id: bigint,
): Promise<ChainVerified<Invoice>> {
  return verified(await readInvoice(client, addresses, id));
}

/** `getOp` decoded, and the invoice it refers to. `undefined` when the account stores no op with this id. */
export async function readChainOp(
  client: PublicClient,
  addresses: ZalAddresses,
  account: Address,
  opId: bigint,
  wallet: Address,
): Promise<ChainVerified<ChainOp> | undefined> {
  const op = await readOp(client, account, opId, wallet);

  if (op === undefined) return undefined;
  const invoiceId = invoiceOf(op.call);
  const invoice =
    invoiceId === undefined
      ? undefined
      : await readInvoice(client, addresses, invoiceId);

  return verified({ op, invoice });
}
