"use client";

// What the Account node holds itself: role, policy, withdraw, members, add approver and the faucet live on the card,
// not in the Inspector.

import type { ZalNetwork } from "@/config/chains";
import type { AccountState } from "@/lib/canvas/types";

import { Button, Separator } from "@heroui/react";
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import { useConnection } from "wagmi";

import { PolicyText, SignaturesNote, WindowUsage } from "./approval-parts";
import { Field, Note, feedback } from "./form-parts";
import { NodeAddress, NodeRow, NodeRows, policySummary } from "./node-parts";

import { Amount } from "@/components/ui/amount";
import { useSetMember, useSubmitOp } from "@/hooks/contracts/canvas-account";
import { useMintTestUsdc } from "@/hooks/contracts/usdc";
import { allows } from "@/lib/canvas/roles";
import { withdrawInput } from "@/lib/canvas/withdraw";

const MINT_AMOUNT = 1_000_000_000n;

/** A gated `withdraw(to, amount)`: runs at once within the allowance, else waits for co-signers. */
function WithdrawForm({
  network,
  account,
}: {
  readonly network: ZalNetwork | undefined;
  readonly account: AccountState;
}) {
  const connection = useConnection();
  const wallet =
    connection.status === "connected" ? connection.address : undefined;
  // Until the field is edited it follows the connected wallet.
  const [to, setTo] = useState<string | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const submit = useSubmitOp({
    network,
    options: feedback("Withdrawal submitted", () => setAmount("")),
  });
  const recipient = to ?? wallet ?? "";
  const input = withdrawInput(recipient, amount, account.balance);

  return (
    <div className="nodrag nopan flex flex-col gap-2">
      <Field
        label="Withdraw to"
        placeholder="0x…"
        value={recipient}
        onChange={setTo}
      />
      <Field
        label="Amount, zUSDC"
        placeholder="0"
        value={amount}
        onChange={setAmount}
      />
      {input.ok ? (
        network === undefined ? null : (
          <SignaturesNote
            account={account}
            amount={input.call.amount}
            network={network}
          />
        )
      ) : amount === "" ? null : (
        <Note>{input.reason}</Note>
      )}
      <Button
        fullWidth
        isDisabled={!input.ok}
        isPending={submit.isPending}
        size="sm"
        variant="secondary"
        onPress={() => input.ok && submit.mutate({ call: input.call })}
      >
        Withdraw
      </Button>
    </div>
  );
}

export function AccountDetails({
  network,
  account,
  labels,
}: {
  readonly network: ZalNetwork | undefined;
  readonly account: AccountState;
  readonly labels: Readonly<Record<string, string>>;
}) {
  const mint = useMintTestUsdc({
    network,
    options: feedback("Minted 1,000 zUSDC"),
  });
  const setMember = useSetMember({
    network,
    options: feedback("Member added"),
  });
  const [member, setMemberAddress] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <NodeRows>
        <NodeRow
          label="Address"
          value={
            <NodeAddress label="Copy account address" value={account.address} />
          }
        />
        <NodeRow label="Your role" value={account.myRole} />
        <NodeRow
          label="Policy"
          value={
            account.threshold > 1 ? (
              <PolicyText account={account} />
            ) : (
              policySummary(account)
            )
          }
        />
        {account.threshold > 1 ? (
          <NodeRow
            label="Allowance"
            value={<WindowUsage account={account} network={network} />}
          />
        ) : null}
        {account.vaultAssets > 0n ? (
          <NodeRow
            label="In vault"
            value={<Amount value={account.vaultAssets} />}
          />
        ) : null}
      </NodeRows>
      {allows(account.myRole, "approver") ? (
        <>
          <Separator />
          <WithdrawForm account={account} network={network} />
        </>
      ) : null}
      <Separator />
      <NodeRows>
        <span className="text-xs font-medium text-muted">Members</span>
        {account.members.map((m) => (
          // The name and address take the width and wrap; the role never breaks.
          <div
            key={m.address}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-1">
              {labels[m.address] === undefined ? null : (
                <span>{labels[m.address]}</span>
              )}
              <span className="text-muted">
                <NodeAddress label="Copy member address" value={m.address} />
              </span>
            </span>
            <span className="shrink-0 font-medium">{m.role}</span>
          </div>
        ))}
      </NodeRows>
      {allows(account.myRole, "admin") ? (
        <div className="nodrag nopan flex flex-col gap-2">
          <Field
            label="New approver"
            placeholder="0x…"
            value={member}
            onChange={setMemberAddress}
          />
          <Button
            isDisabled={!isAddress(member, { strict: false })}
            isPending={setMember.isPending}
            size="sm"
            variant="secondary"
            onPress={() => setMember.mutate({ args: [getAddress(member), 2] })}
          >
            Add approver
          </Button>
        </div>
      ) : null}
      <Separator />
      <div className="nodrag nopan flex">
        <Button
          fullWidth
          isPending={mint.isPending}
          size="sm"
          variant="secondary"
          onPress={() => mint.mutate({ to: "account", amount: MINT_AMOUNT })}
        >
          Mint 1,000 zUSDC
        </Button>
      </div>
    </div>
  );
}
