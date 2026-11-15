// ZalFundingPool events: rates, credit lines, advances and repayments, LP deposits, and pool share balances.

import type { Context } from "ponder:registry";

import { ponder } from "ponder:registry";
import schema from "ponder:schema";

import { zusdcAbi, zalFundingPoolAbi } from "../abis/index.ts";
import { publish } from "./feed.ts";
import { moveBalance } from "./tokens.ts";

/** Reads the pool's own figures at this block instead of summing them, so they match `idleCash()` exactly. */
export async function refreshPool(context: Context) {
  const address = context.contracts.ZalFundingPool.address;
  const read = (functionName: "advanceRateBps" | "annualFeeBps" | "idleCash" | "totalAssets") =>
    context.client.readContract({ address, abi: zalFundingPoolAbi, functionName });
  const [advanceRateBps, annualFeeBps, idleCash, totalAssets] = await Promise.all([
    read("advanceRateBps"),
    read("annualFeeBps"),
    read("idleCash"),
    read("totalAssets"),
  ]);
  const values = {
    advanceRateBps: Number(advanceRateBps),
    annualFeeBps: Number(annualFeeBps),
    idleCash: BigInt(idleCash),
    totalAssets: BigInt(totalAssets),
  };
  await context.db
    .insert(schema.pool)
    .values({ address, ...values })
    .onConflictDoUpdate(values);
}

ponder.on("ZalFundingPool:RatesSet", async ({ event, context }) => {
  await refreshPool(context);
  await publish(context, event, "RatesSet", [event.log.address]);
});

ponder.on("ZalFundingPool:ObligorLimitSet", async ({ event, context }) => {
  const { buyer, limit } = event.args;
  await context.db
    .insert(schema.obligor)
    .values({ buyer, limit, outstanding: 0n })
    .onConflictDoUpdate({ limit });
  await publish(context, event, "ObligorLimitSet", [buyer, event.log.address]);
});

ponder.on("ZalFundingPool:Advanced", async ({ event, context }) => {
  const { invoiceId, seller, principal, fee, onCredit } = event.args;
  const inv = await context.db.find(schema.invoice, { id: invoiceId });
  if (inv === null) throw new Error(`Advanced for unknown invoice ${invoiceId}`);
  await context.db.insert(schema.advance).values({
    invoiceId,
    seller,
    buyer: inv.buyer,
    principal,
    fee,
    fundedAt: event.block.timestamp,
    onCredit,
  });
  if (onCredit) {
    await context.db
      .insert(schema.obligor)
      .values({ buyer: inv.buyer, limit: 0n, outstanding: principal })
      .onConflictDoUpdate((row) => ({ outstanding: row.outstanding + principal }));
  }
  await refreshPool(context);
  await publish(context, event, "Advanced", [seller, inv.buyer, event.log.address], { invoiceId });
});

ponder.on("ZalFundingPool:Repaid", async ({ event, context }) => {
  const { invoiceId } = event.args;
  const adv = await context.db.find(schema.advance, { invoiceId });
  if (adv === null) throw new Error(`Repaid for unknown advance ${invoiceId}`);
  await context.db.delete(schema.advance, { invoiceId });
  if (adv.onCredit) {
    await context.db
      .update(schema.obligor, { buyer: adv.buyer })
      .set((row) => ({ outstanding: row.outstanding - adv.principal }));
  }
  await refreshPool(context);
  await publish(context, event, "Repaid", [adv.seller, adv.buyer, event.log.address], { invoiceId });
});

ponder.on("ZalFundingPool:Deposit", async ({ event, context }) => {
  const { sender } = event.args;
  // OpenZeppelin 5 spends the allowance without an Approval event, so read what is left.
  const value = await context.client.readContract({
    address: context.contracts.ZUSDC.address,
    abi: zusdcAbi,
    functionName: "allowance",
    args: [sender, event.log.address],
  });
  await context.db.insert(schema.poolAllowance).values({ owner: sender, value }).onConflictDoUpdate({ value });
  await refreshPool(context);
  await publish(context, event, "Deposit", [event.log.address]);
});

ponder.on("ZalFundingPool:Withdraw", async ({ event, context }) => {
  await refreshPool(context);
  await publish(context, event, "Withdraw", [event.log.address]);
});

ponder.on("ZalFundingPool:Transfer", async ({ event, context }) => {
  const { from, to, value } = event.args;
  await moveBalance(context, event.log.address, from, to, value);
});
