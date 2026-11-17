// Indexed rows to the web's CanvasState (packages/web/lib/canvas/types.ts), the same shape
// packages/web/lib/contracts/canvas-reads.ts builds from RPC. Pure, so every rule is tested without a database.

import type {
  ActivityItem,
  CanvasState,
  CashMove,
  GatedCall,
  Invoice,
  PendingOp,
  Relationship,
  RoutedPayment,
  Schedule,
} from "./web-mirror/types.ts";

import { decodeFunctionData, type Address, type Hex } from "viem";

import { canvasAccountAbi } from "../abis/index.ts";
import { activityTitle, parseActivityEvent } from "./web-mirror/activity.ts";
import { INVOICE_STATUSES, LEG_KINDS, MEMBER_ROLES, REL_STATUSES } from "./web-mirror/types.ts";

export interface AccountRow {
  readonly address: Address;
  readonly threshold: number;
  readonly approvalLimit: bigint;
  readonly policyNonce: bigint;
  readonly endpointPublic: boolean;
  readonly windowStart: bigint;
  readonly windowSpent: bigint;
  readonly route: readonly { kind: number; target: Address; bps: number }[];
}

export interface OpRow {
  readonly opId: bigint;
  readonly data: Hex;
  readonly amount: bigint;
  readonly policyNonce: bigint;
  readonly required: number;
  readonly confirmations: number;
  readonly executed: boolean;
}

export interface RelationshipRow {
  readonly id: bigint;
  readonly buyer: Address;
  readonly seller: Address;
  readonly proposer: Address;
  readonly proposedAt: bigint;
  readonly expiresAt: bigint;
  readonly status: number;
}

export interface InvoiceRow {
  readonly id: bigint;
  readonly relationshipId: bigint;
  readonly seller: Address;
  readonly buyer: Address;
  readonly faceValue: bigint;
  readonly escrowed: bigint;
  readonly issuedAt: bigint;
  readonly dueDate: bigint;
  readonly approvedAt: bigint;
  readonly status: number;
  readonly docHash: Hex;
  readonly owner: Address | null;
}

export interface ScheduleRow {
  readonly scheduleId: bigint;
  /** 0 Transfer, 1 PayInvoice. */
  readonly kind: number;
  readonly recipient: Address | null;
  readonly invoiceId: bigint | null;
  readonly amount: bigint;
  readonly nextAt: bigint;
  readonly interval: number;
  readonly remaining: number;
  readonly active: boolean;
}

export interface FeedRow {
  readonly name: string;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: Hex;
  readonly timestamp: bigint;
  readonly relationshipId: bigint | null;
  readonly invoiceId: bigint | null;
  readonly opId: bigint | null;
  readonly budgetId: bigint | null;
  readonly scheduleId: bigint | null;
  readonly actor: Address | null;
}

export interface TransferRow {
  readonly id: string;
  readonly from: Address;
  readonly to: Address;
  readonly value: bigint;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly timestamp: bigint;
}

export interface CanvasRows {
  readonly wallet: Address;
  readonly address: Address;
  readonly account: AccountRow | undefined;
  readonly members: readonly { wallet: Address; role: number }[];
  readonly budgets: readonly { budgetId: bigint; limit: bigint; used: bigint; periodStart: bigint; periodLength: bigint }[];
  readonly charges: readonly { invoiceId: bigint; budgetId: bigint }[];
  readonly ops: readonly OpRow[];
  /** Op ids the wallet has confirmed and not revoked. */
  readonly confirmedByWallet: ReadonlySet<bigint>;
  readonly schedules: readonly ScheduleRow[];
  readonly relationships: readonly RelationshipRow[];
  readonly invoices: readonly InvoiceRow[];
  readonly advances: ReadonlyMap<bigint, { principal: bigint; fee: bigint; fundedAt: bigint }>;
  readonly obligors: ReadonlyMap<Address, { limit: bigint; outstanding: bigint }>;
  readonly pool: {
    readonly address: Address;
    readonly idleCash: bigint;
    readonly totalAssets: bigint;
    readonly advanceRateBps: number;
    readonly annualFeeBps: number;
  };
  readonly balances: {
    readonly accountUsdc: bigint;
    readonly accountVaultShares: bigint;
    readonly walletPoolShares: bigint;
    readonly walletUsdc: bigint;
    readonly walletPoolAllowance: bigint;
  };
  /** Share-price views read from the chain at `asOf`, never recomputed here. */
  readonly views: { readonly vaultAssets: bigint; readonly lpAssets: bigint; readonly lpMaxWithdraw: bigint };
  readonly feed: readonly FeedRow[];
  readonly transfers: readonly TransferRow[];
  readonly routed: readonly {
    id: string;
    invoiceId: bigint;
    amount: bigint;
    legAmounts: readonly string[];
    blockNumber: bigint;
    logIndex: number;
    timestamp: bigint;
  }[];
  /** Timestamp of the block the response is as of. */
  readonly now: number;
}

function decodeGated(data: Hex): GatedCall {
  const call = decodeFunctionData({ abi: canvasAccountAbi, data });
  switch (call.functionName) {
    case "approveInvoice":
      return { fn: "approveInvoice", invoiceId: call.args[0], budgetId: call.args[1] };
    case "escrowInvoice":
      return { fn: "escrowInvoice", invoiceId: call.args[0] };
    case "payInvoice":
      return { fn: "payInvoice", invoiceId: call.args[0] };
    case "withdraw":
      return { fn: "withdraw", to: call.args[0], amount: call.args[1] };
    case "createSchedule": {
      const [kind, recipient, invoiceId, amount, start, interval, runs] = call.args;
      const timing = { amount, start: Number(start), interval, runs };
      // The contract ignores `invoiceId` for a Transfer and `recipient` for a PayInvoice.
      return kind === 0
        ? { fn: "createSchedule", kind: "transfer", recipient, ...timing }
        : { fn: "createSchedule", kind: "payInvoice", invoiceId, ...timing };
    }
    default:
      throw new Error(`Unexpected gated call ${call.functionName}`);
  }
}

const byChainOrder = (a: { blockNumber: bigint; logIndex: number }, b: { blockNumber: bigint; logIndex: number }) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Feed rows to the web's activity items. Rows the web does not list (transfers, members) are dropped. */
export function toActivity(feed: readonly FeedRow[]): ActivityItem[] {
  return [...feed].sort(byChainOrder).flatMap((row) => {
    const args: Record<string, unknown> = {};
    const id = row.name.startsWith("Relationship")
      ? row.relationshipId
      : row.name.startsWith("Schedule")
        ? row.scheduleId
        : row.invoiceId;
    if (id !== null) args.id = id;
    if (row.invoiceId !== null) args.invoiceId = row.invoiceId;
    if (row.opId !== null) args.opId = row.opId;
    if (row.budgetId !== null) args.budgetId = row.budgetId;
    const event = parseActivityEvent(row.name, args);
    return event === undefined
      ? []
      : [
          {
            key: `${row.transactionHash}:${row.logIndex}`,
            timestamp: Number(row.timestamp),
            blockNumber: row.blockNumber,
            transactionHash: row.transactionHash,
            title: activityTitle(event),
            event,
          },
        ];
  });
}

/** Mirrors `CanvasAccount.SPEND_WINDOW`. */
const SPEND_WINDOW_SECONDS = 86_400n;

/**
 * What a pending op needs if confirmed at `nowSec`: `requiredConfirmations(amount)` evaluated off-chain. Executed
 * and stale ops keep the count read at submission.
 */
export function requiredNow(acc: AccountRow, op: OpRow, nowSec: number): number {
  if (op.executed || op.policyNonce !== acc.policyNonce) return op.required;
  const spent = BigInt(nowSec) < acc.windowStart + SPEND_WINDOW_SECONDS ? acc.windowSpent : 0n;
  return spent + op.amount > acc.approvalLimit ? acc.threshold : 1;
}

/** `nowSec` is wall-clock unix time: the L1 makes blocks only on transactions, so the head block's time lags. */
export function assembleCanvas(rows: CanvasRows, nowSec: number): CanvasState {
  const { account: acc, wallet } = rows;
  const memberRole = (role: number) => MEMBER_ROLES[role] ?? "none";

  const ops: PendingOp[] = rows.ops.map((op) => ({
    opId: op.opId,
    call: decodeGated(op.data),
    amount: op.amount,
    confirmations: op.confirmations,
    required: acc === undefined ? op.required : requiredNow(acc, op, nowSec),
    executed: op.executed,
    stale: acc !== undefined && op.policyNonce !== acc.policyNonce,
    confirmedByMe: rows.confirmedByWallet.has(op.opId),
  }));

  const schedules: Schedule[] = [...rows.schedules]
    .sort((a, b) => (a.scheduleId < b.scheduleId ? -1 : 1))
    .map((row) => ({
      id: row.scheduleId,
      ...(row.kind === 0
        ? { kind: "transfer" as const, recipient: row.recipient ?? undefined }
        : { kind: "payInvoice" as const, invoiceId: row.invoiceId ?? undefined }),
      amount: row.amount,
      nextAt: Number(row.nextAt),
      interval: row.interval,
      remaining: row.remaining,
      active: row.active,
    }));

  const relationships: Relationship[] = rows.relationships.map((r) => ({
    id: r.id,
    buyer: r.buyer,
    seller: r.seller,
    proposer: r.proposer,
    proposedAt: Number(r.proposedAt),
    expiresAt: Number(r.expiresAt),
    status: REL_STATUSES[r.status] ?? "none",
  }));

  const invoices: Invoice[] = rows.invoices.map((inv) => {
    const adv = rows.advances.get(inv.id);
    return {
      id: inv.id,
      relationshipId: inv.relationshipId,
      seller: inv.seller,
      buyer: inv.buyer,
      faceValue: inv.faceValue,
      escrowed: inv.escrowed,
      issuedAt: Number(inv.issuedAt),
      dueDate: Number(inv.dueDate),
      approvedAt: Number(inv.approvedAt),
      status: INVOICE_STATUSES[inv.status] ?? "none",
      docHash: inv.docHash,
      owner: inv.owner ?? undefined,
      advance:
        adv === undefined ? undefined : { principal: adv.principal, fee: adv.fee, fundedAt: Number(adv.fundedAt) },
      buyerCredit: rows.obligors.get(inv.buyer) ?? { limit: 0n, outstanding: 0n },
    };
  });

  const cash: CashMove[] = rows.transfers
    // A transfer to itself moves nothing, and would otherwise count once in and once out.
    .filter((t) => !(sameAddress(t.from, rows.address) && sameAddress(t.to, rows.address)))
    .sort(byChainOrder)
    .map((t) => {
      const incoming = sameAddress(t.to, rows.address);
      return {
        key: t.id,
        timestamp: Number(t.timestamp),
        blockNumber: t.blockNumber,
        amount: incoming ? t.value : -t.value,
        counterparty: incoming ? t.from : t.to,
      };
    });

  const routed: RoutedPayment[] = [...rows.routed].sort(byChainOrder).map((r) => ({
    key: r.id,
    timestamp: Number(r.timestamp),
    invoiceId: r.invoiceId,
    amount: r.amount,
    legAmounts: r.legAmounts.map(BigInt),
  }));

  const members = rows.members
    .filter((m) => m.role !== 0)
    .map((m) => ({ address: m.wallet, role: memberRole(m.role) }));

  return {
    wallet,
    account: {
      address: rows.address,
      exists: acc !== undefined,
      balance: rows.balances.accountUsdc,
      members: acc === undefined ? [] : members,
      myRole: memberRole(rows.members.find((m) => sameAddress(m.wallet, wallet))?.role ?? 0),
      threshold: acc?.threshold ?? 0,
      approvalLimit: acc?.approvalLimit ?? 0n,
      endpointPublic: acc?.endpointPublic ?? false,
      route: (acc?.route ?? []).map((leg) => ({ kind: LEG_KINDS[leg.kind] ?? "hold", target: leg.target, bps: leg.bps })),
      budgets: [...rows.budgets]
        .sort((a, b) => (a.budgetId < b.budgetId ? -1 : 1))
        .map((b) => ({
          id: b.budgetId,
          limit: b.limit,
          used: b.used,
          periodStart: Number(b.periodStart),
          periodLength: Number(b.periodLength),
        })),
      budgetOfInvoice: Object.fromEntries(rows.charges.map((c) => [String(c.invoiceId), c.budgetId])),
      ops: ops.sort((a, b) => (a.opId < b.opId ? -1 : 1)),
      schedules,
      vaultShares: rows.balances.accountVaultShares,
      vaultAssets: rows.views.vaultAssets,
    },
    relationships: relationships.sort((a, b) => (a.id < b.id ? -1 : 1)),
    invoices: invoices.sort((a, b) => (a.id < b.id ? -1 : 1)),
    pool: rows.pool,
    lp: {
      shares: rows.balances.walletPoolShares,
      assets: rows.views.lpAssets,
      maxWithdraw: rows.views.lpMaxWithdraw,
      walletUsdc: rows.balances.walletUsdc,
      allowance: rows.balances.walletPoolAllowance,
    },
    activity: toActivity(rows.feed),
    cash,
    routed,
    labels: {},
    now: rows.now,
  };
}

/**
 * The wire form: bigints as decimal strings, addresses and hashes lowercase, and `undefined` as `null` so a
 * missing value is explicit. Numbers (times, bps, counts) stay numbers.
 */
export function toWire(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (typeof value === "string") return /^0x[0-9a-fA-F]*$/.test(value) ? value.toLowerCase() : value;
  if (Array.isArray(value)) return value.map(toWire);
  if (value instanceof Set) return [...value].map(toWire);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.startsWith("0x") ? k.toLowerCase() : k, toWire(v)]));
  }
  return value;
}

