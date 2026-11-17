// The keeper loop: every tick, read the schedules the indexer says are due and call `runSchedule` on each,
// one transaction at a time from one wallet. It holds no authority over funds: `runSchedule` pays only what the
// account approved, and the chain's `nextAt` refuses a second run, so a duplicate or late run is harmless.

import type { Address, Hash } from "viem";

export interface DueSchedule {
  readonly account: Address;
  readonly id: bigint;
  /** Unix seconds from which the run is allowed, as the indexer last saw it. */
  readonly nextAt: number;
}

/** A run the chain refused, by the contract error's name when it has one. */
export class RunRejected extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export interface KeeperDeps {
  /** Active schedules with `nextAt <= before`, earliest first. */
  readonly fetchDue: (before: number) => Promise<readonly DueSchedule[]>;
  /** The time the next block will carry, in Unix seconds. */
  readonly chainTime: () => Promise<number>;
  /** Throws RunRejected when `runSchedule` would revert at `time`. */
  readonly simulateRun: (schedule: DueSchedule, time: number) => Promise<void>;
  /** Sends `runSchedule` and resolves with the mined receipt's outcome. */
  readonly sendRun: (schedule: DueSchedule) => Promise<{ readonly hash: Hash; readonly success: boolean }>;
  readonly now: () => number;
  readonly log: (event: Record<string, unknown>) => void;
}

export interface KeeperOptions {
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  /** How many outcomes of each kind /status keeps. */
  readonly historySize: number;
}

export interface RunRecord {
  readonly at: number;
  readonly account: Address;
  readonly id: bigint;
  readonly hash: Hash;
}

export interface FailureRecord {
  readonly at: number;
  readonly account: Address;
  readonly id: bigint;
  readonly reason: string;
  /** Consecutive failures of this schedule, this one included. */
  readonly attempt: number;
  readonly retryAt: number;
  readonly hash?: Hash;
}

export interface TickRecord {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly due: number;
  readonly error?: string;
}

interface Backoff {
  readonly failures: number;
  readonly retryAt: number;
}

const keyOf = (s: { account: Address; id: bigint }) => `${s.account.toLowerCase()}:${s.id}`;

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createKeeper(deps: KeeperDeps, options: KeeperOptions) {
  const backoff = new Map<string, Backoff>();
  /** The `nextAt` each schedule last ran from. A due row at or before it is the indexer not having caught up yet. */
  const ranFrom = new Map<string, number>();
  const runs: RunRecord[] = [];
  const failures: FailureRecord[] = [];
  const counts = { ticks: 0, tickErrors: 0, ran: 0, failed: 0, backedOff: 0 };
  let lastTick: TickRecord | undefined;
  let inFlight: Promise<void> | undefined;

  const remember = <T>(list: T[], item: T) => {
    list.unshift(item);
    list.length = Math.min(list.length, options.historySize);
  };

  function fail(schedule: DueSchedule, reason: string, hash?: Hash) {
    const key = keyOf(schedule);
    const attempt = (backoff.get(key)?.failures ?? 0) + 1;
    const delay = Math.min(options.backoffMaxMs, options.backoffBaseMs * 2 ** (attempt - 1));
    const at = deps.now();
    backoff.set(key, { failures: attempt, retryAt: at + delay });
    counts.failed++;
    const record = { at, account: schedule.account, id: schedule.id, reason, attempt, retryAt: at + delay, ...(hash ? { hash } : {}) };
    remember(failures, record);
    deps.log({ event: "run_failed", ...record, id: String(schedule.id) });
  }

  async function runOne(schedule: DueSchedule, time: number) {
    const key = keyOf(schedule);
    if (schedule.nextAt <= (ranFrom.get(key) ?? -1)) return;
    const waiting = backoff.get(key);
    if (waiting !== undefined && waiting.retryAt > deps.now()) {
      counts.backedOff++;
      return;
    }
    try {
      await deps.simulateRun(schedule, time);
    } catch (err) {
      fail(schedule, err instanceof RunRejected ? err.reason : `simulation failed: ${errorMessage(err)}`);
      return;
    }
    let receipt: Awaited<ReturnType<KeeperDeps["sendRun"]>>;
    try {
      receipt = await deps.sendRun(schedule);
    } catch (err) {
      fail(schedule, `send failed: ${errorMessage(err)}`);
      return;
    }
    if (!receipt.success) {
      fail(schedule, "reverted on-chain", receipt.hash);
      return;
    }
    backoff.delete(key);
    ranFrom.set(key, schedule.nextAt);
    counts.ran++;
    const record = { at: deps.now(), account: schedule.account, id: schedule.id, hash: receipt.hash };
    remember(runs, record);
    deps.log({ event: "ran", ...record, id: String(schedule.id), nextAt: schedule.nextAt });
  }

  async function tickOnce() {
    const startedAt = deps.now();
    counts.ticks++;
    let due: readonly DueSchedule[] = [];
    try {
      const time = await deps.chainTime();
      due = await deps.fetchDue(time);
      // One at a time: every run is sent from the same wallet, so a second concurrent send would race for the nonce.
      for (const schedule of due) await runOne(schedule, time);
      lastTick = { startedAt, finishedAt: deps.now(), due: due.length };
    } catch (err) {
      counts.tickErrors++;
      lastTick = { startedAt, finishedAt: deps.now(), due: due.length, error: errorMessage(err) };
      deps.log({ event: "tick_failed", error: lastTick.error });
    }
  }

  return {
    /** Runs one tick. A tick that starts while another is running waits for that one instead of overlapping it. */
    tick(): Promise<void> {
      inFlight ??= tickOnce().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    snapshot() {
      return {
        lastTick,
        counts: { ...counts, backingOff: backoff.size },
        runs: [...runs],
        failures: [...failures],
      };
    },
  };
}

export type Keeper = ReturnType<typeof createKeeper>;
