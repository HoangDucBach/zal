// The /v1 wire form (ADR 0012) parsed back into the web's own types. The API sends bigints as decimal strings,
// addresses lowercase and a missing value as `null`. Addresses come back checksummed, the form RPC reads give,
// so the rest of the app compares them the same way in both sources.

import type { CanvasNotification } from "@/lib/canvas/notifications";
import type {
  ActivityItem,
  CanvasState,
  GatedCall,
  Invoice,
} from "@/lib/canvas/types";

import { getAddress, type Address, type Hash, type Hex } from "viem";
import { z } from "zod";

import { NOTIFICATION_KINDS } from "@/lib/canvas/notifications";
import {
  INVOICE_STATUSES,
  LEG_KINDS,
  MEMBER_ROLES,
  REL_STATUSES,
} from "@/lib/canvas/types";

const MAX_UINT256 = 2n ** 256n - 1n;
/** A uint256 amount or id: non-negative, at most 2^256 - 1. */
const big = z
  .string()
  .regex(/^\d{1,78}$/, "not a non-negative decimal integer")
  .transform((s) => BigInt(s))
  .refine((n) => n <= MAX_UINT256, "above uint256");
/** A signed amount (a transfer out of the account is negative), within uint256 either way. */
const signedBig = z
  .string()
  .regex(/^-?\d{1,78}$/, "not a decimal integer")
  .transform((s) => BigInt(s))
  .refine((n) => n <= MAX_UINT256 && -n <= MAX_UINT256, "above uint256");
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "not an address")
  .transform((a): Address => getAddress(a));
const hex = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, "not hex")
  .transform((h) => h.toLowerCase() as Hex);
const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "not a hash")
  .transform((h) => h.toLowerCase() as Hash);
/** A count, index, block or unix time: a non-negative safe integer. */
const int = z.number().int().nonnegative();
const bps = int.max(10_000);

export const asOfSchema = z.object({ block: int, updatedAt: int });
export type AsOf = z.output<typeof asOfSchema>;

const gatedCall: z.ZodType<GatedCall, unknown> = z.union([
  z.object({
    fn: z.literal("approveInvoice"),
    invoiceId: big,
    budgetId: big,
  }),
  z.object({ fn: z.literal("escrowInvoice"), invoiceId: big }),
  z.object({ fn: z.literal("payInvoice"), invoiceId: big }),
  z.object({ fn: z.literal("withdraw"), to: address, amount: big }),
]);

const activityEvent = z.union([
  z.object({
    name: z.enum([
      "RelationshipProposed",
      "RelationshipAccepted",
      "RelationshipRejected",
      "RelationshipCancelled",
    ]),
    relationshipId: big,
  }),
  z.object({
    name: z.enum([
      "InvoiceIssued",
      "InvoiceApproved",
      "InvoiceRejected",
      "InvoiceCancelled",
      "InvoiceEscrowed",
      "InvoicePaid",
      "Advanced",
      "Repaid",
      "PaymentRouted",
    ]),
    invoiceId: big,
  }),
  z.object({ name: z.enum(["OpSubmitted", "OpExecuted"]), opId: big }),
  z.object({ name: z.literal("BudgetSet"), budgetId: big }),
  z.object({ name: z.literal("RouteSet") }),
]);

const activityItem: z.ZodType<ActivityItem, unknown> = z.object({
  key: z.string(),
  timestamp: int,
  blockNumber: big,
  transactionHash: hash,
  title: z.string(),
  event: activityEvent,
});

const invoice: z.ZodType<Invoice, unknown> = z.object({
  id: big,
  relationshipId: big,
  seller: address,
  buyer: address,
  faceValue: big,
  escrowed: big,
  issuedAt: int,
  dueDate: int,
  approvedAt: int,
  status: z.enum(INVOICE_STATUSES),
  docHash: hex,
  owner: address.nullable().transform((a) => a ?? undefined),
  advance: z
    .object({ principal: big, fee: big, fundedAt: int })
    .nullable()
    .transform((a) => a ?? undefined),
  buyerCredit: z.object({ limit: big, outstanding: big }),
});

export const canvasStateSchema: z.ZodType<CanvasState, unknown> = z.object({
  wallet: address,
  account: z.object({
    address,
    exists: z.boolean(),
    balance: big,
    members: z.array(z.object({ address, role: z.enum(MEMBER_ROLES) })),
    myRole: z.enum(MEMBER_ROLES),
    /** uint8 on-chain. */
    threshold: int.max(255),
    approvalLimit: big,
    endpointPublic: z.boolean(),
    route: z.array(z.object({ kind: z.enum(LEG_KINDS), target: address, bps })),
    budgets: z.array(
      z.object({
        id: big,
        limit: big,
        used: big,
        periodStart: int,
        periodLength: int,
      }),
    ),
    budgetOfInvoice: z.record(z.string(), big),
    ops: z.array(
      z.object({
        opId: big,
        call: gatedCall,
        amount: big,
        confirmations: int,
        required: int,
        executed: z.boolean(),
        stale: z.boolean(),
        confirmedByMe: z.boolean(),
      }),
    ),
    vaultShares: big,
    vaultAssets: big,
  }),
  relationships: z.array(
    z.object({
      id: big,
      buyer: address,
      seller: address,
      proposer: address,
      proposedAt: int,
      expiresAt: int,
      status: z.enum(REL_STATUSES),
    }),
  ),
  invoices: z.array(invoice),
  pool: z.object({
    address,
    idleCash: big,
    totalAssets: big,
    advanceRateBps: bps,
    annualFeeBps: bps,
  }),
  lp: z.object({
    shares: big,
    assets: big,
    maxWithdraw: big,
    walletUsdc: big,
    allowance: big,
  }),
  activity: z.array(activityItem),
  cash: z.array(
    z.object({
      key: z.string(),
      timestamp: int,
      blockNumber: big,
      amount: signedBig,
      counterparty: address,
    }),
  ),
  routed: z.array(
    z.object({
      key: z.string(),
      timestamp: int,
      invoiceId: big,
      amount: big,
      legAmounts: z.array(big),
    }),
  ),
  labels: z.record(z.string(), z.string()),
  now: int,
});

/** The stored layout as the API returns it. Its shape is checked again by `parseStoredLayout`. */
export const savedLayoutSchema = z.object({
  layout: z.unknown(),
  revision: int.nonnegative(),
  updatedAt: z.string(),
  updatedBy: address,
});
export type SavedLayout = z.output<typeof savedLayoutSchema>;

export const canvasResponseSchema = z.object({
  asOf: asOfSchema,
  canvas: canvasStateSchema,
  layout: savedLayoutSchema.nullable(),
});

const notification = z.object({
  key: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  detail: z.string(),
  nodeId: z.string(),
  timestamp: int,
  blockNumber: big,
  read: z.boolean(),
});

export type ServerNotification = CanvasNotification & {
  readonly read: boolean;
};

export const notificationsResponseSchema = z.object({
  asOf: asOfSchema,
  notifications: z.array(notification),
  unread: int,
});

export const activityResponseSchema = z.object({
  asOf: asOfSchema,
  items: z.array(activityItem),
  nextCursor: z.string().nullable(),
});

export const poolResponseSchema = z.object({
  asOf: asOfSchema,
  pool: z.unknown(),
  lp: z.unknown(),
});

export const nonceResponseSchema = z.object({
  asOf: asOfSchema,
  nonce: z.string().min(8),
  expiresAt: z.string(),
});

export const verifyResponseSchema = z.object({
  asOf: asOfSchema,
  token: z.string().min(1),
  wallet: address,
  expiresAt: z.string(),
});

export const layoutPutResponseSchema = z.object({
  asOf: asOfSchema,
  layout: z.object({
    revision: int.positive(),
    updatedAt: z.string(),
    updatedBy: address,
  }),
});

/**
 * GET /v1/wallets/:wallet/accounts: one page of where the wallet holds a role, from MemberSet, the accounts it acted on
 * first, then newest activity first. A hint: the chain decides.
 */
export const walletAccountsResponseSchema = z.object({
  asOf: asOfSchema,
  wallet: address,
  accounts: z
    .array(
      z.object({
        address,
        role: z.enum(MEMBER_ROLES),
        /** The wallet sent a transaction to this account; false when others only added it. */
        acted: z.boolean(),
      }),
    )
    .max(100),
  nextCursor: z.string().max(200).nullable(),
});

export const readResponseSchema = z.object({ asOf: asOfSchema, read: int });

const inviteSchema = z.object({
  id: z.string(),
  proposer: address,
  /** The proposer's own role: 0 buyer, 1 seller. */
  proposerRole: z.union([z.literal(0), z.literal(1)]),
  inviteeEmailHash: hash,
  nonce: big,
  deadline: int,
  signature: hex,
  signer: address,
  createdAt: z.string(),
  expired: z.boolean(),
});

export type StoredInvite = z.output<typeof inviteSchema>;

export const inviteResponseSchema = z.object({
  asOf: asOfSchema,
  invite: inviteSchema,
});

/** RFC 9457 problem details, plus the API's machine-readable `code`. */
export const problemSchema = z.object({
  status: int,
  code: z.string(),
  detail: z.string().optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});

/** One `feed` event of GET /v1/stream. */
export const streamFeedSchema = z.object({
  subjects: z.array(address),
  name: z.string(),
  key: z.string(),
  blockNumber: big,
  logIndex: int,
  transactionHash: hash,
  timestamp: int,
  relationshipId: big.nullable(),
  invoiceId: big.nullable(),
  opId: big.nullable(),
  budgetId: big.nullable(),
});
export type StreamFeed = z.output<typeof streamFeedSchema>;

export const streamLayoutSchema = z.object({
  account: address,
  revision: int,
});

/** The `ready` event of GET /v1/stream. `asOf` is missing when the API could not read its head. */
export const streamReadySchema = z.object({
  cursor: z.string(),
  asOf: asOfSchema.optional(),
});
