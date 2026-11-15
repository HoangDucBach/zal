// Whether the funding pool would advance against an invoice now, and if not, why. Mirrors the checks in
// ZalFundingPool.advance (ZR-FND-01..03, ADR 0009) so the Inspector can explain a disabled button before a revert.

import type { Invoice, PoolState } from "./types";

import { isAddressEqual } from "viem";

import { formatUsdc } from "@/lib/format";

export type AdvancePath = "escrow" | "credit";

export type AdvanceEligibility =
  | { readonly ok: true; readonly path: AdvancePath }
  | { readonly ok: false; readonly reason: string };

export function advanceEligibility(
  invoice: Invoice,
  pool: PoolState,
  now: number,
): AdvanceEligibility {
  if (
    invoice.owner !== undefined &&
    isAddressEqual(invoice.owner, pool.address)
  ) {
    return {
      ok: false,
      reason: "Already financed · pool holds the NFT",
    };
  }
  if (invoice.status !== "approved")
    return {
      ok: false,
      reason: "Buyer has not approved yet",
    };
  if (invoice.dueDate <= now)
    return {
      ok: false,
      reason: "Past due · no advance",
    };
  if (invoice.escrowed === invoice.faceValue)
    return { ok: true, path: "escrow" };

  const principal = (invoice.faceValue * BigInt(pool.advanceRateBps)) / 10_000n;
  const { limit, outstanding } = invoice.buyerCredit;

  if (limit === 0n) {
    return {
      ok: false,
      reason: "Not escrowed and buyer not enrolled",
    };
  }
  if (outstanding + principal > limit) {
    return {
      ok: false,
      reason: `Buyer credit line: ${formatUsdc(limit - outstanding)} left < ${formatUsdc(principal)} USDC advance · escrow first`,
    };
  }

  return { ok: true, path: "credit" };
}
