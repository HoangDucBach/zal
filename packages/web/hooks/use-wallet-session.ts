"use client";

import type { Address } from "viem";

import { useSyncExternalStore } from "react";
import { useConnection } from "wagmi";

import { wagmiConfig } from "@/config/wagmi";

/**
 * `pending` until wagmi's first reconnect attempt has finished. Before that, a returning visitor still reads as
 * disconnected for a moment.
 */
export type WalletSession =
  | { readonly status: "pending" }
  | { readonly status: "signedOut" }
  | {
      readonly status: "signedIn";
      readonly address: Address;
      readonly chainId: number;
      readonly connectorId: string;
    };

let reconnectSettled = false;
const settledListeners = new Set<() => void>();

wagmiConfig.subscribe(
  (state) => state.status,
  (status, previous) => {
    const wasPending = previous === "reconnecting" || previous === "connecting";

    if (
      reconnectSettled ||
      !wasPending ||
      status === "reconnecting" ||
      status === "connecting"
    )
      return;
    reconnectSettled = true;
    for (const listener of settledListeners) listener();
  },
);

function subscribeSettled(listener: () => void): () => void {
  settledListeners.add(listener);

  return () => settledListeners.delete(listener);
}

export function useWalletSession(): WalletSession {
  const connection = useConnection();
  const settled = useSyncExternalStore(
    subscribeSettled,
    () => reconnectSettled,
    () => false,
  );

  if (connection.status === "connected") {
    return {
      status: "signedIn",
      address: connection.address,
      chainId: connection.chainId,
      connectorId: connection.connector.id,
    };
  }
  if (!settled || connection.status === "reconnecting")
    return { status: "pending" };

  return { status: "signedOut" };
}
