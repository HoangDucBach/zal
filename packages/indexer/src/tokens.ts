// MockUSDC and ZalVault share balances, USDC cash moves, and the wallet allowance to the pool.

import type { Context } from "ponder:registry";

import { zeroAddress } from "viem";
import { ponder } from "ponder:registry";
import schema from "ponder:schema";

import { publish } from "./feed.ts";
import { refreshPool } from "./pool.ts";

export async function moveBalance(
  context: Context,
  token: `0x${string}`,
  from: `0x${string}`,
  to: `0x${string}`,
  value: bigint,
) {
  for (const [holder, delta] of [
    [from, -value],
    [to, value],
  ] as const) {
    if (holder === zeroAddress) continue;
    await context.db
      .insert(schema.tokenBalance)
      .values({ token, holder, balance: delta })
      .onConflictDoUpdate((row) => ({ balance: row.balance + delta }));
  }
}

const isAccount = async (context: Context, address: `0x${string}`) =>
  address !== zeroAddress && (await context.db.find(schema.account, { address })) !== null;

ponder.on("MockUSDC:Transfer", async ({ event, context }) => {
  const { from, to, value } = event.args;
  await moveBalance(context, event.log.address, from, to, value);
  await context.db.insert(schema.usdcTransfer).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    from,
    to,
    value,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
  const pool = context.contracts.ZalFundingPool.address.toLowerCase();
  if (from.toLowerCase() === pool || to.toLowerCase() === pool) await refreshPool(context);
  const subjects: `0x${string}`[] = [];
  for (const party of [from, to]) if (await isAccount(context, party)) subjects.push(party);
  if (subjects.length > 0) await publish(context, event, "Transfer", subjects);
});

ponder.on("MockUSDC:Approval", async ({ event, context }) => {
  const { owner, spender, value } = event.args;
  if (spender.toLowerCase() !== context.contracts.ZalFundingPool.address.toLowerCase()) return;
  await context.db.insert(schema.poolAllowance).values({ owner, value }).onConflictDoUpdate({ value });
});

ponder.on("ZalVault:Transfer", async ({ event, context }) => {
  const { from, to, value } = event.args;
  await moveBalance(context, event.log.address, from, to, value);
});

ponder.on("ZalVault:YieldSimulated", async ({ event, context }) => {
  await publish(context, event, "YieldSimulated", [event.log.address]);
});
