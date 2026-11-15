import type { Address } from "viem";

const lower = (address: Address) => address.toLowerCase();

/**
 * One place that builds query keys. Keys are arrays so TanStack matches them by prefix: `chain(id)` covers every
 * read on that chain, and `canvas(id)` covers every canvas on it.
 */
export const queryKeys = {
  all: ["zal"] as const,
  chain: (chainId: number) => ["zal", chainId] as const,
  accountOf: (chainId: number, admin: Address) =>
    ["zal", chainId, "accountOf", lower(admin)] as const,
  /** Every read of one CanvasAccount: members, policy, ops, budgets, route. */
  account: (chainId: number, account: Address) =>
    ["zal", chainId, "account", lower(account)] as const,
  canvases: (chainId: number) => ["zal", chainId, "canvas"] as const,
  /** One canvas snapshot: `wallet` viewing `selected` (its own canvas when `undefined`). */
  canvas: (chainId: number, wallet: Address, selected?: Address) =>
    [
      "zal",
      chainId,
      "canvas",
      lower(wallet),
      selected === undefined ? "own" : lower(selected),
    ] as const,
  /** The canvases a wallet may open (the switcher), verified on the chain. */
  memberships: (chainId: number, wallet: Address) =>
    ["zal", chainId, "memberships", lower(wallet)] as const,
  relationships: (chainId: number) => ["zal", chainId, "relationship"] as const,
  relationship: (chainId: number, id: bigint) =>
    ["zal", chainId, "relationship", String(id)] as const,
  invoices: (chainId: number) => ["zal", chainId, "invoice"] as const,
  invoice: (chainId: number, id: bigint) =>
    ["zal", chainId, "invoice", String(id)] as const,
  pool: (chainId: number) => ["zal", chainId, "pool"] as const,
  vault: (chainId: number) => ["zal", chainId, "vault"] as const,
  balances: (chainId: number) => ["zal", chainId, "balance"] as const,
  balance: (chainId: number, holder: Address) =>
    ["zal", chainId, "balance", lower(holder)] as const,
  /** The API's notification feed with read state, per wallet (live). */
  notifications: (chainId: number, wallet: Address, account: Address) =>
    ["zal", chainId, "notifications", lower(wallet), lower(account)] as const,
  invite: (chainId: number, id: string) =>
    ["zal", chainId, "invite", id] as const,
  sandbox: ["sandbox"] as const,
} as const;
