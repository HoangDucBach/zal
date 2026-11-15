"use client";

import type { ZalNetwork } from "@/config/chains";
import type { CanvasState } from "@/lib/canvas/types";
import type { SavedLayout } from "@/lib/api/wire";
import type { QueryResult } from "@/lib/query/types";

import { useQuery } from "@tanstack/react-query";
import {
  getAddress,
  isAddressEqual,
  zeroHash,
  type Address,
  type PublicClient,
} from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";

import { zalFactoryAbi } from "@/contracts/abis";
import { api, apiUrl } from "@/lib/api/client";
import { readCanvasState } from "@/lib/contracts/canvas-reads";
import { verifyCanvas, type VerifiedCanvas } from "@/lib/contracts/identity";
import { ApiError, toAppError, type AppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";
import { SANDBOX_BOTS, SANDBOX_NAMES } from "@/lib/sandbox/config";
import { readDemoPartners } from "@/lib/sandbox/partners";

export interface CanvasPayload {
  /** The query waits until both are known. */
  readonly network: ZalNetwork | undefined;
  readonly wallet: Address | undefined;
  /** The requested canvas (`?account=`), the wallet's own when `undefined`. Verified on the chain before use. */
  readonly selected?: Address;
}

async function sandboxLabels(
  client: PublicClient,
  network: ZalNetwork,
): Promise<Record<string, string>> {
  if (network.kind !== "sandbox") return {};
  const accountOf = (admin: Address) =>
    client.readContract({
      address: network.addresses.factory,
      abi: zalFactoryAbi,
      functionName: "predictAccount",
      args: [admin, zeroHash],
    });
  const canvasOf = async (admin: Address) => {
    const account = await accountOf(admin);
    const exists = await client.readContract({
      address: network.addresses.factory,
      abi: zalFactoryAbi,
      functionName: "isAccount",
      args: [account],
    });

    return exists ? account : undefined;
  };
  const [club, printShop, partners] = await Promise.all([
    accountOf(SANDBOX_BOTS.clubAdmin),
    accountOf(SANDBOX_BOTS.printShopAdmin),
    readDemoPartners(canvasOf),
  ]);

  return {
    [getAddress(club)]: SANDBOX_NAMES.club,
    [getAddress(printShop)]: SANDBOX_NAMES.printShop,
    [getAddress(SANDBOX_BOTS.cosigner)]: SANDBOX_NAMES.cosigner,
    ...Object.fromEntries(partners.map((p) => [getAddress(p.account), p.name])),
  };
}

/** Where a snapshot came from: the indexer's API (live), or the chain itself (sandbox, or live while the API is down). */
export type CanvasSource = "api" | "chain";

export interface CanvasSnapshot {
  /** `canvas.account.myRole` is the chain's `roleOf(wallet)`, whatever the API said. */
  readonly canvas: CanvasState;
  /** The canvas shown, checked on the chain: never an API value. */
  readonly access: VerifiedCanvas;
  /** The layout the API stores for the account: `null` when none is saved, `undefined` when read from the chain. */
  readonly saved: SavedLayout | null | undefined;
  readonly source: CanvasSource;
  /** The API's indexed block this was read at; `undefined` when read from the chain. */
  readonly asOfBlock: number | undefined;
}

/** The API is down or failing, as opposed to refusing the request: live mode then reads the chain. */
const apiDown = (error: unknown) =>
  error instanceof ApiError && (error.status === 0 || error.status >= 500);

/** The state with the chain's role for the wallet, so the role gates never rest on an API answer. */
const withRole = (canvas: CanvasState, access: VerifiedCanvas): CanvasState =>
  canvas.account.myRole === access.role
    ? canvas
    : { ...canvas, account: { ...canvas.account, myRole: access.role } };

async function readSnapshot(
  client: PublicClient,
  network: ZalNetwork,
  wallet: Address,
  selected: Address | undefined,
  signal: AbortSignal,
): Promise<CanvasSnapshot> {
  const access = await verifyCanvas(client, network, wallet, selected);

  if (network.kind === "live" && apiUrl !== undefined) {
    try {
      const response = await api.canvas(access.account, wallet, signal);

      // The API is a read model: an answer about another wallet or account than the one asked for is not used,
      // and the chain is read instead. Every address the page shows as "you" then matches the signer.
      if (
        isAddressEqual(response.canvas.wallet, wallet) &&
        isAddressEqual(response.canvas.account.address, access.account)
      )
        return {
          canvas: withRole(response.canvas, access),
          access,
          saved: response.layout,
          source: "api",
          asOfBlock: response.asOf.block,
        };
    } catch (error) {
      if (!apiDown(error)) throw error;
    }
  }

  return {
    canvas: withRole(
      await readCanvasState({
        client,
        addresses: network.addresses,
        wallet,
        account: access,
        labels: await sandboxLabels(client, network),
      }),
      access,
    ),
    access,
    saved: undefined,
    source: "chain",
    asOfBlock: undefined,
  };
}

/**
 * Everything one canvas shows, with the account's saved layout in live mode. Live mode reads it from the API, whose
 * stream invalidates it (useLiveUpdates); the sandbox reads its in-browser chain, whose events invalidate it.
 */
export function useCanvasSnapshot<TData = CanvasSnapshot>({
  payload,
  select,
}: {
  readonly payload: CanvasPayload;
  readonly select?: (snapshot: CanvasSnapshot) => TData;
}): QueryResult<TData> {
  const config = useConfig();
  const { network, wallet, selected } = payload;

  return useQuery<CanvasSnapshot, AppError, TData>({
    enabled: network !== undefined && wallet !== undefined,
    queryKey:
      network === undefined || wallet === undefined
        ? queryKeys.all
        : queryKeys.canvas(network.chain.id, wallet, selected),
    select,
    queryFn: async ({ signal }) => {
      try {
        if (network === undefined || wallet === undefined)
          throw new Error("No network or wallet.");
        const client = getPublicClient(config, {
          chainId: network.chain.id as never,
        }) as PublicClient | undefined;

        if (client === undefined)
          throw new Error(`No client for chain ${network.chain.id}.`);

        return await readSnapshot(client, network, wallet, selected, signal);
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
}

const selectCanvas = (snapshot: CanvasSnapshot) => snapshot.canvas;

/** The canvas state alone. Shares the snapshot query, so it costs no extra read. */
export function useCanvas({
  payload,
}: {
  readonly payload: CanvasPayload;
}): QueryResult<CanvasState> {
  return useCanvasSnapshot({ payload, select: selectCanvas });
}
