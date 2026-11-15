// The guided demo (story S1): the eight PRD demo steps, each checked off from chain state, plus the buyer and LP
// roles the sandbox adds. Pure, so detection is tested without a browser. A step is never ticked by a click, only
// by what the chain shows.

import type { CanvasState, Invoice } from "./types";

import { isAddressEqual } from "viem";

import { isEscrowBacked, isFunded, nodeId } from "./graph";

export interface DemoStep {
  readonly title: string;
  readonly done: boolean;
  /** What to do for this step, shown while it is the next one. */
  readonly hint: string;
  /** The node the hint is about; the canvas flies there. */
  readonly focus?: string;
}

export interface DemoTrack {
  readonly steps: readonly DemoStep[];
  /** The first step not done yet. */
  readonly next: DemoStep | undefined;
  readonly done: number;
}

const track = (steps: readonly DemoStep[]): DemoTrack => ({
  steps,
  next: steps.find((step) => !step.done),
  done: steps.filter((step) => step.done).length,
});

const latest = <T>(items: readonly T[]): T | undefined =>
  items[items.length - 1];

/** The PRD demo script, as the seller: steps 1 to 8. */
export function sellerDemo(state: CanvasState): DemoTrack {
  const me = state.account.address;
  const pool = state.pool.address;
  const proposedAsSeller = state.relationships.filter(
    (rel) =>
      isAddressEqual(rel.seller, me) &&
      isAddressEqual(rel.proposer, me) &&
      (rel.status === "proposed" || rel.status === "active"),
  );
  const active = proposedAsSeller.filter((rel) => rel.status === "active");
  const rel = latest(active) ?? latest(proposedAsSeller);
  const relIds = new Set(active.map((r) => r.id));
  const issued = state.invoices.filter(
    (inv) =>
      relIds.has(inv.relationshipId) &&
      inv.status !== "cancelled" &&
      inv.status !== "rejected",
  );
  const committed = issued.filter(
    (inv) =>
      inv.status === "paid" ||
      (inv.status === "approved" && isEscrowBacked(inv)),
  );
  const financed = issued.filter((inv) => isFunded(inv, pool));
  const settled = financed.filter((inv) => inv.status === "paid");
  const focusInvoice = (list: readonly Invoice[]) => {
    const inv = latest(list) ?? latest(issued);

    return inv === undefined ? undefined : nodeId.invoice(inv.id);
  };
  const journey = settled.some((inv) => {
    const titles = state.activity.map((a) => a.title);
    const id = `#${inv.id}`;

    return [
      `Invoice ${id} issued`,
      `Invoice ${id} approved`,
      `Invoice ${id} escrowed`,
      `Invoice ${id} advanced by the pool`,
      `Invoice ${id} paid`,
      `Payment for invoice ${id} ran through the Split`,
    ].every((title) => titles.includes(title));
  });
  const relNode =
    rel === undefined ? nodeId.account : nodeId.counterparty(rel.id);

  return track([
    {
      title: "Build the receiving flow, publish the endpoint",
      done: state.account.route.length > 0 && state.account.endpointPublic,
      hint: "Account → Split: Vault 10% (simulated yield), hold 90% · endpoint public",
      focus: nodeId.split,
    },
    {
      title: "Add the club as your buyer",
      done: proposedAsSeller.length > 0,
      hint: "Account → Counterparty · demo club · you are the seller",
      focus: nodeId.account,
    },
    {
      title: "The club accepts: both nodes turn solid",
      done: active.length > 0,
      hint: "Automatic in a few seconds · ghost turns solid",
      focus: relNode,
    },
    {
      title: "Issue a 5,000 USDC invoice due in 30 days",
      done: issued.length > 0,
      hint: "Club → Invoice (Document)",
      focus: relNode,
    },
    {
      title: "The club approves with two signers and escrows",
      done: committed.length > 0,
      hint: "2 club signers · Events budget charged · face value escrowed",
      focus: focusInvoice(issued),
    },
    {
      title: "Take the 80% advance from the funding pool",
      done: financed.length > 0,
      hint: "Approved invoice → Funding pool",
      focus: focusInvoice(committed),
    },
    {
      title: "Due date: one payment settles via pool and Split",
      done: settled.length > 0,
      hint: "Timeline → Jump to due date · one transaction at maturity",
      focus: focusInvoice(financed),
    },
    {
      title: "Follow the money's whole journey",
      done: journey,
      hint: "Timeline: proposal → settlement",
      focus: focusInvoice(settled),
    },
  ]);
}

/** The roles the sandbox adds beyond the PRD script: buying from the print shop, and lending as an LP. */
export function buyerAndLpDemo(state: CanvasState): DemoTrack {
  const me = state.account.address;
  const buying = state.relationships.filter(
    (rel) => isAddressEqual(rel.buyer, me) && !isAddressEqual(rel.proposer, me),
  );
  const activeBuying = buying.filter((rel) => rel.status === "active");
  const rel = latest(activeBuying) ?? latest(buying);
  const bought = state.invoices.filter((inv) => isAddressEqual(inv.buyer, me));
  const openInvoice =
    bought.find(
      (inv) => inv.status === "issued" || inv.status === "approved",
    ) ?? latest(bought);
  const invoiceNode =
    openInvoice === undefined
      ? rel === undefined
        ? nodeId.account
        : nodeId.counterparty(rel.id)
      : nodeId.invoice(openInvoice.id);
  const executedWithTwo = (fn: "approveInvoice" | "escrowInvoice") =>
    state.account.ops.some(
      (op) => op.call.fn === fn && op.executed && op.confirmations >= 2,
    );

  return track([
    {
      title: "Accept the print shop's proposal",
      done: activeBuying.length > 0,
      hint: "Inbox → print shop proposal → Accept",
      focus: rel === undefined ? undefined : nodeId.counterparty(rel.id),
    },
    {
      title: "Add a budget for what you buy",
      done: state.account.budgets.length > 0,
      hint: "Budget (Spend control)",
      focus: nodeId.account,
    },
    {
      title: "Require 2 of 2 signatures",
      done: state.account.threshold >= 2,
      hint: "Approval · 2 signatures · sandbox co-signer is member 2",
      focus:
        state.account.members.length >= 2 ? nodeId.approval : nodeId.account,
    },
    {
      title: "Approve an invoice with two signatures",
      done: executedWithTwo("approveInvoice"),
      hint: "Budget → print shop invoice · approve · co-signer signs",
      focus: invoiceNode,
    },
    {
      title: "Escrow it, again with two signatures",
      done: executedWithTwo("escrowInvoice"),
      hint: "Escrow → approved invoice · co-signer signs",
      focus: invoiceNode,
    },
    {
      title: "Schedule its payment: the keeper runs it on-chain",
      done: state.account.schedules.some(
        (s) => s.kind === "payInvoice" && s.remaining === 0,
      ),
      hint: "Schedule → approved invoice · pay at ≥ 1 min · jump past it",
      focus: invoiceNode,
    },
    {
      title: "Deposit into the funding pool as an LP",
      done: state.lp.shares > 0n,
      hint: "Pool liquidity (Financing) · deposit from wallet",
      focus: state.lp.shares > 0n ? nodeId.pool : nodeId.account,
    },
  ]);
}
