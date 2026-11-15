// Off-chain presentation state (ADR 0012), in the `zal_app` schema. Ponder never touches it, so these are the
// only tables that need a backup. Addresses are stored lowercase.

import {
  bigint,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const zalApp = pgSchema("zal_app");

/** Canvas layout per chain and account (ADR 0011): the web's stored layout JSON, version 1. */
export const layouts = zalApp.table(
  "layouts",
  {
    chainId: integer("chain_id").notNull(),
    account: text("account").notNull(),
    layout: jsonb("layout").notNull(),
    /** Bumped on every write, so a client can send the version it edited and get 409 on a lost update. */
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.account] })],
);

/** Notification keys a wallet has read. */
export const notificationReads = zalApp.table(
  "notification_reads",
  {
    chainId: integer("chain_id").notNull(),
    wallet: text("wallet").notNull(),
    key: text("key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.wallet, t.key] })],
);

/** Signed EIP-712 relationship invites (ZR-REL-03), shared as links. `id` is the unguessable link token. */
export const invites = zalApp.table(
  "invites",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    proposer: text("proposer").notNull(),
    proposerRole: smallint("proposer_role").notNull(),
    inviteeEmailHash: text("invitee_email_hash").notNull(),
    nonce: text("nonce").notNull(),
    deadline: bigint("deadline", { mode: "number" }).notNull(),
    signature: text("signature").notNull(),
    signer: text("signer").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("invites_proposer_nonce").on(t.chainId, t.proposer, t.nonce)],
);

/** One-time sign-in nonces. `used_at` is set atomically on verify, so a replayed message fails. */
export const authNonces = zalApp.table("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  chainId: integer("chain_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/** Bearer sessions. Only the SHA-256 of the token is stored. */
export const sessions = zalApp.table(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    chainId: integer("chain_id").notNull(),
    wallet: text("wallet").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_wallet").on(t.wallet)],
);

/**
 * Gas drips from the faucet. A row is the claim, written before the transfer is sent, so the 24 h limits per wallet
 * and per IP count a drip in flight. `tx_hash` is set once the node accepts the transfer; a failed send deletes the row.
 */
export const faucetDrips = zalApp.table(
  "faucet_drips",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    chainId: integer("chain_id").notNull(),
    wallet: text("wallet").notNull(),
    ip: text("ip").notNull(),
    amountWei: text("amount_wei").notNull(),
    txHash: text("tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("faucet_drips_wallet").on(t.chainId, t.wallet, t.createdAt),
    index("faucet_drips_ip").on(t.chainId, t.ip, t.createdAt),
  ],
);
