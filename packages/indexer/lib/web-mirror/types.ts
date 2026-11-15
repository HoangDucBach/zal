// The canvas domain model: what one CanvasAccount sees of the chain. Built from contract reads and events by
// lib/contracts/canvas-reads.ts, and turned into xyflow nodes and edges by lib/canvas/graph.ts.

import type { Address, Hash, Hex } from "viem";

export const REL_STATUSES = [
  "none",
  "proposed",
  "active",
  "rejected",
  "cancelled",
] as const;
export type RelStatus = (typeof REL_STATUSES)[number];

export const INVOICE_STATUSES = [
  "none",
  "issued",
  "approved",
  "paid",
  "rejected",
  "cancelled",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const MEMBER_ROLES = ["none", "viewer", "approver", "admin"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const LEG_KINDS = ["hold", "transfer", "vault"] as const;
export type LegKind = (typeof LEG_KINDS)[number];

/** A party's role in one relationship. Never a property of an account (ADR 0002). */
export type PartyRole = "buyer" | "seller";

export interface Relationship {
  readonly id: bigint;
  readonly buyer: Address;
  readonly seller: Address;
  readonly proposer: Address;
  readonly proposedAt: number;
  readonly expiresAt: number;
  readonly status: RelStatus;
}

export interface Advance {
  readonly principal: bigint;
  readonly fee: bigint;
  readonly fundedAt: number;
}

export interface Invoice {
  readonly id: bigint;
  readonly relationshipId: bigint;
  readonly seller: Address;
  readonly buyer: Address;
  readonly faceValue: bigint;
  readonly escrowed: bigint;
  readonly issuedAt: number;
  readonly dueDate: number;
  readonly approvedAt: number;
  readonly status: InvoiceStatus;
  readonly docHash: Hex;
  /** `ownerOf`, the payment recipient (INV-06). `undefined` once a cancelled invoice is burned. */
  readonly owner: Address | undefined;
  /** Set while the funding pool holds the NFT. */
  readonly advance: Advance | undefined;
  /** The pool's credit line for this invoice's buyer (ADR 0009). */
  readonly buyerCredit: BuyerCredit;
}

export interface BuyerCredit {
  readonly limit: bigint;
  /** Advance principal the pool has open against this buyer. */
  readonly outstanding: bigint;
}

export type GatedCall =
  | {
      readonly fn: "approveInvoice";
      readonly invoiceId: bigint;
      readonly budgetId: bigint;
    }
  | { readonly fn: "escrowInvoice"; readonly invoiceId: bigint }
  | { readonly fn: "payInvoice"; readonly invoiceId: bigint }
  | { readonly fn: "withdraw"; readonly to: Address; readonly amount: bigint };

export interface PendingOp {
  readonly opId: bigint;
  readonly call: GatedCall;
  readonly amount: bigint;
  readonly confirmations: number;
  readonly required: number;
  readonly executed: boolean;
  /** Members or policy changed after submission, so the op can no longer run (ZR-ACC-05). */
  readonly stale: boolean;
  readonly confirmedByMe: boolean;
}

export interface Budget {
  readonly id: bigint;
  readonly limit: bigint;
  readonly used: bigint;
  readonly periodStart: number;
  readonly periodLength: number;
}

export interface Leg {
  readonly kind: LegKind;
  readonly target: Address;
  readonly bps: number;
}

export interface Member {
  readonly address: Address;
  readonly role: MemberRole;
}

export interface AccountState {
  readonly address: Address;
  /** `ZalFactory.isAccount`. False until the visitor creates their canvas. */
  readonly exists: boolean;
  readonly balance: bigint;
  readonly members: readonly Member[];
  readonly myRole: MemberRole;
  readonly threshold: number;
  readonly approvalLimit: bigint;
  readonly endpointPublic: boolean;
  readonly route: readonly Leg[];
  readonly budgets: readonly Budget[];
  /** Which budget each approved invoice was charged to, from `BudgetCharged`. Keyed by invoice id. */
  readonly budgetOfInvoice: Readonly<Record<string, bigint>>;
  readonly ops: readonly PendingOp[];
  readonly vaultShares: bigint;
  readonly vaultAssets: bigint;
}

export interface PoolState {
  readonly address: Address;
  readonly idleCash: bigint;
  readonly totalAssets: bigint;
  readonly advanceRateBps: number;
  readonly annualFeeBps: number;
}

/** The connected wallet's own position in the funding pool. An LP is a wallet, not a canvas role. */
export interface LpPosition {
  readonly shares: bigint;
  /** What the shares are worth now, `convertToAssets`. */
  readonly assets: bigint;
  /** Capped by the pool's idle cash (ZR-FND-05). */
  readonly maxWithdraw: bigint;
  /** MockUSDC (testnet) in the wallet itself, available to deposit. */
  readonly walletUsdc: bigint;
  /** What the wallet already allows the pool to pull. */
  readonly allowance: bigint;
}

/** The Zal events a canvas lists, each with the id it is about. Parsed from logs in lib/canvas/activity.ts. */
export type ActivityEvent =
  | {
      readonly name:
        | "RelationshipProposed"
        | "RelationshipAccepted"
        | "RelationshipRejected"
        | "RelationshipCancelled";
      readonly relationshipId: bigint;
    }
  | {
      readonly name:
        | "InvoiceIssued"
        | "InvoiceApproved"
        | "InvoiceRejected"
        | "InvoiceCancelled"
        | "InvoiceEscrowed"
        | "InvoicePaid"
        | "Advanced"
        | "Repaid"
        | "PaymentRouted";
      readonly invoiceId: bigint;
    }
  | {
      readonly name: "OpSubmitted" | "OpExecuted";
      readonly opId: bigint;
    }
  | { readonly name: "BudgetSet"; readonly budgetId: bigint }
  | { readonly name: "RouteSet" };

export interface ActivityItem {
  readonly key: string;
  readonly timestamp: number;
  readonly blockNumber: bigint;
  readonly transactionHash: Hash;
  readonly title: string;
  readonly event: ActivityEvent;
}

/** One MockUSDC transfer into or out of the canvas account, from its `Transfer` logs. */
export interface CashMove {
  readonly key: string;
  readonly timestamp: number;
  readonly blockNumber: bigint;
  /** Base units, positive into the account and negative out of it. */
  readonly amount: bigint;
  readonly counterparty: Address;
}

/** One payment that ran through this account's Split (`PaymentRouted`). */
export interface RoutedPayment {
  readonly key: string;
  readonly timestamp: number;
  readonly invoiceId: bigint;
  readonly amount: bigint;
  /** What each leg of the Split received, in route order at the time of payment. */
  readonly legAmounts: readonly bigint[];
}

export interface CanvasState {
  /** The connected wallet. */
  readonly wallet: Address;
  readonly account: AccountState;
  readonly relationships: readonly Relationship[];
  readonly invoices: readonly Invoice[];
  readonly pool: PoolState;
  readonly lp: LpPosition;
  readonly activity: readonly ActivityItem[];
  /** Every USDC movement of the account, oldest first. */
  readonly cash: readonly CashMove[];
  /** Every payment routed through the Split, oldest first. */
  readonly routed: readonly RoutedPayment[];
  /** Display names for known counterparties (the sandbox club). */
  readonly labels: Readonly<Record<string, string>>;
  /** Chain time of the latest block, seconds. */
  readonly now: number;
}
