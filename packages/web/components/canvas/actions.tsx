"use client";

// The form behind each palette component (story C2). A palette click or drop picks a `CanvasAction`, and the
// Inspector renders its form here, prefilled. Each submit is one contract call; the canvas then redraws from the
// chain, so a form never draws its own result.

import type { ZalNetwork } from "@/config/chains";
import type { CanvasAction } from "@/lib/canvas/palette";
import type { CanvasState } from "@/lib/canvas/types";
import type { PartnerRole } from "@/lib/sandbox/partners";

import {
  Alert,
  Button,
  Chip,
  FieldError,
  Input,
  Label,
  ListBox,
  Select,
  Switch,
  TextField,
  toast,
} from "@heroui/react";
import { LinkIcon } from "@solar-icons/react/linear";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useConfig } from "wagmi";
import { signTypedData } from "wagmi/actions";
import {
  getAddress,
  isAddress,
  keccak256,
  toHex,
  zeroAddress,
  type Address,
} from "viem";

import { SignaturesNote } from "./approval-parts";
import {
  AddressValue,
  Field,
  Note,
  Row,
  Section,
  attempt,
  feedback,
} from "./form-parts";
import { SchedulePaymentForm, ScheduleTransferForm } from "./schedule-parts";

import {
  useCounterpartyCheck,
  useCreateAccount,
} from "@/hooks/contracts/factory";
import {
  useIssueInvoice,
  useProposeRelationship,
  useRejectInvoice,
  useRequestAdvance,
  useSetBudget,
  useSetEndpointPublic,
  useSetPolicy,
  useSetRoute,
  useSubmitOp,
  useVaultDeposit,
  useVaultRedeem,
} from "@/hooks/contracts/canvas-account";
import {
  useAdvanceQuote,
  useLpDeposit,
  useLpWithdraw,
} from "@/hooks/contracts/pool";
import { useMintTestUsdc } from "@/hooks/contracts/usdc";
import { api, apiUrl } from "@/lib/api/client";
import {
  INVITE_DOMAIN,
  INVITE_TYPES,
  invitePath,
  newInvite,
} from "@/lib/api/invite";
import { advanceEligibility } from "@/lib/canvas/advance";
import {
  type DraftLeg,
  MAX_SPLIT_LEGS,
  legBps,
  legProblem,
  splitProblem,
  withKind,
} from "@/lib/canvas/split";
import { Amount, Bps, amountText, bpsText } from "@/components/ui/amount";
import { parseUsdc, shortAddress } from "@/lib/format";
import { SANDBOX_NAMES } from "@/lib/sandbox/config";
import { toAppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";
import { createDemoCounterparty } from "@/lib/sandbox/session";

const DAY = 86_400;

interface FormProps {
  readonly network: ZalNetwork;
  readonly state: CanvasState;
  /** Called once the action's transaction is confirmed. */
  readonly onDone: () => void;
}

export const ACTION_TITLES: Record<CanvasAction["kind"], string> = {
  createAccount: "New canvas",
  proposeRelationship: "New counterparty",
  publishEndpoint: "Payee endpoint",
  issueInvoice: "New invoice",
  addBudget: "New budget",
  approveInvoice: "Approval",
  setPolicy: "Approval policy",
  schedulePayment: "Scheduled payment",
  scheduleTransfer: "Scheduled transfer",
  setRoute: "Split",
  escrow: "Escrow",
  vaultDeposit: "Vault",
  advance: "Advance",
  provideLiquidity: "Pool liquidity",
};

function CreateAccountForm({ network, state, onDone }: FormProps) {
  const create = useCreateAccount({
    network,
    options: feedback("Canvas created", onDone),
  });

  return (
    <div className="flex flex-col gap-2">
      <Row
        label="CanvasAccount"
        value={<AddressValue address={state.account.address} />}
      />
      <Note>Owned by your wallet</Note>
      <Button
        isPending={create.isPending}
        size="sm"
        onPress={() => create.mutate()}
      >
        Create my canvas
      </Button>
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  readonly value: "seller" | "buyer";
  readonly onChange: (value: "seller" | "buyer") => void;
}) {
  return (
    <Select
      className="flex flex-col gap-1"
      value={value}
      onChange={(next) => onChange(next === "buyer" ? "buyer" : "seller")}
    >
      <Label className="text-xs">You are the</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="seller" textValue="Seller">
            Seller (they pay you)
            <ListBox.ItemIndicator />
          </ListBox.Item>
          <ListBox.Item id="buyer" textValue="Buyer">
            Buyer (you pay them)
            <ListBox.ItemIndicator />
          </ListBox.Item>
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** Sandbox only: seeds "Demo partner N", so there is always someone new to relate to. */
function DemoCounterparty({
  onCreated,
}: {
  readonly onCreated: (account: Address, role: PartnerRole) => void;
}) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState<PartnerRole>();
  const create = (role: PartnerRole) => {
    setCreating(role);
    void attempt(async () => {
      const account = await createDemoCounterparty(role);

      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
      onCreated(account, role);
    }, "Demo counterparty created").finally(() => setCreating(undefined));
  };

  return (
    <Section title="Demo counterparty">
      <div className="flex gap-2">
        <Button
          className="flex-1"
          isDisabled={creating !== undefined}
          isPending={creating === "buyer"}
          size="sm"
          variant="secondary"
          onPress={() => create("buyer")}
        >
          Add buyer
        </Button>
        <Button
          className="flex-1"
          isDisabled={creating !== undefined}
          isPending={creating === "seller"}
          size="sm"
          variant="secondary"
          onPress={() => create("seller")}
        >
          Add seller
        </Button>
      </div>
      <Note>Bot · accepts and trades</Note>
    </Section>
  );
}

/**
 * Invite by link (PRD R1): the proposer's Admin signs the EIP-712 Invite, the API stores it, and the link lets
 * someone without a canvas create one and accept in one transaction. Live only: the sandbox has its demo bots.
 */
function InviteLink({
  network,
  state,
  myRole,
}: Omit<FormProps, "onDone"> & { readonly myRole: "seller" | "buyer" }) {
  const config = useConfig();
  const [link, setLink] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const isAdmin = state.account.myRole === "admin";

  const create = async () => {
    setBusy(true);
    try {
      const invite = newInvite(
        state.account.address,
        myRole === "seller" ? 1 : 0,
        state.now,
      );
      const signature = await signTypedData(config, {
        domain: {
          ...INVITE_DOMAIN,
          chainId: network.chain.id,
          verifyingContract: network.addresses.registry,
        },
        types: INVITE_TYPES,
        primaryType: "Invite",
        message: invite,
      });
      const stored = await api.createInvite({
        ...invite,
        deadline: Number(invite.deadline),
        signature,
      });
      const url = `${window.location.origin}${invitePath(stored.invite.id)}`;

      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Invite link copied");
      } catch {
        toast.success("Invite link ready");
      }
    } catch (error) {
      const appError = toAppError(error);

      if (appError.kind !== "wallet-rejected") toast.danger(appError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Invite by link">
      <Button
        isDisabled={!isAdmin}
        isPending={busy}
        size="sm"
        variant="secondary"
        onPress={() => void create()}
      >
        <LinkIcon aria-hidden size={14} />
        Copy invite link
      </Button>
      {link === undefined ? (
        <Note>
          {isAdmin
            ? `Signed, no gas · they join as your ${myRole === "seller" ? "buyer" : "seller"} · valid 7 days`
            : "Only an Admin signs invites"}
        </Note>
      ) : (
        <TextField isReadOnly className="flex flex-col gap-1" value={link}>
          <Label className="text-xs">Invite link · ghost until redeemed</Label>
          <Input data-testid="invite-link" variant="secondary" />
        </TextField>
      )}
    </Section>
  );
}

function ProposeForm({ network, state, onDone }: FormProps) {
  const propose = useProposeRelationship({
    network,
    options: feedback("Relationship proposed", onDone),
  });
  const [counterparty, setCounterparty] = useState("");
  const [myRole, setMyRole] = useState<"seller" | "buyer">("seller");
  const pasted = isAddress(counterparty, { strict: false })
    ? getAddress(counterparty)
    : undefined;
  const check = useCounterpartyCheck({
    payload: {
      network,
      address: pasted ?? zeroAddress,
      self: state.account.address,
    },
    options: { enabled: pasted !== undefined },
  });
  const verdict = pasted === undefined ? undefined : check.data;
  const [buyer, seller] =
    myRole === "seller"
      ? [pasted, state.account.address]
      : [state.account.address, pasted];
  const alreadyRelated = state.relationships.some(
    (rel) =>
      (rel.status === "active" || rel.status === "proposed") &&
      rel.buyer === buyer &&
      rel.seller === seller,
  );
  const known = Object.entries(state.labels).filter(
    ([address, name]) =>
      name !== SANDBOX_NAMES.cosigner &&
      !state.relationships.some(
        (rel) =>
          (rel.status === "active" || rel.status === "proposed") &&
          (rel.buyer === address || rel.seller === address),
      ),
  );

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Their canvas (account) address"
        placeholder="0x…"
        value={counterparty}
        onChange={setCounterparty}
      />
      {verdict?.kind === "wallet" && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>That is a wallet, not a canvas</Alert.Title>
            <Alert.Description>
              Relationships link canvases · this wallet owns one
            </Alert.Description>
            <Button
              className="mt-2"
              size="sm"
              variant="secondary"
              onPress={() => setCounterparty(verdict.canvas)}
            >
              Use their canvas {shortAddress(verdict.canvas)}
            </Button>
          </Alert.Content>
        </Alert>
      )}
      {verdict?.kind === "not-canvas" && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Not a Zal canvas</Alert.Title>
            <Alert.Description>
              Use their canvas address, or invite them
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {verdict?.kind === "self" && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>That is your own canvas</Alert.Title>
            <Alert.Description>
              Use your counterparty&apos;s canvas
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {verdict?.kind === "canvas" && alreadyRelated && (
        <Note>Already proposed or active in this direction</Note>
      )}
      {known.map(([address, name]) => (
        <Button
          key={address}
          size="sm"
          variant="tertiary"
          onPress={() => setCounterparty(address)}
        >
          Use {name.toLowerCase()}
        </Button>
      ))}
      <RoleSelect value={myRole} onChange={setMyRole} />
      <Button
        isDisabled={
          pasted === undefined || verdict?.kind !== "canvas" || alreadyRelated
        }
        isPending={
          propose.isPending || (pasted !== undefined && check.isFetching)
        }
        size="sm"
        onPress={() =>
          pasted !== undefined &&
          propose.mutate({
            args: [pasted, myRole === "seller" ? 1 : 0, 0n],
          })
        }
      >
        Propose relationship
      </Button>
      <Note>Ghost on both canvases until they accept</Note>
      {network.kind === "live" && apiUrl !== undefined ? (
        <InviteLink myRole={myRole} network={network} state={state} />
      ) : null}
      {network.kind === "sandbox" && (
        <DemoCounterparty
          onCreated={(account, role) => {
            setCounterparty(account);
            setMyRole(role === "buyer" ? "seller" : "buyer");
          }}
        />
      )}
    </div>
  );
}

export function EndpointForm({
  network,
  state,
  onDone,
}: Omit<FormProps, "onDone"> & { readonly onDone?: () => void }) {
  const setPublic = useSetEndpointPublic({
    network,
    options: feedback("Endpoint visibility saved", onDone),
  });

  return (
    <div className="flex flex-col gap-2">
      <Switch
        isDisabled={setPublic.isPending}
        isSelected={state.account.endpointPublic}
        size="sm"
        onChange={(on) => setPublic.mutate({ args: [on] })}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          Public: buyers see your Split
        </Switch.Content>
      </Switch>
      <Note>Private: hidden in Zal · readable on-chain</Note>
    </div>
  );
}

function IssueInvoiceForm({
  network,
  state,
  onDone,
  relationshipId,
}: FormProps & { readonly relationshipId: bigint }) {
  const issue = useIssueInvoice({
    network,
    options: feedback("Invoice issued", onDone),
  });
  const [amount, setAmount] = useState("5000");
  const [days, setDays] = useState("30");
  const face = parseUsdc(amount);
  const validDays = /^\d+$/.test(days) && Number(days) >= 1;

  return (
    <div className="flex flex-col gap-2">
      <Row label="Relationship" value={`#${relationshipId}`} />
      <Field label="Face value, zUSDC" value={amount} onChange={setAmount} />
      <Field label="Due in days" value={days} onChange={setDays} />
      <Button
        isDisabled={face === undefined || face === 0n || !validDays}
        isPending={issue.isPending}
        size="sm"
        onPress={() =>
          face !== undefined &&
          issue.mutate({
            args: [
              relationshipId,
              face,
              BigInt(state.now + Number(days) * DAY),
              keccak256(
                toHex(`zal invoice ${relationshipId} ${face} ${state.now}`),
              ),
            ],
          })
        }
      >
        Issue invoice
      </Button>
      <Note>Ghost until the buyer approves</Note>
    </div>
  );
}

function BudgetForm({ network, state, onDone }: FormProps) {
  const setBudget = useSetBudget({
    network,
    options: feedback("Budget saved", onDone),
  });
  const [limit, setLimit] = useState("5000");
  const value = parseUsdc(limit);
  const nextId =
    state.account.budgets.reduce((max, b) => (b.id > max ? b.id : max), 0n) +
    1n;

  return (
    <div className="flex flex-col gap-2">
      <Row label="Budget" value={`#${nextId}`} />
      <Field
        label="Limit per 30 days, USDC"
        value={limit}
        onChange={setLimit}
      />
      <Button
        isDisabled={value === undefined || value === 0n}
        isPending={setBudget.isPending}
        size="sm"
        onPress={() =>
          value !== undefined &&
          setBudget.mutate({
            args: [nextId, value, 0n],
          })
        }
      >
        Add budget
      </Button>
      <Note>Approval reserves face value · payment does not charge again</Note>
    </div>
  );
}

export function ApproveForm({
  network,
  state,
  onDone,
  invoiceId,
  budgetId,
}: FormProps & { readonly invoiceId: bigint; readonly budgetId: bigint }) {
  const submit = useSubmitOp({
    network,
    options: feedback("Submitted for approval", onDone),
  });
  const reject = useRejectInvoice({
    network,
    options: feedback("Invoice rejected", onDone),
  });
  const [budget, setBudget] = useState(String(budgetId));
  const invoice = state.invoices.find((inv) => inv.id === invoiceId);

  return (
    <div className="flex flex-col gap-2">
      {invoice === undefined ? null : (
        <Row
          label={`Invoice #${invoiceId}`}
          value={<Amount value={invoice.faceValue} />}
        />
      )}
      <Select
        className="flex flex-col gap-1"
        value={budget}
        onChange={(value) => setBudget(String(value))}
      >
        <Label className="text-xs">Charge to budget</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="0" textValue="No budget">
              No budget
              <ListBox.ItemIndicator />
            </ListBox.Item>
            {state.account.budgets.map((b) => (
              <ListBox.Item
                key={String(b.id)}
                id={String(b.id)}
                textValue={`Budget #${b.id}`}
              >
                Budget #{String(b.id)} (<Amount value={b.limit - b.used} />{" "}
                left)
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <div className="flex gap-2">
        <Button
          isPending={submit.isPending}
          size="sm"
          onPress={() =>
            submit.mutate({
              call: {
                fn: "approveInvoice",
                invoiceId,
                budgetId: BigInt(budget),
              },
            })
          }
        >
          Approve
        </Button>
        <Button
          isPending={reject.isPending}
          size="sm"
          variant="danger-soft"
          onPress={() => reject.mutate({ args: [invoiceId] })}
        >
          Reject
        </Button>
      </div>
      <SignaturesNote
        account={state.account}
        amount={invoice?.faceValue}
        network={network}
      />
    </div>
  );
}

function PolicyForm({ network, state, onDone }: FormProps) {
  const setPolicy = useSetPolicy({
    network,
    options: feedback("Policy saved", onDone),
  });
  const approvers = state.account.members.filter(
    (m) => m.role === "admin" || m.role === "approver",
  );
  const [threshold, setThreshold] = useState(
    String(Math.max(2, state.account.threshold)),
  );
  const [limit, setLimit] = useState(
    network.kind === "sandbox"
      ? "500"
      : amountText(state.account.approvalLimit, { unit: null }),
  );
  const value = parseUsdc(limit);
  const count = /^\d+$/.test(threshold) ? Number(threshold) : 0;

  return (
    <div className="flex flex-col gap-2">
      {approvers.map((m) => (
        <Row
          key={m.address}
          label={m.role}
          value={
            <AddressValue address={m.address} label={state.labels[m.address]} />
          }
        />
      ))}
      <Field
        label={`Signatures required (of ${approvers.length})`}
        value={threshold}
        onChange={setThreshold}
      />
      <Field
        label="One signature up to, per 24 h, zUSDC"
        value={limit}
        onChange={setLimit}
      />
      {network.kind === "sandbox" ? (
        <Chip color="warning" size="sm" variant="soft">
          500 USDC is a sandbox value
        </Chip>
      ) : null}
      <Button
        isDisabled={
          value === undefined || count < 1 || count > approvers.length
        }
        isPending={setPolicy.isPending}
        size="sm"
        onPress={() =>
          value !== undefined &&
          setPolicy.mutate({
            args: [count, value],
          })
        }
      >
        Save policy
      </Button>
      <Note>Allowance shared by the whole account · rolling 24 h</Note>
      <Note>Saving cancels operations awaiting signatures</Note>
    </div>
  );
}

/** A leg to the Vault, 10% taken from the largest leg that has it. */
function withVaultLeg(legs: readonly DraftLeg[], vault: string): DraftLeg[] {
  if (legs.some((leg) => leg.kind === "vault")) return [...legs];
  const largest = legs.reduce(
    (best, leg, index) =>
      Number(leg.percent) > Number(legs[best]?.percent ?? -1) ? index : best,
    0,
  );
  const room = Number(legs[largest]?.percent ?? 0) >= 10;

  return [
    { kind: "vault", target: vault, percent: room ? "10" : "0" },
    ...legs.map((leg, index) =>
      room && index === largest
        ? { ...leg, percent: String(Number(leg.percent) - 10) }
        : leg,
    ),
  ];
}

export function SplitForm({
  network,
  state,
  onDone,
  vaultLeg = false,
}: Omit<FormProps, "onDone"> & {
  readonly onDone?: () => void;
  /** Opened by connecting the Split to a Vault: start with a leg to it. */
  readonly vaultLeg?: boolean;
}) {
  const { account } = state;
  const setRoute = useSetRoute({
    network,
    options: feedback("Split saved", onDone),
  });
  const [legs, setLegs] = useState<DraftLeg[]>(() => {
    const current: DraftLeg[] =
      account.route.length > 0
        ? account.route.map((leg) => ({
            kind: leg.kind,
            target: leg.target,
            percent: String(leg.bps / 100),
          }))
        : [
            { kind: "vault", target: network.addresses.vault, percent: "10" },
            { kind: "hold", target: zeroAddress, percent: "90" },
          ];

    return vaultLeg ? withVaultLeg(current, network.addresses.vault) : current;
  });
  const bps = legs.map((leg) => legBps(leg) ?? 0);
  const total = bps.reduce((a, b) => a + b, 0);
  const problem = splitProblem(legs);
  // A recipient problem is already under its field.
  const shownInline = legs.some(
    (leg) => leg.kind === "transfer" && legProblem(leg) === problem,
  );
  const update = (index: number, patch: Partial<DraftLeg>) =>
    setLegs((current) =>
      current.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)),
    );

  return (
    <div className="flex flex-col gap-3">
      <Note>leg = amount × % · last leg takes remainder</Note>
      {legs.map((leg, index) => (
        <div key={index} className="flex flex-col gap-1">
          <div className="flex items-end gap-2">
            <Select
              aria-label="Leg kind"
              className="flex-1"
              value={leg.kind}
              onChange={(value) =>
                setLegs((current) =>
                  current.map((l, i) =>
                    i === index
                      ? withKind(
                          l,
                          value === "vault" || value === "transfer"
                            ? value
                            : "hold",
                          network.addresses.vault,
                        )
                      : l,
                  ),
                )
              }
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="hold" textValue="Hold">
                    Hold
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  <ListBox.Item id="vault" textValue="Vault">
                    Vault
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  <ListBox.Item id="transfer" textValue="Transfer">
                    Transfer
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <TextField
              aria-label="Percent"
              className="w-20"
              value={leg.percent}
              onChange={(percent) => update(index, { percent })}
            >
              <Input variant="secondary" />
            </TextField>
            <Button
              isIconOnly
              aria-label="Remove leg"
              size="sm"
              variant="ghost"
              onPress={() =>
                setLegs((current) => current.filter((_, i) => i !== index))
              }
            >
              ×
            </Button>
          </div>
          {leg.kind === "transfer" ? (
            <TextField
              className="flex flex-col gap-1"
              isInvalid={legProblem(leg) !== undefined}
              value={leg.target}
              onChange={(target) => update(index, { target })}
            >
              <Label className="text-xs">Recipient</Label>
              <Input placeholder="0x…" variant="secondary" />
              <FieldError>{legProblem(leg)}</FieldError>
            </TextField>
          ) : null}
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Button
          isDisabled={legs.length >= MAX_SPLIT_LEGS}
          size="sm"
          variant="tertiary"
          onPress={() =>
            setLegs((current) => [
              ...current,
              { kind: "hold", target: zeroAddress, percent: "0" },
            ])
          }
        >
          Add leg
        </Button>
        <Chip
          color={total === 10_000 ? "success" : "danger"}
          size="sm"
          variant="soft"
        >
          total {bpsText(total)}
        </Chip>
      </div>
      {problem === undefined || shownInline ? null : <Note>{problem}</Note>}
      <Button
        isDisabled={problem !== undefined}
        isPending={setRoute.isPending}
        size="sm"
        onPress={() =>
          setRoute.mutate({
            args: [
              legs.map((leg, i) => ({
                kind: leg.kind === "hold" ? 0 : leg.kind === "transfer" ? 1 : 2,
                target:
                  leg.kind === "hold" ? zeroAddress : getAddress(leg.target),
                bps: bps[i] ?? 0,
              })),
            ],
          })
        }
      >
        Save Split
      </Button>
    </div>
  );
}

function EscrowForm({
  network,
  state,
  onDone,
  invoiceId,
}: FormProps & { readonly invoiceId: bigint }) {
  const submit = useSubmitOp({
    network,
    options: feedback("Escrow submitted", onDone),
  });
  const invoice = state.invoices.find((inv) => inv.id === invoiceId);

  return (
    <div className="flex flex-col gap-2">
      {invoice === undefined ? null : (
        <Row label="Locks" value={<Amount value={invoice.faceValue} />} />
      )}
      <Button
        isPending={submit.isPending}
        size="sm"
        onPress={() =>
          submit.mutate({
            call: { fn: "escrowInvoice", invoiceId },
          })
        }
      >
        Escrow now
      </Button>
      <SignaturesNote
        account={state.account}
        amount={invoice?.faceValue}
        network={network}
      />
      <Note>
        Locks face value · anyone settles once due · risk-free advance
      </Note>
    </div>
  );
}

export function VaultForm({
  network,
  state,
  onDone,
}: Omit<FormProps, "onDone"> & { readonly onDone?: () => void }) {
  const deposit = useVaultDeposit({
    network,
    options: feedback("Deposited into the vault", onDone),
  });
  const redeem = useVaultRedeem({
    network,
    options: feedback("Redeemed from the vault"),
  });
  const [amount, setAmount] = useState("100");
  const value = parseUsdc(amount);
  const { account } = state;

  return (
    <div className="flex flex-col gap-2">
      <Row label="In vault" value={<Amount value={account.vaultAssets} />} />
      <Field label="Deposit, USDC" value={amount} onChange={setAmount} />
      <div className="flex gap-2">
        <Button
          isDisabled={value === undefined || value === 0n}
          isPending={deposit.isPending}
          size="sm"
          onPress={() =>
            value !== undefined &&
            deposit.mutate({
              args: [network.addresses.vault, value],
            })
          }
        >
          Deposit
        </Button>
        <Button
          isDisabled={account.vaultShares === 0n}
          isPending={redeem.isPending}
          size="sm"
          variant="secondary"
          onPress={() =>
            redeem.mutate({
              args: [network.addresses.vault, account.vaultShares],
            })
          }
        >
          Redeem all
        </Button>
      </div>
    </div>
  );
}

function AdvanceForm({
  network,
  state,
  onDone,
  invoiceId,
}: FormProps & { readonly invoiceId: bigint }) {
  const advance = useRequestAdvance({
    network,
    options: feedback("Advance received", onDone),
  });
  const invoice = state.invoices.find((inv) => inv.id === invoiceId);
  const eligibility =
    invoice === undefined
      ? { ok: false as const, reason: "Invoice not found." }
      : advanceEligibility(invoice, state.pool, state.now);
  const quote = useAdvanceQuote({
    payload: {
      network,
      faceValue: invoice?.faceValue ?? 0n,
      dueDate: invoice?.dueDate ?? 0,
    },
    options: { enabled: eligibility.ok },
  });

  return (
    <div className="flex flex-col gap-2">
      {quote.data === undefined ? null : (
        <>
          <Row
            label="Advance now"
            value={<Amount value={quote.data.principal} />}
          />
          <Row
            label="Fee (fixed now)"
            value={<Amount value={quote.data.fee} />}
          />
          <Row
            label="Reserve at payment"
            value={<Amount value={quote.data.reserve} />}
          />
        </>
      )}
      <Note>
        advance = <Bps value={state.pool.advanceRateBps} /> × face · fee fixed
        now · reserve = face − advance − fee
      </Note>
      <Button
        isDisabled={!eligibility.ok}
        isPending={advance.isPending}
        size="sm"
        onPress={() => advance.mutate({ args: [invoiceId] })}
      >
        Request advance
      </Button>
      <Note>
        {eligibility.ok
          ? eligibility.path === "escrow"
            ? "Escrow-backed: no credit risk · pool takes NFT and payment"
            : "Buyer credit line · pool takes NFT and payment"
          : eligibility.reason}
      </Note>
    </div>
  );
}

export function LiquidityForm({
  network,
  state,
  onDone,
}: Omit<FormProps, "onDone"> & { readonly onDone?: () => void }) {
  const deposit = useLpDeposit({
    network,
    options: feedback("Deposited into the funding pool", onDone),
  });
  const withdraw = useLpWithdraw({
    network,
    options: feedback("Withdrawn to your wallet"),
  });
  const mint = useMintTestUsdc({
    network,
    options: feedback("Minted 1,000 zUSDC"),
  });
  const [amount, setAmount] = useState("1000");
  const value = parseUsdc(amount);
  const { lp } = state;

  return (
    <div className="flex flex-col gap-2">
      <Row label="Your wallet" value={<Amount value={lp.walletUsdc} />} />
      <Row label="Your pool position" value={<Amount value={lp.assets} />} />
      <Row label="Withdrawable now" value={<Amount value={lp.maxWithdraw} />} />
      <Field label="Amount, zUSDC" value={amount} onChange={setAmount} />
      <div className="flex gap-2">
        <Button
          isDisabled={
            value === undefined || value === 0n || value > lp.walletUsdc
          }
          isPending={deposit.isPending}
          size="sm"
          onPress={() =>
            value !== undefined &&
            deposit.mutate({ amount: value, allowance: lp.allowance })
          }
        >
          Deposit
        </Button>
        <Button
          isDisabled={
            value === undefined || value === 0n || value > lp.maxWithdraw
          }
          isPending={withdraw.isPending}
          size="sm"
          variant="secondary"
          onPress={() =>
            value !== undefined && withdraw.mutate({ amount: value })
          }
        >
          Withdraw
        </Button>
        <Button
          isDisabled={lp.maxWithdraw === 0n}
          isPending={withdraw.isPending}
          size="sm"
          variant="tertiary"
          onPress={() => withdraw.mutate({ amount: lp.maxWithdraw })}
        >
          Withdraw all
        </Button>
      </div>
      {lp.walletUsdc === 0n ? (
        <Button
          isPending={mint.isPending}
          size="sm"
          variant="tertiary"
          onPress={() => mint.mutate({ to: "wallet", amount: 1_000_000_000n })}
        >
          Mint 1,000 zUSDC
        </Button>
      ) : null}
      <Note>
        Earns the advance fee · lent-out cash withdraws after repayment
      </Note>
    </div>
  );
}

export function ActionForm({
  action,
  ...props
}: FormProps & { readonly action: CanvasAction }) {
  switch (action.kind) {
    case "createAccount":
      return <CreateAccountForm {...props} />;
    case "proposeRelationship":
      return <ProposeForm {...props} />;
    case "publishEndpoint":
      return <EndpointForm {...props} />;
    case "issueInvoice":
      return (
        <IssueInvoiceForm {...props} relationshipId={action.relationshipId} />
      );
    case "addBudget":
      return <BudgetForm {...props} />;
    case "approveInvoice":
      return (
        <ApproveForm
          {...props}
          budgetId={action.budgetId}
          invoiceId={action.invoiceId}
        />
      );
    case "setPolicy":
      return <PolicyForm {...props} />;
    case "schedulePayment":
      return <SchedulePaymentForm {...props} invoiceId={action.invoiceId} />;
    case "scheduleTransfer":
      return <ScheduleTransferForm {...props} recipient={action.recipient} />;
    case "setRoute":
      return (
        <>
          <SplitForm {...props} vaultLeg={action.vaultLeg} />
          <Section title="Payee endpoint">
            <EndpointForm network={props.network} state={props.state} />
          </Section>
        </>
      );
    case "escrow":
      return <EscrowForm {...props} invoiceId={action.invoiceId} />;
    case "vaultDeposit":
      return <VaultForm {...props} />;
    case "advance":
      return <AdvanceForm {...props} invoiceId={action.invoiceId} />;
    case "provideLiquidity":
      return <LiquidityForm {...props} />;
  }
}
