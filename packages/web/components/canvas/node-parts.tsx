"use client";

// The pieces every node card is built from: a key–value row, a copyable address, and the approval policy
// in words. Facts get a row each instead of one line joined with "·".

import type { AccountState } from "@/lib/canvas/types";

import { approverCount } from "./approval-parts";

import { CopyButton, shortHex } from "@/components/ui/copy-button";

/** One fact on a card: the label muted on the left, the value on the right, wrapped rather than cut. */
export function NodeRow({
  label,
  value,
}: {
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium break-words">
        {value}
      </span>
    </div>
  );
}

export function NodeRows({ children }: { readonly children: React.ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

/** `0x1234…abcd` with a copy button. The button does not drag or pan the canvas. */
export function NodeAddress({
  value,
  label = "Copy address",
}: {
  readonly value: string;
  readonly label?: string;
}) {
  return (
    <span className="nodrag nopan inline-flex items-center gap-0.5 font-mono">
      {shortHex(value)}
      <CopyButton label={label} value={value} />
    </span>
  );
}

/** The policy as a title: `Single signer`, `Any 1 of 3`, `2 of 3 signers`. */
export function policySummary(account: AccountState): string {
  const signers = approverCount(account);

  if (account.threshold <= 1)
    return signers <= 1 ? "Single signer" : `Any 1 of ${signers}`;

  return `${account.threshold} of ${signers} signers`;
}
