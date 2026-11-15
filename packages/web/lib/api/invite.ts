// Invite links (PRD R1, ZR-REL-03). The proposer's Admin signs an EIP-712 Invite; the API keeps it behind an
// unguessable id; the invitee's account redeems it with `acceptInvite`, which creates the relationship already
// Active. The chain stays the judge: a used nonce or a past deadline reverts.

import type { Address, Hex } from "viem";

import { zeroHash } from "viem";

/** RelationshipRegistry's EIP-712 domain name and version. */
export const INVITE_DOMAIN = {
  name: "Zal RelationshipRegistry",
  version: "1",
} as const;

export const INVITE_TYPES = {
  Invite: [
    { name: "proposer", type: "address" },
    { name: "proposerRole", type: "uint8" },
    { name: "inviteeEmailHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** How long a link stays redeemable. A product default, not a protocol rule. */
export const INVITE_TTL_SECONDS = 7 * 86_400;

/** The proposer's own role, as the Role enum numbers it. */
export type ProposerRole = 0 | 1;

export interface InviteMessage {
  readonly proposer: Address;
  readonly proposerRole: ProposerRole;
  readonly inviteeEmailHash: Hex;
  readonly nonce: bigint;
  readonly deadline: bigint;
}

/** A fresh invite. The nonce is random: the registry keeps an unordered set of used nonces per proposer. */
export function newInvite(
  proposer: Address,
  proposerRole: ProposerRole,
  chainNow: number,
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): InviteMessage {
  const bytes = random(new Uint8Array(32));
  const nonce = bytes.reduce((n, byte) => (n << 8n) | BigInt(byte), 0n);

  return {
    proposer,
    proposerRole,
    inviteeEmailHash: zeroHash,
    nonce,
    deadline: BigInt(chainNow + INVITE_TTL_SECONDS),
  };
}

export const invitePath = (id: string): string =>
  `/app/invite/${encodeURIComponent(id)}`;

/** What the invitee becomes: the opposite of the proposer's role. */
export const inviteeRole = (proposerRole: ProposerRole): "buyer" | "seller" =>
  proposerRole === 1 ? "buyer" : "seller";
