"use client";

// The only place Confirm and Revoke render. Every value next to them comes from `ChainVerified<ChainOp>`: the op the
// account stores and, for an invoice op, the invoice ZalInvoice stores with `ownerOf` as the recipient. The API's
// version reaches this component only as the names of the fields that differ.

import type { ZalNetwork } from "@/config/chains";
import type { Invoice } from "@/lib/canvas/types";
import type { ChainOp, ChainVerified } from "@/lib/contracts/chain-verified";

import { Button, Chip } from "@heroui/react";
import { useState } from "react";
import { isAddressEqual } from "viem";

import { Note, Row, attempt, feedback } from "./form-parts";

import { Amount } from "@/components/ui/amount";
import { useConfirmOp, useRevokeOp } from "@/hooks/contracts/canvas-account";
import { opLabel } from "@/lib/canvas/ops";
import { shortAddress } from "@/lib/format";
import { cosignSandbox } from "@/lib/sandbox/session";

/** `ownerOf`, the address a payment of this invoice goes to (INV-06). */
export function recipientText(invoice: Invoice, network: ZalNetwork): string {
  if (invoice.owner === undefined) return "burned";

  return isAddressEqual(invoice.owner, network.addresses.pool)
    ? "Funding pool"
    : shortAddress(invoice.owner);
}

/** Names the fields where the API differs from the chain; the chain's values are the ones shown. */
export function ApiDiffers({ fields }: { readonly fields: readonly string[] }) {
  if (fields.length === 0) return null;

  return (
    <Chip color="warning" data-testid="op-api-differs" size="sm" variant="soft">
      API differs ({fields.join(", ")}) · chain shown
    </Chip>
  );
}

export function SignableOp({
  network,
  subject,
  differs,
  signs,
}: {
  readonly network: ZalNetwork;
  readonly subject: ChainVerified<ChainOp>;
  /** `opDisagreement(api, subject)`. */
  readonly differs: readonly string[];
  /** The wallet's chain role may sign (approver or admin). */
  readonly signs: boolean;
}) {
  const { op, invoice } = subject;
  const confirm = useConfirmOp({
    network,
    options: feedback("Signature sent"),
  });
  const revoke = useRevokeOp({
    network,
    options: feedback("Signature revoked"),
  });
  const [cosigning, setCosigning] = useState(false);

  return (
    <div className="flex flex-col gap-1" data-testid="op-row">
      <Row
        label={`#${op.opId} ${opLabel(op.call)}`}
        value={`${op.confirmations} of ${op.required}`}
      />
      <Row
        label="Amount"
        value={<Amount unit="USDC (testnet)" value={op.amount} />}
      />
      {op.call.fn === "withdraw" ? (
        <Row label="To" value={shortAddress(op.call.to)} />
      ) : invoice === undefined ? null : (
        <>
          <Row
            label={`Invoice #${invoice.id} face value`}
            value={<Amount unit="USDC (testnet)" value={invoice.faceValue} />}
          />
          <Row label="Invoice status" value={invoice.status} />
          <Row label="Pays" value={recipientText(invoice, network)} />
        </>
      )}
      <ApiDiffers fields={differs} />
      {op.executed ? (
        <Note>Executed</Note>
      ) : op.stale ? (
        <Note>Stale · members or policy changed · submit again</Note>
      ) : !signs ? (
        <Note>Approvers and admins sign</Note>
      ) : (
        <div className="flex flex-wrap gap-2">
          {op.confirmedByMe ? (
            <Button
              isPending={revoke.isPending}
              size="sm"
              variant="tertiary"
              onPress={() => revoke.mutate({ args: [op.opId] })}
            >
              Revoke
            </Button>
          ) : (
            <Button
              isPending={confirm.isPending}
              size="sm"
              onPress={() => confirm.mutate({ args: [op.opId] })}
            >
              Confirm
            </Button>
          )}
          {network.kind === "sandbox" && op.confirmations < op.required ? (
            <Button
              isPending={cosigning}
              size="sm"
              variant="secondary"
              onPress={async () => {
                setCosigning(true);
                await attempt(
                  () => cosignSandbox(op.opId),
                  "The sandbox co-signer signed",
                );
                setCosigning(false);
              }}
            >
              Ask co-signer to sign
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
