// The sandbox counterparties behave like real ones would. Every action is a real transaction from a bot wallet.
// - The demo club buys from the visitor: it accepts relationships proposed to it, approves each invoice against
//   its Events budget with both signers, escrows it, and pays it once the due date arrives.
// - The demo print shop sells to the visitor: once the visitor accepts its proposal, it issues one invoice at a
//   time, the next after the previous one is settled or ended.
// - Each demo partner the visitor creates behaves like one of them: a buyer like the club (one signer), a seller
//   like the print shop.
// - Every bot counterparty accepts a relationship the visitor proposes to it.
// - The keeper runs every due schedule on every canvas. `runSchedule` is permissionless and pays only
//   what the account approved, so the keeper holds no rights over anyone's account.
//
// `runBots` reconciles from chain state instead of reacting to single events, so a tick that was interrupted (a
// reload, a failed confirmation) is finished by the next one, and running it twice does nothing new.

import type { SandboxChain } from "./chain";

import {
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  toHex,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type Log,
} from "viem";

import { SANDBOX_BOTS, SANDBOX_SEED, sandboxDeployment as d } from "../config";
import { readDemoPartners } from "../partners";

import { accountOf, canvasOf, read, write } from "./seed";

import {
  canvasAccountAbi,
  relationshipRegistryAbi,
  zalFactoryAbi,
  zalInvoiceAbi,
} from "@/contracts/abis";

const RelStatus = { Proposed: 1, Active: 2 } as const;
const InvoiceStatus = { Issued: 1, Approved: 2 } as const;
const DAY = 86_400;
const EVENTS_BUDGET = 1n;

async function logsOf<const TAbi extends Abi>(
  chain: SandboxChain,
  address: Address,
  abi: TAbi,
) {
  const raw = (await chain.request("eth_getLogs", [
    { address, fromBlock: "0x0", toBlock: "latest" },
  ])) as Log[];

  return parseEventLogs({ abi, logs: raw });
}

/** A sandbox counterparty: its canvas, the bot wallets that sign for it, and what it does toward the visitor. */
type Bot =
  | {
      readonly role: "buyer";
      readonly account: Address;
      readonly admin: Address;
      /** A second signer; spending then needs both (policy 2 of 2). */
      readonly treasurer?: Address;
    }
  | {
      readonly role: "seller";
      readonly account: Address;
      readonly admin: Address;
      /** Names its invoice documents. */
      readonly label: string;
    };

async function botsOf(chain: SandboxChain): Promise<Bot[]> {
  const partners = await readDemoPartners((admin) => canvasOf(chain, admin));

  return [
    {
      role: "buyer",
      account: await accountOf(chain, SANDBOX_BOTS.clubAdmin),
      admin: SANDBOX_BOTS.clubAdmin,
      treasurer: SANDBOX_BOTS.clubTreasurer,
    },
    {
      role: "seller",
      account: await accountOf(chain, SANDBOX_BOTS.printShopAdmin),
      admin: SANDBOX_BOTS.printShopAdmin,
      label: "print shop",
    },
    ...partners.map(({ role, account, admin, name }): Bot =>
      role === "buyer"
        ? { role, account, admin }
        : { role, account, admin, label: name.toLowerCase() },
    ),
  ];
}

type Buyer = Extract<Bot, { role: "buyer" }>;
type Seller = Extract<Bot, { role: "seller" }>;

interface GatedOp {
  readonly opId: bigint;
  readonly data: Hex;
  readonly executed: boolean;
}

async function opsOf(
  chain: SandboxChain,
  account: Address,
): Promise<GatedOp[]> {
  const logs = await logsOf(chain, account, canvasAccountAbi);
  const executed = new Set(
    logs.flatMap((log) =>
      log.eventName === "OpExecuted" ? [log.args.opId] : [],
    ),
  );

  return logs.flatMap((log) =>
    log.eventName === "OpSubmitted"
      ? [
          {
            opId: log.args.opId,
            data: log.args.data,
            executed: executed.has(log.args.opId),
          },
        ]
      : [],
  );
}

/**
 * Runs a gated operation of a buying bot to completion: the admin submits, which executes it at once with one
 * signer; with a treasurer (policy 2 of 2), the treasurer confirms.
 */
async function runGatedOp(
  chain: SandboxChain,
  buyer: Buyer,
  data: Hex,
): Promise<void> {
  const ops = await opsOf(chain, buyer.account);
  const pending = ops.find((op) => op.data === data && !op.executed);

  if (pending === undefined) {
    if (ops.some((op) => op.data === data)) return;
    await write(chain, buyer.admin, buyer.account, canvasAccountAbi, "submit", [
      data,
    ]);
    const submitted = (await opsOf(chain, buyer.account)).find(
      (op) => op.data === data && !op.executed,
    );

    if (submitted === undefined || buyer.treasurer === undefined) return;
    await write(
      chain,
      buyer.treasurer,
      buyer.account,
      canvasAccountAbi,
      "confirm",
      [submitted.opId],
    );

    return;
  }
  if (buyer.treasurer === undefined) return;
  const confirmed = await read(
    chain,
    buyer.account,
    canvasAccountAbi,
    "hasConfirmed",
    [pending.opId, buyer.treasurer],
  );

  if (!confirmed) {
    await write(
      chain,
      buyer.treasurer,
      buyer.account,
      canvasAccountAbi,
      "confirm",
      [pending.opId],
    );
  }
}

const gated = (
  functionName: "approveInvoice" | "escrowInvoice" | "payInvoice",
  id: bigint,
): Hex =>
  functionName === "approveInvoice"
    ? encodeFunctionData({
        abi: canvasAccountAbi,
        functionName,
        args: [id, EVENTS_BUDGET],
      })
    : encodeFunctionData({ abi: canvasAccountAbi, functionName, args: [id] });

interface InvoiceView {
  readonly status: number;
  readonly escrowed: bigint;
  readonly faceValue: bigint;
  readonly dueDate: bigint;
}

export interface BotOptions {
  /** Pay this invoice now, before its due date; early payment is allowed. */
  readonly payNow?: bigint;
}

const readInvoice = async (chain: SandboxChain, id: bigint) =>
  (await read(chain, d.invoices, zalInvoiceAbi, "getInvoice", [
    id,
  ])) as InvoiceView;

/** Issues a selling bot's next invoice on each active relationship where it sells and nothing is open. */
async function runSeller(chain: SandboxChain, seller: Seller): Promise<number> {
  const invoiceLogs = await logsOf(chain, d.invoices, zalInvoiceAbi);
  let actions = 0;

  for (const log of await logsOf(chain, d.registry, relationshipRegistryAbi)) {
    if (
      log.eventName !== "RelationshipProposed" ||
      !isAddressEqual(log.args.seller, seller.account)
    )
      continue;
    const relId = log.args.id;
    const rel = (await read(
      chain,
      d.registry,
      relationshipRegistryAbi,
      "getRelationship",
      [relId],
    )) as { status: number };

    if (rel.status !== RelStatus.Active) continue;
    const issued = invoiceLogs.flatMap((l) =>
      l.eventName === "InvoiceIssued" && l.args.relationshipId === relId
        ? [l.args.id]
        : [],
    );
    const states = await Promise.all(
      issued.map((id) => readInvoice(chain, id)),
    );
    const open = states.some(
      (inv) =>
        inv.status === InvoiceStatus.Issued ||
        inv.status === InvoiceStatus.Approved,
    );
    const face = SANDBOX_SEED.printShopInvoices[issued.length];

    if (open || face === undefined) continue;
    await write(
      chain,
      seller.admin,
      seller.account,
      canvasAccountAbi,
      "issueInvoice",
      [
        relId,
        face,
        BigInt(chain.now() + SANDBOX_SEED.printShopDueDays * DAY),
        keccak256(
          toHex(`sandbox ${seller.label} invoice ${relId}/${issued.length}`),
        ),
      ],
    );
    actions += 1;
  }

  return actions;
}

/** A buying bot approves each invoice to it against its Events budget, escrows it, and pays it when due. */
async function runBuyer(
  chain: SandboxChain,
  buyer: Buyer,
  payNow: bigint | undefined,
): Promise<number> {
  let actions = 0;

  for (const log of await logsOf(chain, d.invoices, zalInvoiceAbi)) {
    if (
      log.eventName !== "InvoiceIssued" ||
      !isAddressEqual(log.args.buyer, buyer.account)
    )
      continue;
    const id = log.args.id;
    const inv = await readInvoice(chain, id);

    if (inv.status === InvoiceStatus.Issued) {
      await runGatedOp(chain, buyer, gated("approveInvoice", id));
      actions += 1;
      continue;
    }
    if (inv.status !== InvoiceStatus.Approved) continue;
    if (inv.escrowed === 0n) {
      await runGatedOp(chain, buyer, gated("escrowInvoice", id));
      actions += 1;
      continue;
    }
    if (BigInt(chain.now()) >= inv.dueDate || payNow === id) {
      await runGatedOp(chain, buyer, gated("payInvoice", id));
      actions += 1;
    }
  }

  return actions;
}

/** Every bot accepts a relationship someone else proposed to it. */
async function acceptProposals(
  chain: SandboxChain,
  bots: readonly Bot[],
): Promise<number> {
  let actions = 0;

  for (const log of await logsOf(chain, d.registry, relationshipRegistryAbi)) {
    if (log.eventName !== "RelationshipProposed") continue;
    const { id, buyer, seller, proposer } = log.args;
    const bot = bots.find(
      (b) =>
        (isAddressEqual(buyer, b.account) ||
          isAddressEqual(seller, b.account)) &&
        !isAddressEqual(proposer, b.account),
    );

    if (bot === undefined) continue;
    const rel = (await read(
      chain,
      d.registry,
      relationshipRegistryAbi,
      "getRelationship",
      [id],
    )) as { status: number };

    if (rel.status !== RelStatus.Proposed) continue;
    await write(
      chain,
      bot.admin,
      bot.account,
      canvasAccountAbi,
      "acceptRelationship",
      [id],
    );
    actions += 1;
  }

  return actions;
}

interface StoredSchedule {
  readonly nextAt: bigint;
  readonly active: boolean;
}

/** Every active schedule on every canvas, with the account that stores it. */
async function activeSchedules(chain: SandboxChain) {
  const created = await logsOf(chain, d.factory, zalFactoryAbi);
  const accounts = created.flatMap((log) =>
    log.eventName === "AccountCreated" ? [log.args.account] : [],
  );
  const found: { account: Address; id: bigint; nextAt: number }[] = [];

  for (const account of accounts) {
    const count = (await read(
      chain,
      account,
      canvasAccountAbi,
      "scheduleCount",
      [],
    )) as bigint;

    for (let id = 1n; id <= count; id += 1n) {
      const s = (await read(chain, account, canvasAccountAbi, "getSchedule", [
        id,
      ])) as StoredSchedule;

      if (s.active) found.push({ account, id, nextAt: Number(s.nextAt) });
    }
  }

  return found;
}

/**
 * Runs each due schedule once per pass, so a schedule that fell behind catches up one run per tick. A run that
 * reverts (the account lacks the balance, or its invoice was paid another way) stays due; like the real keeper,
 * this one skips it and tries again on the next pass instead of stopping the other bots.
 */
async function runKeeper(chain: SandboxChain): Promise<number> {
  let actions = 0;

  for (const { account, id, nextAt } of await activeSchedules(chain)) {
    if (chain.now() < nextAt) continue;
    try {
      await write(
        chain,
        SANDBOX_BOTS.keeper,
        account,
        canvasAccountAbi,
        "runSchedule",
        [id],
      );
      actions += 1;
    } catch {
      // Left due on-chain; the next pass retries it.
    }
  }

  return actions;
}

/** The chain time the next active schedule falls due, so the runtime can wake the keeper then. */
export async function nextScheduleDue(
  chain: SandboxChain,
): Promise<number | undefined> {
  const due = (await activeSchedules(chain)).map((s) => s.nextAt);

  return due.length === 0 ? undefined : Math.min(...due);
}

/** The sandbox co-signer confirms one pending operation on the visitor's account. */
export async function cosign(
  chain: SandboxChain,
  account: Address,
  opId: bigint,
): Promise<void> {
  await write(
    chain,
    SANDBOX_BOTS.cosigner,
    account,
    canvasAccountAbi,
    "confirm",
    [opId],
  );
}

/** One reconciliation pass. Returns how many actions it took, so callers can tell whether anything moved. */
export async function runBots(
  chain: SandboxChain,
  options: BotOptions = {},
): Promise<number> {
  const bots = await botsOf(chain);
  let actions = 0;

  for (const bot of bots)
    if (bot.role === "seller") actions += await runSeller(chain, bot);
  actions += await runKeeper(chain);
  actions += await acceptProposals(chain, bots);
  for (const bot of bots)
    if (bot.role === "buyer")
      actions += await runBuyer(chain, bot, options.payNow);

  return actions;
}
