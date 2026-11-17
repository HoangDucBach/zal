"use client";

// The approval policy as the chain applies it (ZR-ACC-11): m of n above a single-signature allowance
// that the whole account shares per rolling 24 h. The window is read from the chain, never from the API.

import type { ZalNetwork } from "@/config/chains";
import type { AccountState } from "@/lib/canvas/types";

import { Note } from "./form-parts";

import { Amount } from "@/components/ui/amount";
import { useSpendWindow } from "@/hooks/contracts/canvas-account";
import { signaturesNeeded } from "@/lib/canvas/spend-window";

export const approverCount = (account: AccountState) =>
  account.members.filter((m) => m.role === "admin" || m.role === "approver")
    .length;

/** The account's spend window, read only where it can change a count: an existing account above 1 of n. */
export function useAccountWindow(
  network: ZalNetwork | undefined,
  account: AccountState,
) {
  return useSpendWindow({
    payload: { network, account: account.address },
    options: { enabled: account.exists && account.threshold > 1 },
  });
}

/** `2 of 3 above 1,000 USDC per 24 h`. */
export function PolicyText({
  account,
  unit,
}: {
  readonly account: AccountState;
  readonly unit?: string | null;
}) {
  return (
    <>
      {account.threshold} of {approverCount(account)} above{" "}
      <Amount unit={unit} value={account.approvalLimit} /> per 24 h
    </>
  );
}

/** `used 300 of 500 USDC today`. */
export function UsageText({
  account,
  spent,
  unit,
}: {
  readonly account: AccountState;
  readonly spent: bigint;
  readonly unit?: string | null;
}) {
  return (
    <>
      used <Amount unit={null} value={spent} /> of{" "}
      <Amount unit={unit} value={account.approvalLimit} /> today
    </>
  );
}

/** {@link UsageText} read from the chain; nothing until the window is read. */
export function WindowUsage({
  network,
  account,
}: {
  readonly network: ZalNetwork | undefined;
  readonly account: AccountState;
}) {
  const window = useAccountWindow(network, account);

  return account.threshold < 2 || window.data === undefined ? null : (
    <UsageText account={account} spent={window.data.spent} />
  );
}

/** How many signatures an op of `amount` needs now, given what the window has already spent. */
export function SignaturesNote({
  network,
  account,
  amount,
}: {
  readonly network: ZalNetwork;
  readonly account: AccountState;
  readonly amount: bigint | undefined;
}) {
  const window = useAccountWindow(network, account);

  if (
    account.threshold < 2 ||
    amount === undefined ||
    window.data === undefined
  )
    return null;
  const needed = signaturesNeeded(account, window.data, amount);

  return (
    <Note>
      {needed === 1 ? "1 signature" : `${needed} signatures`} ·{" "}
      <UsageText account={account} spent={window.data.spent} />
    </Note>
  );
}
