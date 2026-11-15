// Scheduled payments as the canvas shows them (ADR 0015): the schedules an account stores, plus the ones a pending
// `createSchedule` op would store once it has its signatures. Pure, so the timing rules the chain enforces
// (ZR-SCH-02) are checked here before a wallet prompt, and tested without a browser.

import type { AccountState, GatedCall, ScheduleKind, Schedule } from "./types";
import type { Address } from "viem";

/** `pending`: a createSchedule op waits for signatures (ghost). `ended`: every run done. */
export type ScheduleStatus = "pending" | "active" | "ended" | "cancelled";

export interface ScheduleView {
  /** The canvas node id. */
  readonly nodeId: string;
  /** The on-chain id; `undefined` while the op is pending. */
  readonly id: bigint | undefined;
  /** The createSchedule op, while it waits for signatures. */
  readonly opId: bigint | undefined;
  readonly status: ScheduleStatus;
  readonly kind: ScheduleKind;
  readonly recipient: Address | undefined;
  readonly invoiceId: bigint | undefined;
  /** What one run pays. */
  readonly amount: bigint;
  /** When the next run is allowed, or the last run's due time once ended. */
  readonly nextAt: number;
  /** Seconds between runs; 0 runs once. */
  readonly interval: number;
  readonly remaining: number;
}

export const MIN_SCHEDULE_DELAY = 60;
export const MIN_SCHEDULE_INTERVAL = 60;
export const MAX_SCHEDULE_RUNS = 1000;

export const scheduleNodeId = (id: bigint): string => `schedule-${id}`;
export const pendingScheduleNodeId = (opId: bigint): string =>
  `schedule-op-${opId}`;

function statusOf(schedule: Schedule): ScheduleStatus {
  if (schedule.active) return "active";

  return schedule.remaining === 0 ? "ended" : "cancelled";
}

/** On-chain schedules by id, then the createSchedule ops still collecting signatures. */
export function scheduleViews(account: AccountState): ScheduleView[] {
  const stored = account.schedules.map((s): ScheduleView => ({
    nodeId: scheduleNodeId(s.id),
    id: s.id,
    opId: undefined,
    status: statusOf(s),
    kind: s.kind,
    recipient: s.recipient,
    invoiceId: s.invoiceId,
    amount: s.amount,
    nextAt: s.nextAt,
    interval: s.interval,
    remaining: s.remaining,
  }));
  const pending = account.ops.flatMap((op): ScheduleView[] => {
    const { call } = op;

    if (call.fn !== "createSchedule" || op.executed || op.stale) return [];

    return [
      {
        nodeId: pendingScheduleNodeId(op.opId),
        id: undefined,
        opId: op.opId,
        status: "pending",
        kind: call.kind,
        recipient: call.kind === "transfer" ? call.recipient : undefined,
        invoiceId: call.kind === "payInvoice" ? call.invoiceId : undefined,
        // A PayInvoice op is priced at the face value, which is what its one run pays.
        amount: call.kind === "payInvoice" ? op.amount : call.amount,
        nextAt: call.start,
        interval: call.interval,
        remaining: call.runs,
      },
    ];
  });

  return [...stored, ...pending];
}

/** Still owed by the runs left: `amount × remaining`. */
export const committed = (view: ScheduleView): bigint =>
  view.status === "active" || view.status === "pending"
    ? view.amount * BigInt(view.remaining)
    : 0n;

/** Anyone may run it now (ZR-SCH-05). */
export const isDue = (view: ScheduleView, now: number): boolean =>
  view.status === "active" && now >= view.nextAt;

/** A PayInvoice schedule that is waiting or active blocks a second one for the same invoice. */
export const isInvoiceScheduled = (
  account: AccountState,
  invoiceId: bigint,
): boolean =>
  scheduleViews(account).some(
    (v) =>
      v.kind === "payInvoice" &&
      v.invoiceId === invoiceId &&
      (v.status === "active" || v.status === "pending"),
  );

export const UNIT_SECONDS = { min: 60, h: 3_600, d: 86_400 } as const;
export type TimeUnit = keyof typeof UNIT_SECONDS;

/** Seconds as the largest whole unit: "1 min", "2 h", "3 d". */
export function durationText(seconds: number): string {
  for (const unit of ["d", "h", "min"] as const) {
    const size = UNIT_SECONDS[unit];

    if (seconds >= size && seconds % size === 0)
      return `${seconds / size} ${unit}`;
  }

  return `${seconds} s`;
}

export const cadenceText = (interval: number): string =>
  interval === 0 ? "once" : `every ${durationText(interval)}`;

export type ScheduleInput =
  | {
      readonly kind: "transfer";
      readonly recipient: Address;
      readonly amount: bigint;
      readonly startIn: number;
      readonly interval: number;
      readonly runs: number;
    }
  | {
      readonly kind: "payInvoice";
      readonly invoiceId: bigint;
      readonly faceValue: bigint;
      readonly startIn: number;
    };

export type ScheduleTerms =
  | {
      readonly ok: true;
      readonly call: Extract<GatedCall, { fn: "createSchedule" }>;
      /** What the approval policy prices the op at: `amount × runs`, or the face value. */
      readonly policyAmount: bigint;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * The createSchedule call for `input`, starting `startIn` seconds after `now`, or the rule it breaks. The chain
 * checks the start again when the last signature lands, so it must still be 60 s ahead then.
 */
export function scheduleTerms(
  input: ScheduleInput,
  now: number,
): ScheduleTerms {
  if (!Number.isInteger(input.startIn) || input.startIn < MIN_SCHEDULE_DELAY)
    return { ok: false, reason: "Start ≥ 1 min from now" };
  const start = now + input.startIn;

  if (input.kind === "payInvoice")
    return {
      ok: true,
      call: {
        fn: "createSchedule",
        kind: "payInvoice",
        invoiceId: input.invoiceId,
        amount: input.faceValue,
        start,
        interval: 0,
        runs: 1,
      },
      policyAmount: input.faceValue,
    };
  if (input.amount <= 0n) return { ok: false, reason: "Amount > 0" };
  if (
    !Number.isInteger(input.runs) ||
    input.runs < 1 ||
    input.runs > MAX_SCHEDULE_RUNS
  )
    return { ok: false, reason: "Runs 1–1,000" };
  const once = input.runs === 1;

  if (
    !once &&
    (!Number.isInteger(input.interval) ||
      input.interval < MIN_SCHEDULE_INTERVAL)
  )
    return { ok: false, reason: "Every ≥ 1 min" };

  return {
    ok: true,
    call: {
      fn: "createSchedule",
      kind: "transfer",
      recipient: input.recipient,
      amount: input.amount,
      start,
      interval: once ? 0 : input.interval,
      runs: input.runs,
    },
    policyAmount: input.amount * BigInt(input.runs),
  };
}
