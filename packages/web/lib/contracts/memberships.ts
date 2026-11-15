// The canvases a wallet may open (the canvas switcher). Anyone can add any wallet as a member of as many canvases as
// they like, so the list is read a page at a time: candidates come from the indexer in live mode (the ones the wallet
// acted on first, then newest activity first), or from the chain's MemberSet logs (the sandbox engine, or live while
// the API is down). Each page's candidates are then checked on the chain (`verifyCanvas`), so the list shows only
// accounts and roles the chain confirms, and the chain is asked only about the page on screen.

import type { ZalNetwork } from "@/config/chains";
import type { VerifiedCanvas } from "@/lib/contracts/identity";

import {
  getAddress,
  isAddressEqual,
  type Address,
  type PublicClient,
} from "viem";

import { canvasAccountAbi } from "@/contracts/abis";
import { predictAccount, verifyCanvas } from "@/lib/contracts/identity";
import { ContractError } from "@/lib/query/errors";

/** One entry of the switcher: a canvas the chain confirms the wallet may open, with its role there. */
export type Membership = VerifiedCanvas;

/** Entries per page: the API's default page, and the most the chain is asked to verify at once. */
export const MEMBERSHIP_PAGE = 50;

/**
 * Which part of the list: canvases the wallet sent a transaction to, or canvases others only added it to. The
 * second group stays collapsed, so a flood of unsolicited canvases never pushes the wallet's own out of sight.
 */
export type MembershipGroup = "acted" | "addedByOthers";

export interface CandidatePage {
  readonly accounts: readonly Address[];
  /** Opaque: the API's `nextCursor`, or `chain:<offset>` into the MemberSet logs. */
  readonly next: string | undefined;
}

export interface MembershipPage {
  readonly entries: readonly Membership[];
  readonly next: string | undefined;
}

/** Every account whose MemberSet logs name `wallet`, newest first. Removed members are dropped by the chain check. */
export async function memberSetCandidates(
  client: PublicClient,
  wallet: Address,
): Promise<readonly Address[]> {
  const logs = await client.getContractEvents({
    abi: canvasAccountAbi,
    eventName: "MemberSet",
    args: { member: wallet },
    fromBlock: 0n,
  });

  return [...new Set(logs.map((log) => getAddress(log.address)).reverse())];
}

/**
 * One page from the MemberSet logs, for when there is no indexer. The logs do not say who sent each transaction, so
 * every candidate is listed in the `acted` group and `addedByOthers` is empty.
 */
export async function chainCandidatePage(
  client: PublicClient,
  wallet: Address,
  group: MembershipGroup,
  query: string | undefined,
  cursor: string | undefined,
): Promise<CandidatePage> {
  if (group === "addedByOthers") return { accounts: [], next: undefined };
  const all = (await memberSetCandidates(client, wallet)).filter(
    (a) => query === undefined || a.toLowerCase().includes(query),
  );
  const start =
    cursor?.startsWith("chain:") === true ? Number(cursor.slice(6)) : 0;
  const end = start + MEMBERSHIP_PAGE;

  return {
    accounts: all.slice(start, end),
    next: end < all.length ? `chain:${end}` : undefined,
  };
}

/** The wallet's own canvas ("My canvas"), first in the switcher whether or not it is created yet. */
export const readOwnCanvas = (
  client: PublicClient,
  network: ZalNetwork,
  wallet: Address,
): Promise<Membership> => verifyCanvas(client, network, wallet, undefined);

/** The candidates the chain confirms, in the page's order. The wallet's own canvas and refused candidates are left out. */
export async function verifyCandidates(
  client: PublicClient,
  network: ZalNetwork,
  wallet: Address,
  candidates: readonly Address[],
): Promise<readonly Membership[]> {
  const own = await predictAccount(client, network, wallet);
  const others = [
    ...new Set(
      candidates
        .filter((a) => !isAddressEqual(a, own))
        .map((a) => getAddress(a)),
    ),
  ].slice(0, MEMBERSHIP_PAGE * 2);
  const verified = await Promise.all(
    others.map((account) =>
      verifyCanvas(client, network, wallet, account).catch((error: unknown) => {
        if (error instanceof ContractError) return undefined;
        throw error;
      }),
    ),
  );

  return verified.flatMap((v) => (v === undefined ? [] : [v]));
}
