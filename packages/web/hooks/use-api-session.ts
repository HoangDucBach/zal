"use client";

import type { Address } from "viem";
import type { ZalNetwork } from "@/config/chains";

import { toast } from "@heroui/react";
import { useCallback } from "react";
import { useConfig } from "wagmi";
import { signMessage } from "wagmi/actions";

import { apiUrl } from "@/lib/api/client";
import {
  apiSessions,
  useApiSession,
  type ApiSession,
  type ApiSessionState,
} from "@/lib/api/session";
import { toAppError } from "@/lib/query/errors";

export interface ApiSignIn {
  /** False in the sandbox and without an API: nothing there needs a session. */
  readonly available: boolean;
  readonly state: ApiSessionState;
  /** Asks the wallet for one signature. Resolves undefined when the wallet refused or the API failed (toasted). */
  readonly signIn: () => Promise<ApiSession | undefined>;
}

/** Sign-in with Ethereum for the API's off-chain writes, for the connected wallet on the live network. */
export function useApiSignIn(
  network: ZalNetwork | undefined,
  wallet: Address | undefined,
): ApiSignIn {
  const config = useConfig();
  const available =
    network?.kind === "live" && apiUrl !== undefined && wallet !== undefined;
  const chainId = available ? network.chain.id : undefined;
  const state = useApiSession(chainId, wallet);

  const signIn = useCallback(async () => {
    if (chainId === undefined || wallet === undefined) return undefined;
    try {
      return await apiSessions.signIn({
        chainId,
        wallet,
        origin: window.location.origin,
        sign: (message) => signMessage(config, { account: wallet, message }),
      });
    } catch (error) {
      const appError = toAppError(error);

      if (appError.kind !== "wallet-rejected") toast.danger(appError.message);

      return undefined;
    }
  }, [chainId, wallet, config]);

  return { available, state, signIn };
}
