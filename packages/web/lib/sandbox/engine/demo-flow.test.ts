// PRD demo steps 1 to 7 against the real Zal bytecode in the sandbox EVM (AT-09).

import {
  createPublicClient,
  custom,
  encodeFunctionData,
  keccak256,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { beforeAll, describe, expect, test } from "vitest";

import { SANDBOX_BOTS, sandboxDeployment as d } from "../config";
import { readDemoPartners, type DemoPartner } from "../partners";

import { cosign, runBots } from "./bots";
import { openSandboxChain, type SandboxChain } from "./chain";
import { canvasOf, createDemoPartner, read, seedSandbox, write } from "./seed";

import {
  canvasAccountAbi,
  zusdcAbi,
  relationshipRegistryAbi,
  zalFactoryAbi,
  zalFundingPoolAbi,
  zalInvoiceAbi,
  zalVaultAbi,
} from "@/contracts/abis";
import { sandboxChain } from "@/config/chains";
import { buildCanvasGraph, type CanvasNodeData } from "@/lib/canvas/graph";
import { deriveNotifications } from "@/lib/canvas/notifications";
import { readCanvasState } from "@/lib/contracts/canvas-reads";
import { toAppError } from "@/lib/query/errors";

const USER: Address = "0x1111111111111111111111111111111111111111";
const DAY = 86_400;
const usdc = (n: number) => BigInt(n) * 1_000_000n;

async function settle(
  chain: SandboxChain,
  options?: Parameters<typeof runBots>[1],
) {
  for (let i = 0; i < 10; i++)
    if ((await runBots(chain, options)) === 0) return;
  throw new Error("bots did not settle");
}

/** What the visitor's canvas draws, read the way the page reads it. */
async function canvas(chain: SandboxChain) {
  const client = createPublicClient({
    chain: sandboxChain,
    transport: custom({
      request: ({ method, params }) => chain.request(method, params),
    }),
  });
  const state = await readCanvasState({ client, addresses: d, wallet: USER });
  const graph = buildCanvasGraph(state, { vault: d.vault });
  const node = (id: string): CanvasNodeData | undefined =>
    graph.nodes.find((n) => n.id === id)?.data;

  return { state, graph, node };
}

const balance = async (chain: SandboxChain, who: Address) =>
  (await read(chain, d.usdc, zusdcAbi, "balanceOf", [who])) as bigint;

describe("sandbox runs the PRD demo on the real bytecode", () => {
  let chain: SandboxChain;
  let account: Address;
  let club: Address;
  let relId: bigint;
  let invoiceId: bigint;

  beforeAll(async () => {
    chain = await openSandboxChain();
    ({ userAccount: account, club } = await seedSandbox(chain, USER));
  });

  test("seed: the visitor's account holds testnet USDC and the pool has LP cash", async () => {
    expect(await balance(chain, account)).toBe(usdc(10_000));
    expect(await read(chain, d.pool, zalFundingPoolAbi, "idleCash", [])).toBe(
      usdc(50_000),
    );
  });

  test("step 1: a Split of 10% to the simulated vault and 90% held", async () => {
    await write(chain, USER, account, canvasAccountAbi, "setRoute", [
      [
        { kind: 2, target: d.vault, bps: 1000 },
        {
          kind: 0,
          target: "0x0000000000000000000000000000000000000000",
          bps: 9000,
        },
      ],
    ]);
    await write(chain, USER, account, canvasAccountAbi, "setEndpointPublic", [
      true,
    ]);
    const route = (await read(
      chain,
      account,
      canvasAccountAbi,
      "getRoute",
      [],
    )) as { bps: number }[];

    expect(route.map((leg) => leg.bps)).toEqual([1000, 9000]);
  });

  test("steps 2 and 3: the club accepts the relationship the visitor proposes", async () => {
    await write(chain, USER, account, canvasAccountAbi, "proposeRelationship", [
      club,
      1,
      0n,
    ]);
    relId = (await read(
      chain,
      d.registry,
      relationshipRegistryAbi,
      "relationshipCount",
      [],
    )) as bigint;
    const before = (await read(
      chain,
      d.registry,
      relationshipRegistryAbi,
      "getRelationship",
      [relId],
    )) as { status: number };

    expect(before.status).toBe(1);
    expect((await canvas(chain)).node(`rel-${relId}`)?.commitment).toBe(
      "ghost",
    );
    await settle(chain);
    const after3 = await canvas(chain);

    expect(after3.node(`rel-${relId}`)?.commitment).toBe("solid");
    expect(
      after3.graph.edges.find((e) => e.id === `rel-edge-${relId}`)?.label,
    ).toBe("you: seller · them: buyer");
    const after = (await read(
      chain,
      d.registry,
      relationshipRegistryAbi,
      "getRelationship",
      [relId],
    )) as { status: number; seller: Address; buyer: Address };

    expect(after.status).toBe(2);
    expect(after.seller).toBe(account);
    expect(after.buyer).toBe(club);
  });

  test("steps 4 and 5: a 5,000 invoice is approved by 2 of 2 club signers against its budget, then escrowed", async () => {
    const due = BigInt(chain.now() + 30 * DAY);

    await write(chain, USER, account, canvasAccountAbi, "issueInvoice", [
      relId,
      usdc(5_000),
      due,
      keccak256(toHex("invoice #1")),
    ]);
    invoiceId = 1n;
    expect(
      (
        (await read(chain, d.invoices, zalInvoiceAbi, "getInvoice", [
          invoiceId,
        ])) as { status: number }
      ).status,
    ).toBe(1);
    expect((await canvas(chain)).node("invoice-1")?.commitment).toBe("ghost");
    const clubBefore = await balance(chain, club);

    await settle(chain);
    const after5 = await canvas(chain);

    expect(after5.node("invoice-1")).toMatchObject({
      commitment: "solid",
      escrowBacked: true,
      funded: false,
    });
    expect(after5.node("pool")?.kind).toBe("pool");
    const inv = (await read(chain, d.invoices, zalInvoiceAbi, "getInvoice", [
      invoiceId,
    ])) as { status: number; escrowed: bigint };

    expect(inv.status).toBe(2);
    expect(inv.escrowed).toBe(usdc(5_000));
    expect(clubBefore - (await balance(chain, club))).toBe(usdc(5_000));
    const budget = (await read(chain, club, canvasAccountAbi, "budgets", [
      1n,
    ])) as readonly bigint[];

    expect(budget[1]).toBe(usdc(5_000));
    const logs = parseEventLogs({
      abi: canvasAccountAbi,
      logs: (await chain.request("eth_getLogs", [
        { address: club, fromBlock: "0x0" },
      ])) as Log[],
    });
    const confirmations = logs
      .filter((l) => l.eventName === "OpConfirmed")
      .map((l) => (l.args as { confirmations: number }).confirmations);

    expect(confirmations).toEqual([1, 2, 1, 2]);
  });

  test("step 6: the visitor takes an 80% advance and the pool becomes the payment recipient", async () => {
    const before = await balance(chain, account);

    await write(chain, USER, account, canvasAccountAbi, "requestAdvance", [
      invoiceId,
    ]);
    expect((await balance(chain, account)) - before).toBe(usdc(4_000));
    expect(
      await read(chain, d.invoices, zalInvoiceAbi, "ownerOf", [invoiceId]),
    ).toBe(d.pool);
    const after6 = await canvas(chain);

    expect(after6.node("invoice-1")).toMatchObject({ funded: true });
    expect(after6.graph.edges.map((e) => e.id)).toContain("invoice-1-pool");
    expect(after6.graph.edges.map((e) => e.id)).not.toContain(
      "invoice-1-split",
    );
  });

  test("step 7: at the due date the club pays and one transaction settles through the pool and the Split", async () => {
    const advance = (await read(chain, d.pool, zalFundingPoolAbi, "advanceOf", [
      invoiceId,
    ])) as { principal: bigint; fee: bigint };
    const reserve = usdc(5_000) - advance.principal - advance.fee;
    const accountBefore = await balance(chain, account);
    const poolAssetsBefore = (await read(
      chain,
      d.pool,
      zalFundingPoolAbi,
      "totalAssets",
      [],
    )) as bigint;

    // Not yet due: the club holds the escrow.
    await settle(chain);
    expect(
      (
        (await read(chain, d.invoices, zalInvoiceAbi, "getInvoice", [
          invoiceId,
        ])) as { status: number }
      ).status,
    ).toBe(2);

    const { dueDate } = (await read(
      chain,
      d.invoices,
      zalInvoiceAbi,
      "getInvoice",
      [invoiceId],
    )) as { dueDate: bigint };
    const strangerPays = {
      from: "0x2222222222222222222222222222222222222222",
      to: d.invoices,
      data: encodeFunctionData({
        abi: zalInvoiceAbi,
        functionName: "payInvoice",
        args: [invoiceId],
      }),
    };

    await expect(
      chain.request("eth_call", [strangerPays, "latest"]),
    ).rejects.toThrow();
    await chain.advanceTo(Number(dueDate));
    const latest = (await chain.request("eth_getBlockByNumber", [
      "latest",
      false,
    ])) as { timestamp: Hex };

    expect(BigInt(latest.timestamp)).toBeGreaterThanOrEqual(dueDate);
    // Escrowed and due, so anyone may now pay (ZR-PAY): the EVM sees the advanced clock.
    await expect(
      chain.request("eth_call", [strangerPays, "latest"]),
    ).resolves.toBeDefined();
    await settle(chain);

    expect(
      (
        (await read(chain, d.invoices, zalInvoiceAbi, "getInvoice", [
          invoiceId,
        ])) as { status: number }
      ).status,
    ).toBe(3);
    expect(
      (await read(
        chain,
        d.pool,
        zalFundingPoolAbi,
        "totalAssets",
        [],
      )) as bigint,
    ).toBe(poolAssetsBefore + advance.fee);
    const toVault = (reserve * 1000n) / 10_000n;

    expect((await balance(chain, account)) - accountBefore).toBe(
      reserve - toVault,
    );
    const shares = (await read(chain, d.vault, zalVaultAbi, "balanceOf", [
      account,
    ])) as bigint;

    expect(
      await read(chain, d.vault, zalVaultAbi, "convertToAssets", [shares]),
    ).toBe(toVault);

    const paid = parseEventLogs({
      abi: zalInvoiceAbi,
      logs: (await chain.request("eth_getLogs", [
        { address: d.invoices, fromBlock: "0x0" },
      ])) as Log[],
    }).find((l) => l.eventName === "InvoicePaid");

    expect(paid).toBeDefined();
    const receipt = (await chain.request("eth_getTransactionReceipt", [
      paid?.transactionHash,
    ])) as { logs: Log[] };
    const names = [
      ...parseEventLogs({ abi: zalInvoiceAbi, logs: receipt.logs }),
      ...parseEventLogs({ abi: zalFundingPoolAbi, logs: receipt.logs }),
      ...parseEventLogs({ abi: canvasAccountAbi, logs: receipt.logs }),
    ].map((l) => l.eventName);

    expect(names).toEqual(
      expect.arrayContaining([
        "InvoicePaid",
        "Repaid",
        "PaymentRouted",
        "OpExecuted",
      ]),
    );
    const after7 = await canvas(chain);

    expect(after7.node("invoice-1")).toMatchObject({ commitment: "solid" });
    expect(after7.state.invoices[0]?.status).toBe("paid");
    expect(after7.state.activity.map((a) => a.title)).toEqual(
      expect.arrayContaining([
        "Invoice #1 paid",
        "Payment for invoice #1 ran through the Split",
      ]),
    );
    expect(
      deriveNotifications(after7.state).map((n) => [n.kind, n.nodeId]),
    ).toEqual([
      ["paymentReceived", "invoice-1"],
      ["advancePaid", "invoice-1"],
      // The seeded print shop's proposal to the visitor; the visitor's own proposal is not news.
      ["proposalReceived", "rel-1"],
    ]);
    expect(advance.principal).toBe(usdc(4_000));
    expect(advance.fee).toBeGreaterThan(usdc(49));
    expect(advance.fee).toBeLessThan(usdc(51));
  });

  test("an unescrowed invoice advances only on the enrolled club's credit line", async () => {
    const due = BigInt(chain.now() + 30 * DAY);

    await write(chain, USER, account, canvasAccountAbi, "issueInvoice", [
      relId,
      usdc(1_000),
      due,
      keccak256(toHex("invoice #2")),
    ]);
    await runBots(chain); // approve only; escrow would come on the next pass
    const inv = (await read(chain, d.invoices, zalInvoiceAbi, "getInvoice", [
      2n,
    ])) as { status: number; escrowed: bigint };

    expect(inv).toMatchObject({ status: 2, escrowed: 0n });
    await write(chain, USER, account, canvasAccountAbi, "requestAdvance", [2n]);
    expect(
      await read(chain, d.pool, zalFundingPoolAbi, "obligorOutstanding", [
        club,
      ]),
    ).toBe(usdc(800));
  });

  test("transient-storage reentrancy guards reset between transactions", async () => {
    // Every guarded entry above ran in its own transaction; a guard that kept its TSTORE slot would revert the next one.
    const data: Hex = encodeFunctionData({
      abi: canvasAccountAbi,
      functionName: "vaultDeposit",
      args: [d.vault, usdc(1)],
    });

    await chain.send({ from: USER, to: account, data });
    await chain.send({ from: USER, to: account, data });
  });

  test("replaying the journal rebuilds the same chain", async () => {
    const replayed = await openSandboxChain(chain.journal(), chain.offset());

    expect(await balance(replayed, account)).toBe(
      await balance(chain, account),
    );
    expect(await replayed.request("eth_blockNumber")).toBe(
      await chain.request("eth_blockNumber"),
    );
  });
});

describe("sandbox lets the visitor buy from the print shop and lend as an LP", () => {
  let chain: SandboxChain;
  let account: Address;
  let printShop: Address;
  const relId = 1n;
  const invoiceId = 1n;

  const invoiceOf = async (id: bigint) =>
    (await read(chain, d.invoices, zalInvoiceAbi, "getInvoice", [id])) as {
      status: number;
      escrowed: bigint;
      faceValue: bigint;
      dueDate: bigint;
      buyer: Address;
    };
  const submit = (data: Hex) =>
    write(chain, USER, account, canvasAccountAbi, "submit", [data]);
  const opCount = async () =>
    (await read(chain, account, canvasAccountAbi, "opCount", [])) as bigint;

  beforeAll(async () => {
    chain = await openSandboxChain();
    ({ userAccount: account, printShop } = await seedSandbox(chain, USER));
  });

  test("the print shop's proposal waits in the visitor's Inbox as a ghost", async () => {
    const { node, graph } = await canvas(chain);

    expect(node(`rel-${relId}`)).toMatchObject({
      commitment: "ghost",
      awaitingMe: true,
      theirRole: "seller",
    });
    expect(graph.inbox).toContain(`rel-${relId}`);
  });

  test("once accepted, the print shop issues one invoice to the visitor's account", async () => {
    await write(chain, USER, account, canvasAccountAbi, "acceptRelationship", [
      relId,
    ]);
    await settle(chain);
    const inv = await invoiceOf(invoiceId);

    expect(inv).toMatchObject({
      status: 1,
      faceValue: usdc(1_200),
      buyer: account,
    });
    expect((await canvas(chain)).node("invoice-1")).toMatchObject({
      myRole: "buyer",
      awaitingMe: true,
    });
    await settle(chain);
    expect(
      await read(chain, d.invoices, zalInvoiceAbi, "invoiceCount", []),
    ).toBe(1n);
  });

  test("with a 2 of 2 policy, approval waits for the sandbox co-signer and then charges the budget", async () => {
    await write(chain, USER, account, canvasAccountAbi, "setBudget", [
      1n,
      usdc(5_000),
      0n,
    ]);
    await write(chain, USER, account, canvasAccountAbi, "setPolicy", [
      2,
      usdc(500),
    ]);
    await submit(
      encodeFunctionData({
        abi: canvasAccountAbi,
        functionName: "approveInvoice",
        args: [invoiceId, 1n],
      }),
    );
    const opId = await opCount();
    const waiting = (await canvas(chain)).state.account.ops.find(
      (op) => op.opId === opId,
    );

    expect(waiting).toMatchObject({
      confirmations: 1,
      required: 2,
      executed: false,
    });
    expect((await invoiceOf(invoiceId)).status).toBe(1);

    await cosign(chain, account, opId);
    expect((await invoiceOf(invoiceId)).status).toBe(2);
    const budget = (await read(chain, account, canvasAccountAbi, "budgets", [
      1n,
    ])) as readonly bigint[];

    expect(budget[1]).toBe(usdc(1_200));
  });

  test("escrow also needs both signatures, then locks the face value", async () => {
    const before = await balance(chain, account);

    await submit(
      encodeFunctionData({
        abi: canvasAccountAbi,
        functionName: "escrowInvoice",
        args: [invoiceId],
      }),
    );
    expect((await invoiceOf(invoiceId)).escrowed).toBe(0n);
    await cosign(chain, account, await opCount());
    expect((await invoiceOf(invoiceId)).escrowed).toBe(usdc(1_200));
    expect(before - (await balance(chain, account))).toBe(usdc(1_200));
  });

  const createSchedule = (args: {
    kind: 0 | 1;
    recipient?: Address;
    invoiceId?: bigint;
    amount?: bigint;
    start: number;
    interval: number;
    runs: number;
  }) =>
    submit(
      encodeFunctionData({
        abi: canvasAccountAbi,
        functionName: "createSchedule",
        args: [
          args.kind,
          args.recipient ?? "0x0000000000000000000000000000000000000000",
          args.invoiceId ?? 0n,
          args.amount ?? 0n,
          BigInt(args.start),
          args.interval,
          args.runs,
        ],
      }),
    );

  test("a pay-at schedule is a ghost until co-signed, then the keeper pays the invoice at that time (ZR-SCH-01, ZR-SCH-05)", async () => {
    const shopBefore = await balance(chain, printShop);
    const start = chain.now() + 120;

    await createSchedule({ kind: 1, invoiceId, start, interval: 0, runs: 1 });
    const opId = await opCount();

    expect((await canvas(chain)).node(`schedule-op-${opId}`)).toMatchObject({
      commitment: "ghost",
      schedule: { status: "pending", kind: "payInvoice", invoiceId },
    });
    await cosign(chain, account, opId);
    expect((await canvas(chain)).node("schedule-1")).toMatchObject({
      commitment: "solid",
      schedule: { status: "active", nextAt: start, remaining: 1 },
    });

    await settle(chain);
    expect((await invoiceOf(invoiceId)).status).toBe(2);

    await chain.advanceTo(start);
    await settle(chain);
    expect((await invoiceOf(invoiceId)).status).toBe(3);
    expect((await balance(chain, printShop)) - shopBefore).toBe(usdc(1_200));
    const after = await canvas(chain);

    expect(after.node("schedule-1")).toMatchObject({
      commitment: "ended",
      schedule: { status: "ended", remaining: 0 },
    });
    expect(after.state.activity.map((a) => a.title)).toContain(
      "Schedule #1 ran",
    );
  });

  test("a recurring transfer every 60 s for 3 runs pays 3 times after a day, then ends (ZR-SCH-02, ZR-SCH-06)", async () => {
    const shopBefore = await balance(chain, printShop);
    const start = chain.now() + 90;

    await createSchedule({
      kind: 0,
      recipient: printShop,
      amount: usdc(100),
      start,
      interval: 60,
      runs: 3,
    });
    const opId = await opCount();
    const live = await canvas(chain);

    // Priced at amount × runs: 300 is within the 500 USDC limit, so one signature executes it.
    expect(live.state.account.ops.find((op) => op.opId === opId)).toMatchObject(
      { amount: usdc(300), executed: true },
    );

    expect(live.node("schedule-2")).toMatchObject({
      commitment: "solid",
      schedule: { kind: "transfer", remaining: 3, interval: 60 },
    });
    expect(
      live.graph.edges.find((e) => e.source === "schedule-2")?.target,
    ).toBe(`rel-${relId}`);

    await chain.advanceTo(chain.now() + DAY);
    await settle(chain);
    expect((await balance(chain, printShop)) - shopBefore).toBe(usdc(300));
    const done = await canvas(chain);

    expect(done.node("schedule-2")).toMatchObject({
      commitment: "ended",
      schedule: { status: "ended", remaining: 0 },
    });
    expect(
      deriveNotifications(done.state).filter((n) => n.kind === "scheduleRan"),
    ).toHaveLength(4);
  });

  test("one signature spends at most 500 USDC per 24 h across ops, then the co-signer is needed (ZR-ACC-11, AT-26)", async () => {
    const withdraw = (amount: bigint) =>
      submit(
        encodeFunctionData({
          abi: canvasAccountAbi,
          functionName: "withdraw",
          args: [printShop, amount],
        }),
      );
    const window = async () =>
      (await read(chain, account, canvasAccountAbi, "spendWindow", [])) as [
        bigint,
        bigint,
        bigint,
      ];

    await withdraw(usdc(400));
    expect((await window()).slice(1)).toEqual([usdc(400), usdc(100)]);

    await withdraw(usdc(200));
    const opId = await opCount();

    expect(
      (await canvas(chain)).state.account.ops.find((op) => op.opId === opId),
    ).toMatchObject({ confirmations: 1, required: 2, executed: false });

    await cosign(chain, account, opId);
    expect(
      (await canvas(chain)).state.account.ops.find((op) => op.opId === opId),
    ).toMatchObject({ executed: true });
    expect((await window())[1]).toBe(usdc(400));

    await chain.advanceTo(chain.now() + DAY);
    await withdraw(usdc(200));
    expect(
      (await canvas(chain)).state.account.ops.find(
        (op) => op.opId === opId + 1n,
      ),
    ).toMatchObject({ confirmations: 1, executed: true });
  });

  test("after settlement the print shop issues its next invoice", async () => {
    await settle(chain);
    expect(await invoiceOf(2n)).toMatchObject({
      status: 1,
      faceValue: usdc(800),
    });
  });

  test("the visitor's wallet deposits into the pool as an LP and withdraws again", async () => {
    const walletBefore = await balance(chain, USER);

    expect(walletBefore).toBe(usdc(5_000));
    await write(chain, USER, d.usdc, zusdcAbi, "approve", [
      d.pool,
      usdc(1_000),
    ]);
    await write(chain, USER, d.pool, zalFundingPoolAbi, "deposit", [
      usdc(1_000),
      USER,
    ]);
    const { state, node } = await canvas(chain);

    expect(state.lp.assets).toBe(usdc(1_000));
    expect(node("pool")).toMatchObject({ kind: "pool", lpAssets: usdc(1_000) });

    await write(chain, USER, d.pool, zalFundingPoolAbi, "withdraw", [
      state.lp.maxWithdraw,
      USER,
      USER,
    ]);
    expect(await balance(chain, USER)).toBe(walletBefore);
  });
});

describe("the visitor can relate to any number of demo partners", () => {
  let chain: SandboxChain;
  let account: Address;
  let club: Address;
  let buyer: DemoPartner;
  let seller: DemoPartner;

  const relationshipCount = async () =>
    (await read(
      chain,
      d.registry,
      relationshipRegistryAbi,
      "relationshipCount",
      [],
    )) as bigint;
  const propose = (counterparty: Address, myRole: 0 | 1) =>
    write(chain, USER, account, canvasAccountAbi, "proposeRelationship", [
      counterparty,
      myRole,
      0n,
    ]);
  const partners = (on: SandboxChain) =>
    readDemoPartners((admin) => canvasOf(on, admin));

  beforeAll(async () => {
    chain = await openSandboxChain();
    ({ userAccount: account, club } = await seedSandbox(chain, USER));
    await propose(club, 1);
    await write(chain, USER, account, canvasAccountAbi, "acceptRelationship", [
      1n,
    ]);
    await settle(chain);
  });

  test("with both seeded bots related, creating partners adds numbered canvases", async () => {
    const { graph } = await canvas(chain);

    expect(
      graph.nodes.filter((n) => n.data.commitment === "solid").length,
    ).toBeGreaterThan(0);
    expect(await partners(chain)).toEqual([]);
    buyer = await createDemoPartner(chain, "buyer");
    seller = await createDemoPartner(chain, "seller");

    expect([buyer.name, seller.name]).toEqual([
      "Demo partner 1",
      "Demo partner 2",
    ]);
    expect(await partners(chain)).toEqual([buyer, seller]);
    expect(
      await read(chain, d.factory, zalFactoryAbi, "isAccount", [
        seller.account,
      ]),
    ).toBe(true);
  });

  test("a buying partner accepts the proposal, then approves and escrows the invoice", async () => {
    await propose(buyer.account, 1);
    const relId = await relationshipCount();

    expect((await canvas(chain)).node(`rel-${relId}`)?.commitment).toBe(
      "ghost",
    );
    await settle(chain);
    expect((await canvas(chain)).node(`rel-${relId}`)?.commitment).toBe(
      "solid",
    );

    await write(chain, USER, account, canvasAccountAbi, "issueInvoice", [
      relId,
      usdc(700),
      BigInt(chain.now() + 30 * DAY),
      keccak256(toHex("partner invoice")),
    ]);
    const invoiceId = (await read(
      chain,
      d.invoices,
      zalInvoiceAbi,
      "invoiceCount",
      [],
    )) as bigint;

    await settle(chain);
    const inv = (await read(chain, d.invoices, zalInvoiceAbi, "getInvoice", [
      invoiceId,
    ])) as { status: number; escrowed: bigint };

    expect(inv).toMatchObject({ status: 2, escrowed: usdc(700) });
  });

  test("a selling partner accepts the proposal and issues an invoice to the visitor", async () => {
    await propose(seller.account, 0);
    const relId = await relationshipCount();

    await settle(chain);
    const issued = parseEventLogs({
      abi: zalInvoiceAbi,
      logs: (await chain.request("eth_getLogs", [
        { address: d.invoices, fromBlock: "0x0", toBlock: "latest" },
      ])) as Log[],
    }).filter(
      (log) =>
        log.eventName === "InvoiceIssued" && log.args.relationshipId === relId,
    );

    expect(issued).toHaveLength(1);
    expect(
      issued[0]?.eventName === "InvoiceIssued" && issued[0].args.buyer,
    ).toBe(account);
  });

  test("partners survive a journal replay", async () => {
    const replayed = await openSandboxChain(chain.journal(), chain.offset());

    expect(await partners(replayed)).toEqual([buyer, seller]);
  });

  test("proposing to a wallet reverts with NotAccount, which reads as plain language", async () => {
    const client = createPublicClient({
      chain: sandboxChain,
      transport: custom({
        request: ({ method, params }) => chain.request(method, params),
      }),
    });
    const error = await client
      .simulateContract({
        account: USER,
        address: account,
        abi: canvasAccountAbi,
        functionName: "proposeRelationship",
        args: [SANDBOX_BOTS.lp, 1, 0n],
      })
      .catch((e: unknown) => e);

    expect(toAppError(error).message).toBe("Not a Zal canvas");
  });
});
