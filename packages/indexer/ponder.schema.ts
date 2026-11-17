// The on-chain read model. Every row is rebuilt from events when the indexer replays from the start block
//. Addresses are lowercase hex, amounts and ids are bigints, times are Unix seconds.

import { index, onchainTable, primaryKey } from "ponder";

export const account = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  admin: t.hex().notNull(),
  createdAt: t.bigint().notNull(),
  threshold: t.integer().notNull(),
  approvalLimit: t.bigint().notNull(),
  policyNonce: t.bigint().notNull(),
  endpointPublic: t.boolean().notNull(),
  /** The 24 h single-confirmation window from the last `SpendWindowCharged`; 0 before any charge. */
  windowStart: t.bigint().notNull(),
  windowSpent: t.bigint().notNull(),
  /** The Split, in route order: `[{ kind, target, bps }]` with kind 0 Hold, 1 Transfer, 2 Vault. */
  route: t.json().$type<{ kind: number; target: `0x${string}`; bps: number }[]>().notNull(),
}));

export const member = onchainTable(
  "member",
  (t) => ({
    account: t.hex().notNull(),
    wallet: t.hex().notNull(),
    /** 0 None, 1 Viewer, 2 Approver, 3 Admin. */
    role: t.integer().notNull(),
    /**
     * The wallet sent a transaction that emitted an event of this account. False for a canvas the wallet was only
     * added to by others, which anyone can do to any wallet.
     */
    acted: t.boolean().notNull(),
    /** The latest MemberSet for this wallet, or event from its own transaction, here: the switcher's order. */
    activeBlock: t.bigint().notNull(),
    activeLogIndex: t.integer().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.account, table.wallet] }),
    walletIdx: index().on(table.wallet, table.acted, table.activeBlock, table.activeLogIndex, table.account),
  }),
);

export const budget = onchainTable(
  "budget",
  (t) => ({
    account: t.hex().notNull(),
    budgetId: t.bigint().notNull(),
    limit: t.bigint().notNull(),
    used: t.bigint().notNull(),
    periodStart: t.bigint().notNull(),
    periodLength: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.account, table.budgetId] }) }),
);

/** Which budget an approval charged, from BudgetCharged. */
export const budgetCharge = onchainTable(
  "budget_charge",
  (t) => ({
    account: t.hex().notNull(),
    invoiceId: t.bigint().notNull(),
    budgetId: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.account, table.invoiceId] }) }),
);

export const op = onchainTable(
  "op",
  (t) => ({
    account: t.hex().notNull(),
    opId: t.bigint().notNull(),
    selector: t.hex().notNull(),
    data: t.hex().notNull(),
    amount: t.bigint().notNull(),
    submittedBy: t.hex().notNull(),
    /** The account's policy nonce at submission. A later nonce makes the op stale (ZR-ACC-05). */
    policyNonce: t.bigint().notNull(),
    /**
     * `requiredConfirmations(amount)` read at submission. While the op is pending it can drop to 1 when the
     * account's 24 h window expires, which emits nothing, so the API recomputes it from the window (lib/canvas.ts).
     */
    required: t.integer().notNull(),
    confirmations: t.integer().notNull(),
    executed: t.boolean().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.account, table.opId] }) }),
);

export const opConfirmation = onchainTable(
  "op_confirmation",
  (t) => ({
    account: t.hex().notNull(),
    opId: t.bigint().notNull(),
    wallet: t.hex().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.account, table.opId, table.wallet] }) }),
);

export const relationship = onchainTable(
  "relationship",
  (t) => ({
    id: t.bigint().primaryKey(),
    buyer: t.hex().notNull(),
    seller: t.hex().notNull(),
    proposer: t.hex().notNull(),
    proposedAt: t.bigint().notNull(),
    expiresAt: t.bigint().notNull(),
    /** 1 Proposed, 2 Active, 3 Rejected, 4 Cancelled. */
    status: t.integer().notNull(),
  }),
  (table) => ({ buyerIdx: index().on(table.buyer), sellerIdx: index().on(table.seller) }),
);

export const invoice = onchainTable(
  "invoice",
  (t) => ({
    id: t.bigint().primaryKey(),
    relationshipId: t.bigint().notNull(),
    seller: t.hex().notNull(),
    buyer: t.hex().notNull(),
    faceValue: t.bigint().notNull(),
    escrowed: t.bigint().notNull(),
    issuedAt: t.bigint().notNull(),
    dueDate: t.bigint().notNull(),
    approvedAt: t.bigint().notNull(),
    /** 1 Issued, 2 Approved, 3 Paid, 4 Rejected, 5 Cancelled. */
    status: t.integer().notNull(),
    docHash: t.hex().notNull(),
    /** `ownerOf`, the payment recipient (INV-06). Null once a cancelled invoice is burned. */
    owner: t.hex(),
  }),
  (table) => ({ buyerIdx: index().on(table.buyer), sellerIdx: index().on(table.seller) }),
);

/** An open pool advance. Deleted on Repaid, as the pool deletes it. */
export const advance = onchainTable("advance", (t) => ({
  invoiceId: t.bigint().primaryKey(),
  seller: t.hex().notNull(),
  buyer: t.hex().notNull(),
  principal: t.bigint().notNull(),
  fee: t.bigint().notNull(),
  fundedAt: t.bigint().notNull(),
  onCredit: t.boolean().notNull(),
}));

/**
 * A payment an account approved ahead of time. `nextAt` and `remaining` follow ScheduleRan the way
 * `runSchedule` advances them, so the row matches `getSchedule` without a read.
 */
export const schedule = onchainTable(
  "schedule",
  (t) => ({
    account: t.hex().notNull(),
    scheduleId: t.bigint().notNull(),
    /** 0 Transfer, 1 PayInvoice. */
    kind: t.integer().notNull(),
    /** Transfer only. */
    recipient: t.hex(),
    /** PayInvoice only. */
    invoiceId: t.bigint(),
    amount: t.bigint().notNull(),
    nextAt: t.bigint().notNull(),
    interval: t.integer().notNull(),
    remaining: t.integer().notNull(),
    active: t.boolean().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.account, table.scheduleId] }),
    dueIdx: index().on(table.active, table.nextAt),
  }),
);

/** The pool's credit line per buyer account. */
export const obligor = onchainTable("obligor", (t) => ({
  buyer: t.hex().primaryKey(),
  limit: t.bigint().notNull(),
  outstanding: t.bigint().notNull(),
}));

/** One row, keyed by the pool address. `idleCash` and `totalAssets` are read from the pool after each change. */
export const pool = onchainTable("pool", (t) => ({
  address: t.hex().primaryKey(),
  advanceRateBps: t.integer().notNull(),
  annualFeeBps: t.integer().notNull(),
  idleCash: t.bigint().notNull(),
  totalAssets: t.bigint().notNull(),
}));

/** ERC-20 balances of zUSDC, pool shares and vault shares, keyed by token and holder. */
export const tokenBalance = onchainTable(
  "token_balance",
  (t) => ({
    token: t.hex().notNull(),
    holder: t.hex().notNull(),
    balance: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.token, table.holder] }) }),
);

/** zUSDC allowance to the pool only. OpenZeppelin 5 spends allowances without an event, so the handler
 * reads `allowance` after each pool deposit. */
export const poolAllowance = onchainTable("pool_allowance", (t) => ({
  owner: t.hex().primaryKey(),
  value: t.bigint().notNull(),
}));

export const usdcTransfer = onchainTable(
  "usdc_transfer",
  (t) => ({
    id: t.text().primaryKey(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    value: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({ fromIdx: index().on(table.from), toIdx: index().on(table.to) }),
);

export const routedPayment = onchainTable(
  "routed_payment",
  (t) => ({
    id: t.text().primaryKey(),
    account: t.hex().notNull(),
    invoiceId: t.bigint().notNull(),
    amount: t.bigint().notNull(),
    legAmounts: t.json().$type<string[]>().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({ accountIdx: index().on(table.account) }),
);

/**
 * Every event that changes what a canvas shows, once per subject it concerns: the account(s) involved, or the
 * pool address for pool-wide changes. It is the activity feed, the notification source, and the SSE replay log
 * (Last-Event-ID is `<blockNumber>-<logIndex>`).
 */
export const feed = onchainTable(
  "feed",
  (t) => ({
    subject: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    name: t.text().notNull(),
    transactionHash: t.hex().notNull(),
    timestamp: t.bigint().notNull(),
    relationshipId: t.bigint(),
    invoiceId: t.bigint(),
    opId: t.bigint(),
    budgetId: t.bigint(),
    scheduleId: t.bigint(),
    /** Who sent it where the event says: OpSubmitted `by`, InvoicePaid `payer`. */
    actor: t.hex(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.subject, table.blockNumber, table.logIndex] }),
  }),
);

/** Vaults a Split leg may target (`ZalFactory.allowedVault`). */
export const allowedVault = onchainTable("allowed_vault", (t) => ({
  vault: t.hex().primaryKey(),
  allowed: t.boolean().notNull(),
}));

// ---- Explorer (docs/plans/explorer.md). Written by the block handler in src/explorer.ts from every block's
// transactions and receipts, independently of the Zal tables above.

export const exBlock = onchainTable(
  "ex_block",
  (t) => ({
    number: t.bigint().primaryKey(),
    hash: t.hex().notNull(),
    parentHash: t.hex().notNull(),
    timestamp: t.bigint().notNull(),
    txCount: t.integer().notNull(),
    gasUsed: t.bigint().notNull(),
    gasLimit: t.bigint().notNull(),
    baseFeePerGas: t.bigint(),
    miner: t.hex().notNull(),
  }),
  (table) => ({ hashIdx: index().on(table.hash) }),
);

export const exTx = onchainTable(
  "ex_tx",
  (t) => ({
    hash: t.hex().primaryKey(),
    blockNumber: t.bigint().notNull(),
    index: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    from: t.hex().notNull(),
    /** Null on a contract creation. */
    to: t.hex(),
    value: t.bigint().notNull(),
    gasUsed: t.bigint().notNull(),
    effectiveGasPrice: t.bigint().notNull(),
    fee: t.bigint().notNull(),
    /** `success` or `reverted`. */
    status: t.text().notNull(),
    /** The first 4 bytes of calldata; null when there are fewer. */
    selector: t.hex(),
    /** The Zal function name for `selector`, else null. */
    method: t.text(),
    contractCreated: t.hex(),
    /** `zal` | `token` | `native` | `deploy` | `other` (lib/explorer/chain.ts). */
    kind: t.text().notNull(),
    input: t.hex().notNull(),
  }),
  (table) => ({
    orderIdx: index().on(table.blockNumber, table.index),
    fromIdx: index().on(table.from, table.blockNumber, table.index),
    toIdx: index().on(table.to, table.blockNumber, table.index),
  }),
);

/** Every log of every transaction, raw. The API decodes them with the Zal ABIs when it serves a transaction. */
export const exLog = onchainTable(
  "ex_log",
  (t) => ({
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    blockNumber: t.bigint().notNull(),
    address: t.hex().notNull(),
    topics: t.json().$type<`0x${string}`[]>().notNull(),
    data: t.hex().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.txHash, table.logIndex] }) }),
);

export const exAddress = onchainTable("ex_address", (t) => ({
  address: t.hex().primaryKey(),
  firstSeenBlock: t.bigint().notNull(),
  /** Transactions sent from or to the address. */
  txCount: t.integer().notNull(),
  isContract: t.boolean().notNull(),
  /** A deployment name or `Zal canvas`. */
  label: t.text(),
}));

export const exToken = onchainTable(
  "ex_token",
  (t) => ({
    address: t.hex().primaryKey(),
    /** `erc20` | `erc721`, from the first Transfer log's shape. */
    standard: t.text().notNull(),
    /** Read once when the token first appears; null when the read failed. */
    name: t.text(),
    symbol: t.text(),
    decimals: t.integer(),
    /** Mints minus burns: an amount for ERC-20, a count for ERC-721. */
    totalSupply: t.bigint().notNull(),
    holderCount: t.integer().notNull(),
    transferCount: t.integer().notNull(),
  }),
  (table) => ({ popularIdx: index().on(table.transferCount, table.address) }),
);

export const exTransfer = onchainTable(
  "ex_transfer",
  (t) => ({
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    token: t.hex().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    /** ERC-20 only. */
    value: t.bigint(),
    /** ERC-721 only. */
    tokenId: t.bigint(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.txHash, table.logIndex] }),
    tokenIdx: index().on(table.token, table.blockNumber, table.logIndex),
    fromIdx: index().on(table.from, table.blockNumber, table.logIndex),
    toIdx: index().on(table.to, table.blockNumber, table.logIndex),
  }),
);

/** A positive balance: an amount for ERC-20, a count for ERC-721. A row that reaches zero is deleted. */
export const exHolding = onchainTable(
  "ex_holding",
  (t) => ({
    token: t.hex().notNull(),
    holder: t.hex().notNull(),
    balance: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.token, table.holder] }),
    rankIdx: index().on(table.token, table.balance, table.holder),
    holderIdx: index().on(table.holder),
  }),
);

export const exNft = onchainTable(
  "ex_nft",
  (t) => ({
    token: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    /** Null once burned. */
    owner: t.hex(),
    mintedBlock: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.token, table.tokenId] }),
    ownerIdx: index().on(table.owner, table.token, table.tokenId),
  }),
);

/** Per UTC unix day (`floor(timestamp / 86400)`). */
export const exDaily = onchainTable("ex_daily", (t) => ({
  day: t.integer().primaryKey(),
  txCount: t.integer().notNull(),
  activeAddresses: t.integer().notNull(),
  gasUsed: t.bigint().notNull(),
  fees: t.bigint().notNull(),
  /** `InvoicePaid` face values plus Transfer-schedule payments (`ScheduleRan` of kind Transfer), in zUSDC units. */
  zusdcSettled: t.bigint().notNull(),
  /** Zal `AccountCreated`. */
  newAccounts: t.integer().notNull(),
  zalTxs: t.integer().notNull(),
  tokenTxs: t.integer().notNull(),
  nativeTxs: t.integer().notNull(),
  deployTxs: t.integer().notNull(),
  otherTxs: t.integer().notNull(),
}));

/** Which addresses were active on a day, so `ex_daily.activeAddresses` counts each once. */
export const exDailyAddress = onchainTable(
  "ex_daily_address",
  (t) => ({
    day: t.integer().notNull(),
    address: t.hex().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.day, table.address] }) }),
);

/** One row (id 1): running totals, so /stats reads counts without scanning. */
export const exTotals = onchainTable("ex_totals", (t) => ({
  id: t.integer().primaryKey(),
  txCount: t.bigint().notNull(),
  addressCount: t.bigint().notNull(),
  contractCount: t.bigint().notNull(),
  canvasCount: t.bigint().notNull(),
}));
