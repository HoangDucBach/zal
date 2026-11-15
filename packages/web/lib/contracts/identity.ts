// Who the visitor is, taken from the wallet and the chain, never from the API (ADR 0012 makes the API a read
// model). Every transaction target, recipient and signer comes from here, so a wrong or tampered API answer can
// change what the canvas shows but not where a transaction goes.

import type { ZalNetwork } from "@/config/chains";
import type { MemberRole } from "@/lib/canvas/types";

import {
  isAddressEqual,
  zeroHash,
  type Address,
  type PublicClient,
} from "viem";
import { type Config } from "wagmi";
import { getConnection, getPublicClient } from "wagmi/actions";

import { canvasAccountAbi, zalFactoryAbi } from "@/contracts/abis";
import { MEMBER_ROLES } from "@/lib/canvas/types";
import { ContractError } from "@/lib/query/errors";

/**
 * A canvas the client read from the chain to be one the wallet may open: its own (`predictAccount(wallet, 0)`,
 * which may not be created yet), or a Zal account (`ZalFactory.isAccount`) where `CanvasAccount.roleOf(wallet)` is
 * not None. Built only by `verifyCanvas`, never from an API answer.
 */
export interface VerifiedCanvas {
  readonly account: Address;
  /** `roleOf(wallet)` at the chain head. `none` only for the wallet's own canvas before it is created. */
  readonly role: MemberRole;
  readonly own: boolean;
  readonly exists: boolean;
}

/** The signer wallet and the verified canvas it acts on: every account transaction goes to `account`. */
export interface TrustedIdentity extends VerifiedCanvas {
  /** The wallet wagmi has connected: the one that signs. */
  readonly wallet: Address;
}

/** `predictAccount(wallet, 0)` never changes, so one read per wallet and chain is enough. */
const predicted = new Map<string, Promise<Address>>();

export function predictAccount(
  client: PublicClient,
  network: ZalNetwork,
  wallet: Address,
): Promise<Address> {
  const key = `${network.chain.id}:${wallet.toLowerCase()}`;
  let account = predicted.get(key);

  if (account === undefined) {
    account = client.readContract({
      address: network.addresses.factory,
      abi: zalFactoryAbi,
      functionName: "predictAccount",
      args: [wallet, zeroHash],
    });
    account.catch(() => predicted.delete(key));
    predicted.set(key, account);
  }

  return account;
}

const isAccount = (
  client: PublicClient,
  network: ZalNetwork,
  account: Address,
) =>
  client.readContract({
    address: network.addresses.factory,
    abi: zalFactoryAbi,
    functionName: "isAccount",
    args: [account],
  });

/** `CanvasAccount.roleOf(wallet)` at the chain head. */
export async function roleOf(
  client: PublicClient,
  account: Address,
  wallet: Address,
): Promise<MemberRole> {
  const role = await client.readContract({
    address: account,
    abi: canvasAccountAbi,
    functionName: "roleOf",
    args: [wallet],
  });

  return MEMBER_ROLES[Number(role)] ?? "none";
}

/**
 * Checks on the chain that `wallet` may open `requested` (its own canvas when `undefined`). Throws a ContractError
 * stating the rule when it may not.
 */
export async function verifyCanvas(
  client: PublicClient,
  network: ZalNetwork,
  wallet: Address,
  requested: Address | undefined,
): Promise<VerifiedCanvas> {
  const own = await predictAccount(client, network, wallet);
  const account =
    requested === undefined || isAddressEqual(requested, own) ? own : requested;
  const exists = await isAccount(client, network, account);

  if (account === own)
    return {
      account,
      own: true,
      exists,
      role: exists ? await roleOf(client, account, wallet) : "none",
    };
  if (!exists) throw new ContractError("Not a Zal canvas", undefined);
  const role = await roleOf(client, account, wallet);

  if (role === "none")
    throw new ContractError("Not a member of this canvas", undefined);

  return { account, own: false, exists, role };
}

/**
 * The connected wallet and the canvas it acts on, read when a transaction is about to be sent: `requested` (the
 * selected canvas) re-verified at the chain head, or the wallet's own canvas.
 */
export async function signerIdentity(
  config: Config,
  network: ZalNetwork,
  requested?: Address,
): Promise<TrustedIdentity> {
  const wallet = getConnection(config).address;

  if (wallet === undefined)
    throw new ContractError("Connect a wallet first.", undefined);
  const client = getPublicClient(config, {
    chainId: network.chain.id as never,
  }) as PublicClient | undefined;

  if (client === undefined)
    throw new ContractError(
      `No client for chain ${network.chain.id}.`,
      undefined,
    );

  return {
    wallet,
    ...(await verifyCanvas(client, network, wallet, requested)),
  };
}
