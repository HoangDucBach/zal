"use client";

// The Inspector (PRD floating panel): details and the direct actions for the selected node (accept, reject, sign,
// pay), or the form of the palette component the user just picked. Every action is one contract call; the canvas
// redraws from the chain afterwards, never from local state.

import type { ZalNetwork } from "@/config/chains";
import type { CanvasNodeData } from "@/lib/canvas/graph";
import type { CanvasAction } from "@/lib/canvas/palette";
import type {
  CanvasState,
  Invoice,
  PartyRole,
  PendingOp,
} from "@/lib/canvas/types";
import type { ChainVerified } from "@/lib/contracts/chain-verified";

import { Button, Card, Chip, ScrollShadow, Spinner } from "@heroui/react";
import { CloseIcon } from "@solar-icons/react/linear";
import { useState } from "react";
import { isAddressEqual } from "viem";

import {
  ACTION_TITLES,
  ActionForm,
  ApproveForm,
  LiquidityForm,
  SplitForm,
  VaultForm,
  EndpointForm,
} from "./actions";
import { PolicyText, SignaturesNote, WindowUsage } from "./approval-parts";
import {
  AddressValue,
  Note,
  Row,
  Section,
  attempt,
  feedback,
} from "./form-parts";
import { ScheduleDetails } from "./schedule-parts";
import { ApiDiffers, Recipient, SignableOp } from "./signable-op";

import {
  useAcceptRelationship,
  useCancelInvoice,
  useCancelRelationship,
  useRejectRelationship,
  useSubmitOp,
} from "@/hooks/contracts/canvas-account";
import { useChainInvoice, useChainOp } from "@/hooks/contracts/chain-op";
import { useSettleEscrowedInvoice } from "@/hooks/contracts/invoice";
import { isEscrowBacked } from "@/lib/canvas/graph";
import {
  invoiceDisagreement,
  invoiceOf,
  opDisagreement,
  opLabel,
} from "@/lib/canvas/ops";
import { allows } from "@/lib/canvas/roles";
import { Amount, Bps } from "@/components/ui/amount";
import { formatDate, formatDaysFrom } from "@/lib/format";
import { askSandboxToPay } from "@/lib/sandbox/session";

export type InspectorSubject =
  | { readonly kind: "node"; readonly data: CanvasNodeData }
  | { readonly kind: "action"; readonly action: CanvasAction };

interface InspectorProps {
  readonly network: ZalNetwork;
  readonly state: CanvasState;
  readonly subject: InspectorSubject;
  readonly onClose: () => void;
  /** After a palette action's transaction lands. */
  readonly onDone: () => void;
}

interface Ctx {
  readonly network: ZalNetwork;
  readonly state: CanvasState;
}

/**
 * One op waiting at the Approval node, read again from the chain with the invoice it acts on; Confirm signs only
 * that. When the API described the op or its invoice differently, a chip names the fields.
 */
function OpRow({ network, state, op }: Ctx & { readonly op: PendingOp }) {
  const chain = useChainOp({
    payload: {
      network,
      account: state.account.address,
      wallet: state.wallet,
      opId: op.opId,
    },
  });

  if (chain.isPending)
    return (
      <Row
        label={`#${op.opId} ${opLabel(op.call)}`}
        value={<Spinner size="sm" />}
      />
    );
  if (chain.isError)
    return <Note>#{String(op.opId)} · chain read failed · not signable</Note>;
  if (chain.data === null)
    return (
      <div className="flex flex-col gap-1" data-testid="op-row">
        <Row label={`#${op.opId} ${opLabel(op.call)}`} value="—" />
        <Chip color="danger" size="sm" variant="soft">
          Not on-chain · API only
        </Chip>
      </div>
    );
  const { invoice } = chain.data;
  const apiInvoice =
    invoice === undefined
      ? undefined
      : state.invoices.find((i) => i.id === invoice.id);

  return (
    <SignableOp
      differs={opDisagreement({ op, invoice: apiInvoice }, chain.data)}
      network={network}
      signs={allows(state.account.myRole, "approver")}
      subject={chain.data}
    />
  );
}

/** Operations waiting at the Approval node. In the sandbox the co-signer signs on request. */
function OpList({ network, state, ops }: Ctx & { ops: readonly PendingOp[] }) {
  const live = ops.filter((op) => !op.executed);

  if (live.length === 0) return <Note>Nothing to sign</Note>;

  return (
    <div className="flex flex-col gap-2">
      {live.map((op) => (
        <OpRow key={String(op.opId)} network={network} op={op} state={state} />
      ))}
    </div>
  );
}

function CounterpartyDetails({
  network,
  state,
  data,
}: Ctx & { data: Extract<CanvasNodeData, { kind: "counterparty" }> }) {
  const { relationship, counterparty, awaitingMe, label, theirRole } = data;
  const account = state.account.address;
  const accept = useAcceptRelationship({
    network,
    options: feedback("Relationship accepted"),
  });
  const reject = useRejectRelationship({
    network,
    options: feedback("Relationship rejected"),
  });
  const cancel = useCancelRelationship({
    network,
    options: feedback("Proposal cancelled"),
  });
  const iProposed = isAddressEqual(relationship.proposer, account);
  const admin = allows(state.account.myRole, "admin");

  return (
    <div className="flex flex-col gap-2">
      <Row label="Account" value={<AddressValue address={counterparty} />} />
      {label === undefined ? null : <Row label="Name" value={label} />}
      <Row label="Their role" value={theirRole} />
      <Row label="Status" value={relationship.status} />
      {awaitingMe && admin ? (
        <div className="flex gap-2">
          <Button
            isPending={accept.isPending}
            size="sm"
            onPress={() => accept.mutate({ args: [relationship.id] })}
          >
            Accept
          </Button>
          <Button
            isPending={reject.isPending}
            size="sm"
            variant="danger-soft"
            onPress={() => reject.mutate({ args: [relationship.id] })}
          >
            Reject
          </Button>
        </div>
      ) : null}
      {relationship.status === "proposed" && iProposed && admin ? (
        <Button
          isPending={cancel.isPending}
          size="sm"
          variant="danger-soft"
          onPress={() => cancel.mutate({ args: [relationship.id] })}
        >
          Cancel proposal
        </Button>
      ) : null}
      {relationship.status === "active" ? (
        <Note>
          {theirRole === "buyer" ? "You invoice them" : "They invoice you"}
        </Note>
      ) : null}
    </div>
  );
}

/**
 * The invoice panel, drawn from `ZalInvoice.getInvoice` and `ownerOf` because its buttons sign: the API's invoice is
 * only compared, and a chip names what differs.
 */
function InvoiceDetails({
  network,
  state,
  data,
}: Ctx & { data: Extract<CanvasNodeData, { kind: "invoice" }> }) {
  const chain = useChainInvoice({
    payload: { network, id: data.invoice.id },
  });

  if (chain.isPending) return <Spinner size="sm" />;
  if (chain.isError)
    return <Note>Invoice #{String(data.invoice.id)} · chain read failed</Note>;

  return (
    <ChainInvoiceDetails
      differs={invoiceDisagreement(data.invoice, chain.data)}
      invoice={chain.data}
      network={network}
      state={state}
    />
  );
}

function ChainInvoiceDetails({
  network,
  state,
  invoice,
  differs,
}: Ctx & {
  readonly invoice: ChainVerified<Invoice>;
  readonly differs: readonly string[];
}) {
  const myRole: PartyRole = isAddressEqual(invoice.buyer, state.account.address)
    ? "buyer"
    : "seller";
  const escrowBacked = isEscrowBacked(invoice);
  const submit = useSubmitOp({
    network,
    options: feedback("Payment submitted"),
  });
  const cancel = useCancelInvoice({
    network,
    options: feedback("Invoice cancelled"),
  });
  const settle = useSettleEscrowedInvoice({
    network,
    options: feedback("Invoice settled from escrow"),
  });
  const [asking, setAsking] = useState(false);
  const due = state.now >= invoice.dueDate;
  const ops = state.account.ops.filter(
    (op) => !op.executed && invoiceOf(op.call) === invoice.id,
  );
  const admin = allows(state.account.myRole, "admin");
  const signs = allows(state.account.myRole, "approver");

  return (
    <div className="flex flex-col gap-2">
      <Row label="Face value" value={<Amount value={invoice.faceValue} />} />
      <Row
        label="Due"
        value={`${formatDate(invoice.dueDate)}, ${formatDaysFrom(state.now, invoice.dueDate)}`}
      />
      <Row label="Status" value={invoice.status} />
      <Row label="You are the" value={myRole} />
      <Row
        label="Escrow"
        value={
          escrowBacked ? "backed" : invoice.escrowed > 0n ? "partial" : "none"
        }
      />
      <Row
        label="Payment recipient"
        value={<Recipient invoice={invoice} network={network} />}
      />
      <ApiDiffers fields={differs} />
      {invoice.advance === undefined ? null : (
        <>
          <Row
            label="Advance paid"
            value={<Amount value={invoice.advance.principal} />}
          />
          <Row
            label="Pool fee"
            value={<Amount value={invoice.advance.fee} />}
          />
          <Row
            label="Reserve due to the seller"
            value={
              <Amount
                value={
                  invoice.faceValue -
                  invoice.advance.principal -
                  invoice.advance.fee
                }
              />
            }
          />
        </>
      )}

      {signs && myRole === "buyer" && invoice.status === "issued" ? (
        <Section title="Approve">
          <ApproveForm
            budgetId={state.account.budgets[0]?.id ?? 0n}
            invoiceId={invoice.id}
            network={network}
            state={state}
            onDone={() => undefined}
          />
        </Section>
      ) : null}
      {signs && myRole === "buyer" && invoice.status === "approved" ? (
        <Section title="Pay">
          <Button
            isPending={submit.isPending}
            size="sm"
            onPress={() =>
              submit.mutate({
                call: { fn: "payInvoice", invoiceId: invoice.id },
              })
            }
          >
            Pay now
          </Button>
          <SignaturesNote
            account={state.account}
            amount={invoice.faceValue}
            network={network}
          />
          <Note>
            One transaction: pool (if financed) → seller&apos;s Split
            {invoice.escrowed === 0n
              ? " · Escrow to lock · Schedule to pay at a time"
              : ""}
          </Note>
        </Section>
      ) : null}
      {ops.length > 0 ? (
        <Section title="Waiting for signatures">
          <OpList network={network} ops={ops} state={state} />
        </Section>
      ) : null}
      {admin &&
      myRole === "seller" &&
      invoice.status === "issued" &&
      invoice.owner !== undefined ? (
        <Button
          isPending={cancel.isPending}
          size="sm"
          variant="danger-soft"
          onPress={() => cancel.mutate({ args: [invoice.id] })}
        >
          Cancel invoice
        </Button>
      ) : null}
      {myRole === "seller" &&
      invoice.status === "approved" &&
      invoice.advance === undefined ? (
        <Note>Advance: Funding pool (Financing)</Note>
      ) : null}
      {escrowBacked && due && invoice.status === "approved" ? (
        <Button
          isPending={settle.isPending}
          size="sm"
          variant="secondary"
          onPress={() => settle.mutate({ id: invoice.id })}
        >
          Settle from escrow
        </Button>
      ) : null}
      {network.kind === "sandbox" &&
      myRole === "seller" &&
      invoice.status === "approved" ? (
        <Button
          isPending={asking}
          size="sm"
          variant="tertiary"
          onPress={async () => {
            setAsking(true);
            await attempt(
              () => askSandboxToPay(invoice.id),
              "The demo club paid",
            );
            setAsking(false);
          }}
        >
          Ask buyer to pay
        </Button>
      ) : null}
    </div>
  );
}

function PoolDetails({
  network,
  state,
  data,
}: Ctx & { data: Extract<CanvasNodeData, { kind: "pool" }> }) {
  const { pool, financed } = data;

  return (
    <div className="flex flex-col gap-2">
      <Row label="Advance rate" value={<Bps value={pool.advanceRateBps} />} />
      <Row
        label="Annual fee"
        value={
          <>
            <Bps value={pool.annualFeeBps} /> (demo value, TBD)
          </>
        }
      />
      <Row label="Idle cash" value={<Amount value={pool.idleCash} />} />
      <Row label="Total assets" value={<Amount value={pool.totalAssets} />} />
      {financed.map((inv) => (
        <Row
          key={String(inv.id)}
          label={`Invoice #${inv.id}`}
          value={
            <>
              <Amount value={inv.advance?.principal ?? 0n} /> out
            </>
          }
        />
      ))}
      <Section title="Your liquidity">
        <LiquidityForm network={network} state={state} />
      </Section>
    </div>
  );
}

const NODE_TITLES: Record<CanvasNodeData["kind"], string> = {
  account: "Account",
  counterparty: "Counterparty",
  invoice: "Invoice",
  budget: "Budget",
  approval: "Approval",
  split: "Split",
  escrow: "Escrow",
  schedule: "Schedule",
  vault: "Vault",
  pool: "Funding pool",
};

function NodeDetails({ network, state, data }: Ctx & { data: CanvasNodeData }) {
  switch (data.kind) {
    case "account":
      // The Account card holds its own details (ADR 0017); the canvas opens no Inspector for it.
      return null;
    case "split":
      return allows(state.account.myRole, "admin") ? (
        <>
          <SplitForm network={network} state={state} />
          <Section title="Payee endpoint">
            <EndpointForm network={network} state={state} />
          </Section>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {state.account.route.map((leg, i) => (
            <Row
              key={`${leg.kind}-${i}`}
              label={
                leg.kind === "transfer"
                  ? "Transfer"
                  : leg.kind === "vault"
                    ? "Vault"
                    : "Hold"
              }
              value={
                leg.kind === "transfer" ? (
                  <span className="inline-flex items-center gap-1">
                    <AddressValue address={leg.target} />
                    <Bps value={leg.bps} />
                  </span>
                ) : (
                  <Bps value={leg.bps} />
                )
              }
            />
          ))}
          <Row
            label="Payee endpoint"
            value={state.account.endpointPublic ? "public" : "private"}
          />
          <Note>Admins change the Split</Note>
        </div>
      );
    case "counterparty":
      return (
        <CounterpartyDetails data={data} network={network} state={state} />
      );
    case "invoice":
      return <InvoiceDetails data={data} network={network} state={state} />;
    case "approval":
      return (
        <div className="flex flex-col gap-2">
          <Row
            label="Signatures needed"
            value={<PolicyText account={state.account} />}
          />
          <Row
            label="Allowance"
            value={<WindowUsage account={state.account} network={network} />}
          />
          <OpList network={network} ops={state.account.ops} state={state} />
        </div>
      );
    case "budget":
      return (
        <div className="flex flex-col gap-2">
          <Row label="Limit" value={<Amount value={data.budget.limit} />} />
          <Row
            label="Reserved this period"
            value={<Amount value={data.budget.used} />}
          />
          <Row
            label="Period started"
            value={formatDate(data.budget.periodStart)}
          />
          <Note>Budget → invoice you pay: approve against it</Note>
        </div>
      );
    case "escrow":
      return (
        <div className="flex flex-col gap-2">
          <Row
            label={`Locked for invoice #${data.invoice.id}`}
            value={<Amount value={data.invoice.escrowed} />}
          />
          <Note>After the due date, anyone can settle</Note>
        </div>
      );
    case "schedule":
      return (
        <ScheduleDetails
          label={data.label}
          network={network}
          state={state}
          view={data.schedule}
        />
      );
    case "vault":
      return allows(state.account.myRole, "admin") ? (
        <VaultForm network={network} state={state} />
      ) : (
        <Row
          label="In vault"
          value={<Amount value={state.account.vaultAssets} />}
        />
      );
    case "pool":
      return <PoolDetails data={data} network={network} state={state} />;
  }
}

export function Inspector({
  network,
  state,
  subject,
  onClose,
  onDone,
}: InspectorProps) {
  return (
    <Card className="min-h-0 w-80 gap-3 border border-border bg-surface/75 p-3 shadow-md backdrop-blur-2xl">
      <Card.Header className="flex flex-row items-center justify-between gap-2 border-b border-separator pb-2">
        <Card.Title className="text-sm">
          {subject.kind === "node"
            ? NODE_TITLES[subject.data.kind]
            : ACTION_TITLES[subject.action.kind]}
        </Card.Title>
        <div className="flex items-center gap-1">
          {network.kind === "sandbox" ? (
            <Chip color="warning" size="sm" variant="soft">
              Sandbox
            </Chip>
          ) : null}
          <Button
            isIconOnly
            aria-label="Close inspector"
            size="sm"
            variant="ghost"
            onPress={onClose}
          >
            <CloseIcon aria-hidden size={14} />
          </Button>
        </div>
      </Card.Header>
      <Card.Content className="min-h-0">
        <ScrollShadow className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {subject.kind === "node" ? (
            <NodeDetails data={subject.data} network={network} state={state} />
          ) : (
            <ActionForm
              action={subject.action}
              network={network}
              state={state}
              onDone={onDone}
            />
          )}
        </ScrollShadow>
      </Card.Content>
    </Card>
  );
}
