// The Account card's withdraw form: turns its two fields into the gated `withdraw(to, amount)` call, or the rule a
// field breaks. The chain checks the same things; this stops a doomed op before the wallet prompt.

import type { GatedCall } from "./types";

import { getAddress, isAddress, zeroAddress } from "viem";

import { parseUsdc } from "@/lib/format";

export type WithdrawInput =
  | {
      readonly ok: true;
      readonly call: Extract<GatedCall, { fn: "withdraw" }>;
    }
  | { readonly ok: false; readonly reason: string };

export function withdrawInput(
  to: string,
  amount: string,
  balance: bigint,
): WithdrawInput {
  const recipient = to.trim();

  if (!isAddress(recipient, { strict: false }))
    return { ok: false, reason: "To: a 0x address" };
  if (getAddress(recipient) === zeroAddress)
    return { ok: false, reason: "To: not the zero address" };
  const value = parseUsdc(amount);

  if (value === undefined)
    return { ok: false, reason: "Amount: zUSDC, up to 6 decimals" };
  if (value === 0n) return { ok: false, reason: "Amount: above 0" };
  if (value > balance) return { ok: false, reason: "Above balance" };

  return {
    ok: true,
    call: { fn: "withdraw", to: getAddress(recipient), amount: value },
  };
}
