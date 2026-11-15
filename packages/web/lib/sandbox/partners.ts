// Demo partners: extra sandbox counterparties the visitor creates on demand, as many as they like. Nothing here
// loads the engine, so the canvas labels can use it. A partner's admin wallet encodes its number and role, so the
// list is read back from the chain itself: the journal replays it on reload, and Reset drops it with the chain.

import { getAddress, pad, toHex, type Address } from "viem";

/** What the partner's bot does toward the visitor. A trait of the sandbox bot; on-chain it is a plain canvas. */
export type PartnerRole = "buyer" | "seller";

export interface DemoPartner {
  /** 1, 2, … in creation order. */
  readonly number: number;
  readonly role: PartnerRole;
  /** The bot wallet that administers the partner's canvas. */
  readonly admin: Address;
  /** The partner's canvas (CanvasAccount). */
  readonly account: Address;
  readonly name: string;
}

const ROLE_TAG: Readonly<Record<PartnerRole, bigint>> = {
  buyer: 0xb0b0n,
  seller: 0x5e11n,
};

export function partnerAdmin(number: number, role: PartnerRole): Address {
  return getAddress(
    pad(toHex((ROLE_TAG[role] << 32n) | BigInt(number)), { size: 20 }),
  );
}

export const partnerName = (number: number): string => `Demo partner ${number}`;

/**
 * Partners 1, 2, … in order, up to the first number with no canvas. `canvasOf` returns the canvas `admin` created,
 * or `undefined` when it has none.
 */
export async function readDemoPartners(
  canvasOf: (admin: Address) => Promise<Address | undefined>,
): Promise<DemoPartner[]> {
  const partners: DemoPartner[] = [];

  for (let number = 1; ; number++) {
    const found = await firstPartner(number, canvasOf);

    if (found === undefined) return partners;
    partners.push(found);
  }
}

async function firstPartner(
  number: number,
  canvasOf: (admin: Address) => Promise<Address | undefined>,
): Promise<DemoPartner | undefined> {
  for (const role of ["buyer", "seller"] as const) {
    const admin = partnerAdmin(number, role);
    const account = await canvasOf(admin);

    if (account !== undefined)
      return { number, role, admin, account, name: partnerName(number) };
  }

  return undefined;
}
