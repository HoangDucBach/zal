// Canvas state fixtures for the pure canvas tests: one account (ME) that sells to CLUB, with a pool at POOL.

import type { Address } from "viem";
import type { AccountState, CanvasState, Invoice, Relationship } from "./types";

export const ME: Address = "0x00000000000000000000000000000000000000a1";
export const CLUB: Address = "0x00000000000000000000000000000000000000b2";
export const POOL: Address = "0x00000000000000000000000000000000000000c3";
export const VAULT: Address = "0x00000000000000000000000000000000000000d4";

export const account = (over: Partial<AccountState> = {}): AccountState => ({
  address: ME,
  exists: true,
  balance: 0n,
  members: [
    { address: "0x00000000000000000000000000000000000000e5", role: "admin" },
  ],
  myRole: "admin",
  threshold: 1,
  approvalLimit: 0n,
  endpointPublic: false,
  route: [],
  budgets: [],
  budgetOfInvoice: {},
  ops: [],
  vaultShares: 0n,
  vaultAssets: 0n,
  ...over,
});

export const rel = (over: Partial<Relationship> = {}): Relationship => ({
  id: 1n,
  buyer: CLUB,
  seller: ME,
  proposer: ME,
  proposedAt: 0,
  expiresAt: 0,
  status: "proposed",
  ...over,
});

export const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 7n,
  relationshipId: 1n,
  seller: ME,
  buyer: CLUB,
  faceValue: 5_000_000_000n,
  escrowed: 0n,
  issuedAt: 0,
  dueDate: 100,
  approvedAt: 0,
  status: "issued",
  docHash: "0x00",
  owner: ME,
  advance: undefined,
  buyerCredit: { limit: 0n, outstanding: 0n },
  ...over,
});

export const state = (over: Partial<CanvasState> = {}): CanvasState => ({
  wallet: ME,
  account: account(),
  relationships: [],
  invoices: [],
  pool: {
    address: POOL,
    idleCash: 0n,
    totalAssets: 0n,
    advanceRateBps: 8000,
    annualFeeBps: 0,
  },
  lp: {
    shares: 0n,
    assets: 0n,
    maxWithdraw: 0n,
    walletUsdc: 0n,
    allowance: 0n,
  },
  activity: [],
  cash: [],
  routed: [],
  labels: {},
  now: 0,
  ...over,
});
