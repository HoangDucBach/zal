// ZalFactory and CanvasAccount events: accounts, members, policy, the Split, budgets and gated operations.

import type { Context } from "ponder:registry";

import { ponder } from "ponder:registry";
import schema from "ponder:schema";

import { canvasAccountAbi } from "../abis/index.ts";
import { activeAt, publish } from "./feed.ts";

/**
 * Creates the row with the state `initialize` sets (one Admin, threshold 1, limit 0, nonce 1). Called by every
 * account handler, so the row exists whichever of AccountCreated and the clone's own first events comes first.
 */
async function ensureAccount(context: Context, address: `0x${string}`, timestamp: bigint) {
  await context.db
    .insert(schema.account)
    .values({
      address,
      admin: address,
      createdAt: timestamp,
      threshold: 1,
      approvalLimit: 0n,
      policyNonce: 1n,
      endpointPublic: false,
      route: [],
    })
    .onConflictDoNothing();
}

async function readBudget(context: Context, account: `0x${string}`, budgetId: bigint) {
  const [limit, used, periodStart, periodLength] = await context.client.readContract({
    address: account,
    abi: canvasAccountAbi,
    functionName: "budgets",
    args: [budgetId],
  });
  await context.db
    .insert(schema.budget)
    .values({ account, budgetId, limit, used, periodStart, periodLength })
    .onConflictDoUpdate({ limit, used, periodStart, periodLength });
}

ponder.on("ZalFactory:AccountCreated", async ({ event, context }) => {
  const { account, admin } = event.args;
  await ensureAccount(context, account, event.block.timestamp);
  await context.db.update(schema.account, { address: account }).set({ admin, createdAt: event.block.timestamp });
  await context.db
    .insert(schema.member)
    .values({ account, wallet: admin, role: 3, acted: false, ...activeAt(event) })
    .onConflictDoNothing();
  await publish(context, event, "AccountCreated", [account]);
});

ponder.on("CanvasAccount:MemberSet", async ({ event, context }) => {
  const account = event.log.address;
  const { member, role, policyNonce } = event.args;
  await ensureAccount(context, account, event.block.timestamp);
  await context.db.update(schema.account, { address: account }).set({ policyNonce });
  await context.db
    .insert(schema.member)
    .values({ account, wallet: member, role, acted: false, ...activeAt(event) })
    .onConflictDoUpdate({ role, ...activeAt(event) });
  await publish(context, event, "MemberSet", [account]);
});

ponder.on("CanvasAccount:PolicySet", async ({ event, context }) => {
  const account = event.log.address;
  const { threshold, approvalLimit, policyNonce } = event.args;
  await ensureAccount(context, account, event.block.timestamp);
  await context.db.update(schema.account, { address: account }).set({ threshold, approvalLimit, policyNonce });
  await publish(context, event, "PolicySet", [account]);
});

ponder.on("CanvasAccount:EndpointVisibilitySet", async ({ event, context }) => {
  const account = event.log.address;
  await context.db.update(schema.account, { address: account }).set({ endpointPublic: event.args.endpointPublic });
  await publish(context, event, "EndpointVisibilitySet", [account]);
});

ponder.on("CanvasAccount:RouteSet", async ({ event, context }) => {
  const account = event.log.address;
  const route = event.args.legs.map((leg) => ({
    kind: leg.kind,
    target: leg.target.toLowerCase() as `0x${string}`,
    bps: leg.bps,
  }));
  await context.db.update(schema.account, { address: account }).set({ route });
  await publish(context, event, "RouteSet", [account]);
});

ponder.on("CanvasAccount:BudgetSet", async ({ event, context }) => {
  const account = event.log.address;
  await readBudget(context, account, event.args.budgetId);
  await publish(context, event, "BudgetSet", [account], { budgetId: event.args.budgetId });
});

ponder.on("CanvasAccount:BudgetCharged", async ({ event, context }) => {
  const account = event.log.address;
  const { budgetId, invoiceId } = event.args;
  await readBudget(context, account, budgetId);
  await context.db
    .insert(schema.budgetCharge)
    .values({ account, invoiceId, budgetId })
    .onConflictDoUpdate({ budgetId });
  await publish(context, event, "BudgetCharged", [account], { budgetId, invoiceId });
});

ponder.on("CanvasAccount:OpSubmitted", async ({ event, context }) => {
  const account = event.log.address;
  const { opId, selector, amount, by, data } = event.args;
  const [required, policyNonce] = await Promise.all([
    context.client.readContract({
      address: account,
      abi: canvasAccountAbi,
      functionName: "requiredConfirmations",
      args: [amount],
    }),
    context.client.readContract({ address: account, abi: canvasAccountAbi, functionName: "policyNonce" }),
  ]);
  await context.db
    .insert(schema.op)
    .values({
      account,
      opId,
      selector,
      data,
      amount,
      submittedBy: by,
      policyNonce,
      required: Number(required),
      confirmations: 0,
      executed: false,
    })
    .onConflictDoNothing();
  await publish(context, event, "OpSubmitted", [account], { opId, actor: by });
});

ponder.on("CanvasAccount:OpConfirmed", async ({ event, context }) => {
  const account = event.log.address;
  const { opId, by, confirmations } = event.args;
  await context.db.update(schema.op, { account, opId }).set({ confirmations });
  await context.db.insert(schema.opConfirmation).values({ account, opId, wallet: by }).onConflictDoNothing();
  await publish(context, event, "OpConfirmed", [account], { opId, actor: by });
});

ponder.on("CanvasAccount:OpRevoked", async ({ event, context }) => {
  const account = event.log.address;
  const { opId, by, confirmations } = event.args;
  await context.db.update(schema.op, { account, opId }).set({ confirmations });
  await context.db.delete(schema.opConfirmation, { account, opId, wallet: by });
  await publish(context, event, "OpRevoked", [account], { opId, actor: by });
});

ponder.on("CanvasAccount:OpExecuted", async ({ event, context }) => {
  const account = event.log.address;
  await context.db.update(schema.op, { account, opId: event.args.opId }).set({ executed: true });
  await publish(context, event, "OpExecuted", [account], { opId: event.args.opId, actor: event.args.by });
});

ponder.on("CanvasAccount:PaymentRouted", async ({ event, context }) => {
  const account = event.log.address;
  const { invoiceId, amount, legAmounts } = event.args;
  await context.db.insert(schema.routedPayment).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    account,
    invoiceId,
    amount,
    legAmounts: legAmounts.map(String),
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
  await publish(context, event, "PaymentRouted", [account], { invoiceId });
});

ponder.on("CanvasAccount:LegFailed", async ({ event, context }) => {
  await publish(context, event, "LegFailed", [event.log.address], { invoiceId: event.args.invoiceId });
});

ponder.on("CanvasAccount:Withdrawn", async ({ event, context }) => {
  await publish(context, event, "Withdrawn", [event.log.address]);
});

ponder.on("CanvasAccount:VaultDeposited", async ({ event, context }) => {
  await publish(context, event, "VaultDeposited", [event.log.address]);
});

ponder.on("CanvasAccount:VaultRedeemed", async ({ event, context }) => {
  await publish(context, event, "VaultRedeemed", [event.log.address]);
});

ponder.on("CanvasAccount:ScheduleCreated", async ({ event, context }) => {
  const account = event.log.address;
  const { id, kind, recipient, invoiceId, amount, start, interval, runs } = event.args;
  const isTransfer = kind === 0;
  await context.db
    .insert(schema.schedule)
    .values({
      account,
      scheduleId: id,
      kind,
      recipient: isTransfer ? (recipient.toLowerCase() as `0x${string}`) : null,
      invoiceId: isTransfer ? null : invoiceId,
      amount,
      nextAt: start,
      interval,
      remaining: runs,
      active: true,
    })
    .onConflictDoNothing();
  await publish(context, event, "ScheduleCreated", [account], { scheduleId: id });
});

ponder.on("CanvasAccount:ScheduleRan", async ({ event, context }) => {
  const account = event.log.address;
  const { id, remaining } = event.args;
  await context.db
    .update(schema.schedule, { account, scheduleId: id })
    .set((row) => ({ nextAt: row.nextAt + BigInt(row.interval), remaining, active: remaining > 0 }));
  await publish(context, event, "ScheduleRan", [account], { scheduleId: id, actor: event.transaction.from });
});

ponder.on("CanvasAccount:ScheduleCancelled", async ({ event, context }) => {
  const account = event.log.address;
  const { id, by } = event.args;
  await context.db.update(schema.schedule, { account, scheduleId: id }).set({ active: false });
  await publish(context, event, "ScheduleCancelled", [account], { scheduleId: id, actor: by });
});

ponder.on("ZalFactory:AllowedVaultSet", async ({ event, context }) => {
  const { vault, allowed } = event.args;
  await context.db.insert(schema.allowedVault).values({ vault, allowed }).onConflictDoUpdate({ allowed });
});
