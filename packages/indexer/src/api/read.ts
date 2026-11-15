// Database reads for the /v1 routes, over Ponder's read-only connection. Everything here is as of `asOf`, plus
// three share-price views read from the chain at that same block.

import type { Address } from "viem";
import type { WalletAccountRow, WalletAccountsPage } from "../../lib/app.ts";
import type { CanvasRows } from "../../lib/canvas.ts";
import type { AsOf } from "../../lib/checkpoint.ts";

import { and, desc, eq, gt, inArray, like, lt, or, sql } from "ponder";
import { db, publicClients } from "ponder:api";
import schema from "ponder:schema";

import { zalFundingPoolAbi, zalVaultAbi } from "../../abis/index.ts";
import { asOfFromCheckpoint } from "../../lib/checkpoint.ts";
import { ApiError } from "../../lib/errors.ts";
import { config } from "./config.ts";

const client = publicClients.zal;
const lower = (a: string) => a.toLowerCase() as Address;

export async function readAsOf(): Promise<AsOf> {
  const result = await db.execute<{ latest_checkpoint: string }>(
    sql`select latest_checkpoint from _ponder_checkpoint where chain_name = 'zal'`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new ApiError("unavailable", "The indexer has not indexed a block yet");
  return asOfFromCheckpoint(row.latest_checkpoint);
}

async function balanceOf(token: Address, holder: Address): Promise<bigint> {
  const [row] = await db
    .select({ balance: schema.tokenBalance.balance })
    .from(schema.tokenBalance)
    .where(and(eq(schema.tokenBalance.token, token), eq(schema.tokenBalance.holder, holder)));
  return row?.balance ?? 0n;
}

export async function readPool() {
  const [row] = await db.select().from(schema.pool).where(eq(schema.pool.address, config.addresses.pool));
  if (row === undefined) throw new ApiError("unavailable", "The pool has not been indexed yet");
  return {
    address: row.address,
    idleCash: row.idleCash,
    totalAssets: row.totalAssets,
    advanceRateBps: row.advanceRateBps,
    annualFeeBps: row.annualFeeBps,
  };
}

/** The wallet's LP position. `assets` and `maxWithdraw` are the pool's own views at `asOf.block`. */
export async function readLp(wallet: Address, asOf: AsOf) {
  const { pool, usdc } = config.addresses;
  const [shares, walletUsdc, allowanceRow] = await Promise.all([
    balanceOf(pool, wallet),
    balanceOf(usdc, wallet),
    db.select().from(schema.poolAllowance).where(eq(schema.poolAllowance.owner, wallet)),
  ]);
  const blockNumber = BigInt(asOf.block);
  const [assets, maxWithdraw] =
    shares === 0n
      ? [0n, 0n]
      : await Promise.all([
          client.readContract({ address: pool, abi: zalFundingPoolAbi, functionName: "convertToAssets", args: [shares], blockNumber }),
          client.readContract({ address: pool, abi: zalFundingPoolAbi, functionName: "maxWithdraw", args: [wallet], blockNumber }),
        ]);
  return { shares, assets, maxWithdraw, walletUsdc, allowance: allowanceRow[0]?.value ?? 0n };
}

/** Feed rows for these subjects, oldest first, optionally only after a cursor. */
export function readFeed(subjects: readonly Address[], after?: { blockNumber: bigint; logIndex: number }, limit = 1_000) {
  const f = schema.feed;
  const afterCursor =
    after === undefined
      ? undefined
      : or(gt(f.blockNumber, after.blockNumber), and(eq(f.blockNumber, after.blockNumber), gt(f.logIndex, after.logIndex)));
  return db
    .select()
    .from(f)
    .where(and(inArray(f.subject, subjects.map(lower)), afterCursor))
    .orderBy(f.blockNumber, f.logIndex)
    .limit(limit);
}

/** The newest feed position for these subjects, where a fresh stream starts. */
export async function readLatestCursor(subjects: readonly Address[]) {
  const f = schema.feed;
  const [row] = await db
    .select({ blockNumber: f.blockNumber, logIndex: f.logIndex })
    .from(f)
    .where(inArray(f.subject, subjects.map(lower)))
    .orderBy(desc(f.blockNumber), desc(f.logIndex))
    .limit(1);
  return row ?? { blockNumber: 0n, logIndex: -1 };
}

/** One page of feed rows for a subject, newest first, strictly before a cursor. */
export function readFeedPage(subject: Address, before: { blockNumber: bigint; logIndex: number } | undefined, pageSize: number) {
  const f = schema.feed;
  const beforeCursor =
    before === undefined
      ? undefined
      : or(lt(f.blockNumber, before.blockNumber), and(eq(f.blockNumber, before.blockNumber), lt(f.logIndex, before.logIndex)));
  return db
    .select()
    .from(f)
    .where(and(eq(f.subject, lower(subject)), beforeCursor))
    .orderBy(desc(f.blockNumber), desc(f.logIndex))
    .limit(pageSize);
}

/**
 * One page of the accounts where the wallet's latest MemberSet left a role, as of the indexed head: the ones it acted
 * on first, then by its latest activity there, newest first.
 */
export function readWalletAccounts(wallet: Address, page: WalletAccountsPage): Promise<WalletAccountRow[]> {
  const m = schema.member;
  const after = page.after;
  return db
    .select({ account: m.account, role: m.role, acted: m.acted, activeBlock: m.activeBlock, activeLogIndex: m.activeLogIndex })
    .from(m)
    .where(
      and(
        eq(m.wallet, lower(wallet)),
        gt(m.role, 0),
        page.acted === undefined ? undefined : eq(m.acted, page.acted),
        page.query === undefined ? undefined : like(m.account, `%${page.query}%`),
        after === undefined
          ? undefined
          : sql`(${m.acted}, ${m.activeBlock}, ${m.activeLogIndex}, ${m.account}) < (${after.acted}, ${after.activeBlock}, ${after.activeLogIndex}, ${after.account})`,
      ),
    )
    .orderBy(desc(m.acted), desc(m.activeBlock), desc(m.activeLogIndex), desc(m.account))
    .limit(page.limit);
}

export async function readCanvasRows(address: Address, wallet: Address, asOf: AsOf): Promise<CanvasRows> {
  const { usdc, vault } = config.addresses;
  const s = schema;
  const [account] = await db.select().from(s.account).where(eq(s.account.address, address));

  const [members, budgets, charges, ops, confirmations, relationships, invoices, pool, lp, accountUsdc, vaultShares, feed, transfers, routed] =
    await Promise.all([
      db.select().from(s.member).where(eq(s.member.account, address)),
      db.select().from(s.budget).where(eq(s.budget.account, address)),
      db.select().from(s.budgetCharge).where(eq(s.budgetCharge.account, address)),
      db.select().from(s.op).where(eq(s.op.account, address)),
      db
        .select()
        .from(s.opConfirmation)
        .where(and(eq(s.opConfirmation.account, address), eq(s.opConfirmation.wallet, wallet))),
      db
        .select()
        .from(s.relationship)
        .where(or(eq(s.relationship.buyer, address), eq(s.relationship.seller, address))),
      db.select().from(s.invoice).where(or(eq(s.invoice.buyer, address), eq(s.invoice.seller, address))),
      readPool(),
      readLp(wallet, asOf),
      balanceOf(usdc, address),
      balanceOf(vault, address),
      readFeed([address], undefined, 100_000),
      db
        .select()
        .from(s.usdcTransfer)
        .where(or(eq(s.usdcTransfer.from, address), eq(s.usdcTransfer.to, address))),
      db.select().from(s.routedPayment).where(eq(s.routedPayment.account, address)),
    ]);

  const invoiceIds = invoices.map((i) => i.id);
  const buyers = [...new Set(invoices.map((i) => i.buyer))];
  const [advances, obligors] = await Promise.all([
    invoiceIds.length === 0 ? [] : db.select().from(s.advance).where(inArray(s.advance.invoiceId, invoiceIds)),
    buyers.length === 0 ? [] : db.select().from(s.obligor).where(inArray(s.obligor.buyer, buyers)),
  ]);

  const vaultAssets =
    vaultShares === 0n
      ? 0n
      : await client.readContract({
          address: vault,
          abi: zalVaultAbi,
          functionName: "convertToAssets",
          args: [vaultShares],
          blockNumber: BigInt(asOf.block),
        });

  return {
    wallet,
    address,
    account,
    members,
    budgets,
    charges,
    ops,
    confirmedByWallet: new Set(confirmations.map((c) => c.opId)),
    relationships,
    invoices,
    advances: new Map(advances.map((a) => [a.invoiceId, a])),
    obligors: new Map(obligors.map((o) => [o.buyer, { limit: o.limit, outstanding: o.outstanding }])),
    pool,
    balances: {
      accountUsdc,
      accountVaultShares: vaultShares,
      walletPoolShares: lp.shares,
      walletUsdc: lp.walletUsdc,
      walletPoolAllowance: lp.allowance,
    },
    views: { vaultAssets, lpAssets: lp.assets, lpMaxWithdraw: lp.maxWithdraw },
    feed,
    transfers,
    routed,
    now: asOf.updatedAt,
  };
}
