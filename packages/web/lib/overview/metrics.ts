// What the Overview charts show, derived from one canvas read. Pure, so every number on the dashboard is tested
// against chain-shaped fixtures, and the components only draw.

import type { Address } from "viem";
import type {
  CanvasState,
  Invoice,
  InvoiceStatus,
  LegKind,
} from "@/lib/canvas/types";

import { isAddressEqual } from "viem";

const WEEK = 7 * 86_400;

export interface BalancePoint {
  readonly timestamp: number;
  readonly balance: bigint;
}

/**
 * The account balance after each USDC movement, ending at the current balance at chain time `now`. Walks back from
 * the balance the chain reports, so the line always ends on the number the hero card prints.
 */
export function balanceSeries(state: CanvasState): readonly BalancePoint[] {
  const points: BalancePoint[] = [];
  let after = state.account.balance;

  for (let i = state.cash.length - 1; i >= 0; i--) {
    const move = state.cash[i];

    if (move === undefined) continue;
    // Several moves in one block share a timestamp; the last one's balance is the one that held.
    if (points[0]?.timestamp !== move.timestamp) {
      points.unshift({ timestamp: move.timestamp, balance: after });
    }
    after -= move.amount;
  }
  if (points.length > 0)
    points.unshift({ timestamp: points[0]?.timestamp ?? 0, balance: after });
  const last = points.at(-1);

  if (last === undefined || last.timestamp < state.now) {
    points.push({ timestamp: state.now, balance: state.account.balance });
  }

  return points;
}

const DAY = 86_400;

/**
 * The balance from the first movement to chain time `now`: one point right after the first movement, then one a
 * day at the time of day of `now`, the last at `now`. Movements land in bursts (one block, one demo), so a chart on
 * raw movement times crowds them into a few pixels; sampling by day keeps time honest and the curve readable. An
 * account that never moved holds its balance over the last week.
 */
export function dailyBalance(state: CanvasState): readonly BalancePoint[] {
  const series = balanceSeries(state);
  const first = state.cash[0]?.timestamp ?? state.now - WEEK;
  const at = (timestamp: number) =>
    series.findLast((p) => p.timestamp <= timestamp)?.balance ??
    state.account.balance;
  const days = Math.max(1, Math.ceil((state.now - first) / DAY));

  return [
    { timestamp: first, balance: at(first) },
    ...Array.from({ length: days }, (_, i) => {
      const timestamp = state.now - (days - 1 - i) * DAY;

      return { timestamp, balance: at(timestamp) };
    }),
  ];
}

export interface WeekFlow {
  /** Start of the week, chain seconds. */
  readonly start: number;
  readonly incoming: bigint;
  readonly outgoing: bigint;
}

/** Money in and out of the account per week, for the `weeks` weeks ending at `now`, oldest first. */
export function weeklyFlows(
  state: CanvasState,
  weeks: number,
): readonly WeekFlow[] {
  const first = state.now - weeks * WEEK;

  return Array.from({ length: weeks }, (_, i) => {
    const start = first + i * WEEK;
    const moves = state.cash.filter(
      (m) => m.timestamp > start && m.timestamp <= start + WEEK,
    );

    return {
      start,
      incoming: moves.reduce(
        (sum, m) => (m.amount > 0n ? sum + m.amount : sum),
        0n,
      ),
      outgoing: moves.reduce(
        (sum, m) => (m.amount < 0n ? sum - m.amount : sum),
        0n,
      ),
    };
  });
}

export interface LegTotal {
  readonly index: number;
  readonly kind: LegKind | undefined;
  readonly target: Address | undefined;
  readonly amount: bigint;
}

/**
 * What each leg of the Split has received in total. Leg identity comes from the route the account has now; a leg a
 * later `setRoute` removed still counts, without a kind.
 */
export function routedByLeg(state: CanvasState): readonly LegTotal[] {
  const totals: bigint[] = [];

  for (const payment of state.routed) {
    payment.legAmounts.forEach((amount, i) => {
      totals[i] = (totals[i] ?? 0n) + amount;
    });
  }

  return totals.map((amount, index) => {
    const leg = state.account.route[index];

    return { index, kind: leg?.kind, target: leg?.target, amount };
  });
}

export const STATUS_ORDER: readonly InvoiceStatus[] = [
  "issued",
  "approved",
  "paid",
  "rejected",
  "cancelled",
];

export interface StatusCount {
  readonly status: InvoiceStatus;
  readonly count: number;
  readonly faceValue: bigint;
}

/** Invoices per status, in lifecycle order, statuses with none left out. */
export function invoicesByStatus(
  invoices: readonly Invoice[],
): readonly StatusCount[] {
  return STATUS_ORDER.map((status) => {
    const matching = invoices.filter((i) => i.status === status);

    return {
      status,
      count: matching.length,
      faceValue: matching.reduce((sum, i) => sum + i.faceValue, 0n),
    };
  }).filter((s) => s.count > 0);
}

/** Open invoices (issued or approved) by due date, soonest first. */
export function upcomingDue(invoices: readonly Invoice[]): readonly Invoice[] {
  return invoices
    .filter((inv) => inv.status === "issued" || inv.status === "approved")
    .toSorted((a, b) => a.dueDate - b.dueDate);
}

/** Advances the pool paid this account on invoices it sold and that are not yet repaid. */
export function openAdvances(state: CanvasState): readonly Invoice[] {
  return state.invoices.filter(
    (inv) =>
      inv.status === "approved" &&
      inv.advance !== undefined &&
      isAddressEqual(inv.seller, state.account.address),
  );
}

export interface PoolUse {
  /** Money out on advances: total assets minus idle cash. */
  readonly deployed: bigint;
  /** Deployed share of total assets, 0 to 1. Zero for an empty pool. */
  readonly utilisation: number;
}

export function poolUse(state: CanvasState): PoolUse {
  const { totalAssets, idleCash } = state.pool;
  const deployed = totalAssets > idleCash ? totalAssets - idleCash : 0n;

  return {
    deployed,
    utilisation:
      totalAssets === 0n
        ? 0
        : Number((deployed * 10_000n) / totalAssets) / 10_000,
  };
}

/** Buyers on this account's invoices that the pool has given a credit line (ADR 0009), with what they use. */
export function obligorCredit(state: CanvasState): readonly {
  readonly buyer: Address;
  readonly limit: bigint;
  readonly outstanding: bigint;
}[] {
  const seen = new Map<
    string,
    { buyer: Address; limit: bigint; outstanding: bigint }
  >();

  for (const inv of state.invoices) {
    if (inv.buyerCredit.limit > 0n) {
      seen.set(inv.buyer.toLowerCase(), {
        buyer: inv.buyer,
        ...inv.buyerCredit,
      });
    }
  }

  return [...seen.values()];
}
