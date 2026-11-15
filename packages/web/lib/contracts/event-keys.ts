// Which queries a contract event makes stale. Pure, so the mapping is tested without a chain. Every event that
// changes what a canvas draws also invalidates the canvases on that chain.

import type { QueryKey } from "@tanstack/react-query";
import type { Address } from "viem";

import { queryKeys } from "@/lib/query/keys";

export type ZalContract =
  "usdc" | "factory" | "registry" | "invoices" | "pool" | "vault" | "account";

export interface ZalEvent {
  readonly contract: ZalContract;
  /** The emitting contract, which for `account` is the CanvasAccount itself. */
  readonly address: Address;
  readonly eventName: string;
  readonly args: Readonly<Record<string, unknown>>;
}

const bigintArg = (args: ZalEvent["args"], key: string): bigint | undefined => {
  const value = args[key];

  return typeof value === "bigint" ? value : undefined;
};

const addressArg = (
  args: ZalEvent["args"],
  key: string,
): Address | undefined => {
  const value = args[key];

  return typeof value === "string" && value.startsWith("0x")
    ? (value as Address)
    : undefined;
};

export function keysForEvent(chainId: number, event: ZalEvent): QueryKey[] {
  const keys: QueryKey[] = [queryKeys.canvases(chainId)];
  const { args } = event;

  switch (event.contract) {
    case "usdc": {
      for (const key of ["from", "to"]) {
        const holder = addressArg(args, key);

        if (holder !== undefined) keys.push(queryKeys.balance(chainId, holder));
      }

      return keys;
    }
    case "factory": {
      const admin = addressArg(args, "admin");

      if (admin !== undefined) keys.push(queryKeys.accountOf(chainId, admin));

      return keys;
    }
    case "registry": {
      const id = bigintArg(args, "id");

      keys.push(
        id === undefined
          ? queryKeys.relationships(chainId)
          : queryKeys.relationship(chainId, id),
      );

      return keys;
    }
    case "invoices": {
      const id = bigintArg(args, "id") ?? bigintArg(args, "tokenId");

      keys.push(
        id === undefined
          ? queryKeys.invoices(chainId)
          : queryKeys.invoice(chainId, id),
      );

      return keys;
    }
    case "pool": {
      keys.push(queryKeys.pool(chainId));
      const id = bigintArg(args, "invoiceId");

      if (id !== undefined) keys.push(queryKeys.invoice(chainId, id));

      return keys;
    }
    case "vault":
      keys.push(queryKeys.vault(chainId));

      return keys;
    case "account":
      keys.push(queryKeys.account(chainId, event.address));
      if (
        event.eventName === "PaymentRouted" ||
        event.eventName === "VaultDeposited"
      ) {
        keys.push(queryKeys.vault(chainId), queryKeys.balances(chainId));
      }

      return keys;
  }
}
