// The EIP-712 Invite that RelationshipRegistry.acceptInvite redeems (ZR-REL-03). The API stores a signed invite
// behind an unguessable link id; the chain stays the judge of whether it can still be redeemed.

import { randomBytes } from "node:crypto";

import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { z } from "zod";

import { ApiError } from "./errors.ts";

const INVITE_TYPES = {
  Invite: [
    { name: "proposer", type: "address" },
    { name: "proposerRole", type: "uint8" },
    { name: "inviteeEmailHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** secp256k1 group order. */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
/** OpenZeppelin's ECDSA.recover rejects an `s` above n / 2, so the chain would refuse the invite. */
const HALF_N = N / 2n;

/** A 65-byte signature `acceptInvite` accepts: `r` in [1, n), `s` in [1, n / 2], `v` of 27 or 28. */
const isCanonical = (sig: string): boolean => {
  const r = BigInt(`0x${sig.slice(2, 66)}`);
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  const v = Number.parseInt(sig.slice(130, 132), 16);
  return r > 0n && r < N && s > 0n && s <= HALF_N && (v === 27 || v === 28);
};

export const inviteBodySchema = z.strictObject({
  proposer: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((a) => a.toLowerCase() as Address),
  /** 0 Buyer, 1 Seller: the proposer's own role in the relationship. */
  proposerRole: z.union([z.literal(0), z.literal(1)]),
  inviteeEmailHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((h) => h.toLowerCase() as Hex),
  nonce: z
    .string()
    .regex(/^\d{1,78}$/)
    .refine((n) => BigInt(n) < 2n ** 256n, "nonce is above uint256")
    // One on-chain nonce has one spelling, so "7" and "007" hit the same unique key.
    .transform((n) => BigInt(n).toString()),
  deadline: z.number().int().positive().max(2 ** 53 - 1),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]{130}$/)
    .refine(isCanonical, "signature must have a low s and v of 27 or 28")
    .transform((s) => s.toLowerCase() as Hex),
});

export type InviteBody = z.output<typeof inviteBodySchema>;

/** The invite's signer. A signature no key could have made is a 400. */
export const recoverInviteSigner = (body: InviteBody, chainId: number, registry: Address): Promise<Address> =>
  recoverTypedDataAddress({
    domain: { name: "Zal RelationshipRegistry", version: "1", chainId, verifyingContract: registry },
    types: INVITE_TYPES,
    primaryType: "Invite",
    message: {
      proposer: body.proposer,
      proposerRole: body.proposerRole,
      inviteeEmailHash: body.inviteeEmailHash,
      nonce: BigInt(body.nonce),
      deadline: BigInt(body.deadline),
    },
    signature: body.signature,
  }).catch(() => {
    throw new ApiError("bad_request", "The signature recovers to no address");
  });

export const newInviteId = (): string => randomBytes(18).toString("base64url");
