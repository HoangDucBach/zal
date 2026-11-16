"use client";

// Scheduled payments on the canvas (ADR 0015): the two palette forms that submit `createSchedule` through the gated
// flow, the Inspector's details with Run now and Cancel, and the clock and keeper status every schedule card reads.

import type { ZalNetwork } from "@/config/chains";
import type { KeeperStatus } from "@/hooks/use-schedules";
import type { ScheduleView, TimeUnit } from "@/lib/canvas/schedules";
import type { CanvasState } from "@/lib/canvas/types";

import { Button, Chip, ListBox, Select } from "@heroui/react";
import { createContext, use, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";

import { SignaturesNote } from "./approval-parts";
import { AddressValue, Field, Note, Row, feedback } from "./form-parts";

import { Amount } from "@/components/ui/amount";
import {
  useCancelSchedule,
  useRunSchedule,
  useSubmitOp,
} from "@/hooks/contracts/canvas-account";
import { allows } from "@/lib/canvas/roles";
import {
  UNIT_SECONDS,
  cadenceText,
  committed,
  isDue,
  scheduleTerms,
  type ScheduleInput,
} from "@/lib/canvas/schedules";
import {
  formatDateTime,
  formatTimeFrom,
  parseUsdc,
  shortAddress,
} from "@/lib/format";

/** Seconds added to a start so it is still ≥ 1 min ahead when the transaction lands. */
const SUBMIT_MARGIN = 15;

/** The chain clock (ticking between reads) and whether a keeper runs due schedules. */
export const ScheduleClock = createContext<{
  readonly now: number;
  readonly keeper: KeeperStatus;
}>({ now: 0, keeper: "offline" });

export const useScheduleClock = () => use(ScheduleClock);

interface FormProps {
  readonly network: ZalNetwork;
  readonly state: CanvasState;
  readonly onDone: () => void;
}

function DurationField({
  label,
  count,
  unit,
  onCount,
  onUnit,
}: {
  readonly label: string;
  readonly count: string;
  readonly unit: TimeUnit;
  readonly onCount: (value: string) => void;
  readonly onUnit: (value: TimeUnit) => void;
}) {
  return (
    <div className="grid grid-cols-2 items-end gap-2">
      <Field label={label} value={count} onChange={onCount} />
      <Select
        aria-label={`${label} unit`}
        className="flex flex-col gap-1"
        value={unit}
        variant="secondary"
        onChange={(next) => onUnit(next === "h" || next === "d" ? next : "min")}
      >
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="min" textValue="min">
              min
              <ListBox.ItemIndicator />
            </ListBox.Item>
            <ListBox.Item id="h" textValue="h">
              h
              <ListBox.ItemIndicator />
            </ListBox.Item>
            <ListBox.Item id="d" textValue="d">
              d
              <ListBox.ItemIndicator />
            </ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  );
}

const seconds = (count: string, unit: TimeUnit): number =>
  /^\d+$/.test(count) ? Number(count) * UNIT_SECONDS[unit] : Number.NaN;

function KeeperNote() {
  const { keeper } = useScheduleClock();

  return keeper === "online" ? (
    <Note>Keeper runs each due run · anyone may run it</Note>
  ) : (
    <Note>Keeper offline · anyone may run a due schedule</Note>
  );
}

function SubmitSchedule({
  network,
  input,
  onDone,
  state,
  label,
}: FormProps & {
  /** The form's input, or the rule a field breaks before it is one. */
  readonly input: ScheduleInput | string;
  readonly label: string;
}) {
  const { now } = useScheduleClock();
  const submit = useSubmitOp({
    network,
    options: feedback("Schedule submitted", onDone),
  });
  const terms =
    typeof input === "string"
      ? ({ ok: false, reason: input } as const)
      : scheduleTerms(input, now + SUBMIT_MARGIN);

  return (
    <>
      {terms.ok ? (
        <>
          <Row
            label="First run"
            value={`${formatDateTime(terms.call.start)}, ${formatTimeFrom(now, terms.call.start)}`}
          />
          <Row
            label={
              terms.call.kind === "transfer"
                ? `Commits = amount × ${terms.call.runs}`
                : "Commits = face value"
            }
            value={<Amount value={terms.policyAmount} />}
          />
          <SignaturesNote
            account={state.account}
            amount={terms.policyAmount}
            network={network}
          />
        </>
      ) : (
        <Note>{terms.reason}</Note>
      )}
      <Button
        isDisabled={!terms.ok}
        isPending={submit.isPending}
        size="sm"
        onPress={() => terms.ok && submit.mutate({ call: terms.call })}
      >
        {label}
      </Button>
      <KeeperNote />
    </>
  );
}

export function SchedulePaymentForm({
  invoiceId,
  ...props
}: FormProps & { readonly invoiceId: bigint }) {
  const [count, setCount] = useState("1");
  const [unit, setUnit] = useState<TimeUnit>("h");
  const invoice = props.state.invoices.find((inv) => inv.id === invoiceId);

  if (invoice === undefined) return <Note>Invoice #{invoiceId} not found</Note>;

  return (
    <div className="flex flex-col gap-2">
      <Row label="Invoice" value={`#${invoice.id}`} />
      <Row label="Pays" value={<Amount value={invoice.faceValue} />} />
      <DurationField
        count={count}
        label="Pay in"
        unit={unit}
        onCount={setCount}
        onUnit={setUnit}
      />
      <SubmitSchedule
        {...props}
        input={{
          kind: "payInvoice",
          invoiceId,
          faceValue: invoice.faceValue,
          startIn: seconds(count, unit),
        }}
        label="Schedule payment"
      />
      <Note>From escrow if locked, else from balance</Note>
    </div>
  );
}

export function ScheduleTransferForm({
  recipient: preset,
  ...props
}: FormProps & { readonly recipient: Address | undefined }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("100");
  const [every, setEvery] = useState("1");
  const [everyUnit, setEveryUnit] = useState<TimeUnit>("min");
  const [runs, setRuns] = useState("3");
  const [startIn, setStartIn] = useState("1");
  const [startUnit, setStartUnit] = useState<TimeUnit>("min");
  const recipient =
    preset ?? (isAddress(to.trim()) ? getAddress(to.trim()) : undefined);
  const value = parseUsdc(amount);
  const input: ScheduleInput | string =
    recipient === undefined
      ? "To: a 0x address"
      : value === undefined
        ? "Amount: zUSDC, up to 6 decimals"
        : {
            kind: "transfer",
            recipient,
            amount: value,
            interval: seconds(every, everyUnit),
            runs: /^\d+$/.test(runs) ? Number(runs) : Number.NaN,
            startIn: seconds(startIn, startUnit),
          };

  return (
    <div className="flex flex-col gap-2">
      {preset === undefined ? (
        <Field label="To" placeholder="0x…" value={to} onChange={setTo} />
      ) : (
        <Row
          label="To"
          value={
            <AddressValue address={preset} label={props.state.labels[preset]} />
          }
        />
      )}
      <Field
        label="Amount per run, zUSDC"
        value={amount}
        onChange={setAmount}
      />
      <DurationField
        count={every}
        label="Every"
        unit={everyUnit}
        onCount={setEvery}
        onUnit={setEveryUnit}
      />
      <Field label="Runs (1–1,000)" value={runs} onChange={setRuns} />
      <DurationField
        count={startIn}
        label="Start in"
        unit={startUnit}
        onCount={setStartIn}
        onUnit={setStartUnit}
      />
      <SubmitSchedule {...props} input={input} label="Schedule transfer" />
    </div>
  );
}

const STATUS_CHIP: Record<
  ScheduleView["status"],
  {
    readonly text: string;
    readonly color: "warning" | "success" | "default" | "danger";
  }
> = {
  pending: { text: "awaiting signatures", color: "warning" },
  active: { text: "active", color: "success" },
  ended: { text: "ended", color: "default" },
  cancelled: { text: "cancelled", color: "danger" },
};

export function ScheduleStatusChip({ view }: { readonly view: ScheduleView }) {
  const { text, color } = STATUS_CHIP[view.status];

  return (
    <Chip color={color} size="sm" variant="soft">
      {text}
    </Chip>
  );
}

/** Anyone may run a due schedule; the button shows only once it is due. */
export function RunScheduleButton({
  network,
  view,
}: {
  readonly network: ZalNetwork;
  readonly view: ScheduleView;
}) {
  const { now } = useScheduleClock();
  const run = useRunSchedule({ network, options: feedback("Schedule ran") });

  if (view.id === undefined || !isDue(view, now)) return null;
  const id = view.id;

  return (
    <Button
      className="nodrag"
      isPending={run.isPending}
      size="sm"
      variant="secondary"
      onPress={() => run.mutate({ args: [id] })}
    >
      Run now
    </Button>
  );
}

export const recipientText = (view: ScheduleView, label: string | undefined) =>
  view.kind === "payInvoice"
    ? `invoice #${view.invoiceId}`
    : (label ??
      (view.recipient === undefined ? "?" : shortAddress(view.recipient)));

export function ScheduleDetails({
  network,
  state,
  view,
  label,
}: {
  readonly network: ZalNetwork;
  readonly state: CanvasState;
  readonly view: ScheduleView;
  readonly label: string | undefined;
}) {
  const { now, keeper } = useScheduleClock();
  const cancel = useCancelSchedule({
    network,
    options: feedback("Schedule cancelled"),
  });
  const live = view.status === "active" || view.status === "pending";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        <ScheduleStatusChip view={view} />
        {view.status === "active" && keeper === "offline" ? (
          <Chip color="warning" size="sm" variant="soft">
            Keeper offline · run manually
          </Chip>
        ) : null}
      </div>
      <Row
        label={view.kind === "payInvoice" ? "Pays" : "To"}
        value={
          view.kind !== "payInvoice" && view.recipient !== undefined ? (
            <AddressValue address={view.recipient} label={label} />
          ) : (
            recipientText(view, label)
          )
        }
      />
      <Row label="Per run" value={<Amount value={view.amount} />} />
      <Row label="Cadence" value={cadenceText(view.interval)} />
      {live ? (
        <>
          <Row
            label="Next run"
            value={`${formatDateTime(view.nextAt)}, ${formatTimeFrom(now, view.nextAt)}`}
          />
          <Row label="Runs left" value={String(view.remaining)} />
          <Row
            label="Committed = per run × left"
            value={<Amount value={committed(view)} />}
          />
        </>
      ) : null}
      {view.status === "pending" ? (
        <Note>Approval node: sign op #{String(view.opId)}</Note>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <RunScheduleButton network={network} view={view} />
        {view.status === "active" &&
        view.id !== undefined &&
        allows(state.account.myRole, "approver") ? (
          <Button
            isPending={cancel.isPending}
            size="sm"
            variant="danger-soft"
            onPress={() =>
              view.id !== undefined && cancel.mutate({ args: [view.id] })
            }
          >
            Cancel
          </Button>
        ) : null}
      </div>
      <Note>runSchedule: anyone · pays only the stored amount and target</Note>
    </div>
  );
}
