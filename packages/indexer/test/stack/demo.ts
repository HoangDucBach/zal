// Drives the PRD seller demo (steps 1 to 8) on the running docker stack, through the contracts, and checks after
// each step that the /v1 API and the SSE stream show it. Fresh actors each run, so it can rerun on the same chain.
//   docker compose up -d --wait && pnpm --filter @zal/indexer test:stack

import assert from "node:assert/strict";

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseEventLogs,
  toHex,
  zeroAddress,
  zeroHash,
  type Abi,
  type Address,
  type PrivateKeyAccount,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

import {
  canvasAccountAbi,
  zusdcAbi,
  relationshipRegistryAbi,
  zalFactoryAbi,
  zalFundingPoolAbi,
  zalInvoiceAbi,
} from "../../abis/index.ts";
import { readDeployment } from "../../lib/deployment.ts";

const API = process.env.ZAL_API_URL ?? "http://localhost:42069";
const RPC = process.env.ZAL_RPC_URL ?? "http://localhost:8545";
// ZAL_WEB_ORIGIN is the API's allow-list; the demo signs in as its first entry.
const WEB_ORIGIN = (process.env.ZAL_WEB_ORIGIN ?? "http://localhost:3100").split(",")[0]?.trim() ?? "";
const DEPLOYMENT = new URL("../../../contracts/deployments/local.json", import.meta.url).pathname;
const d = readDeployment({ ZAL_CHAIN_ID: "31337", ZAL_RPC_URL: RPC, ZAL_DEPLOYMENT: DEPLOYMENT }).addresses;
// LOCAL ONLY: anvil's well-known account 0, the protocol owner in the local deployment.
const OWNER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

const DAY = 86_400n;
const usdc = (n: number) => BigInt(n) * 1_000_000n;
const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
const client = createPublicClient({ chain, transport: http(RPC) });

// ---- Chain ------------------------------------------------------------------------------------------------------

async function send(from: PrivateKeyAccount, address: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
  const wallet = createWalletClient({ account: from, chain, transport: http(RPC) });
  const hash = await wallet.writeContract({ address, abi, functionName, args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${functionName} reverted`);
  return receipt;
}

async function actor(): Promise<PrivateKeyAccount> {
  const account = privateKeyToAccount(generatePrivateKey());
  await client.request({ method: "anvil_setBalance" as never, params: [account.address, toHex(10n ** 20n)] as never });
  return account;
}

const balanceOf = (who: Address) =>
  client.readContract({ address: d.usdc, abi: zusdcAbi, functionName: "balanceOf", args: [who] });

// ---- API --------------------------------------------------------------------------------------------------------

interface Canvas {
  asOf: { block: number; updatedAt: number };
  canvas: {
    account: { exists: boolean; balance: string; myRole: string; route: unknown[]; endpointPublic: boolean; ops: { opId: string; executed: boolean; confirmations: number }[]; budgets: { id: string; used: string }[] };
    relationships: { id: string; status: string; buyer: string; seller: string }[];
    invoices: { id: string; status: string; escrowed: string; owner: string | null; advance: { principal: string; fee: string } | null }[];
    activity: { title: string; key: string }[];
    routed: { invoiceId: string; amount: string }[];
    pool: { idleCash: string };
  };
  layout: { revision: number } | null;
}
interface Notifications {
  notifications: { kind: string; key: string; read: boolean; title: string }[];
  unread: number;
}

async function api<T>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text === "" ? undefined : JSON.parse(text)) as T };
}

const canvasOf = async (account: Address, wallet: Address) =>
  (await api<Canvas>("GET", `/v1/accounts/${account}/canvas?wallet=${wallet}`)).body;
const notificationsOf = async (account: Address, wallet: Address) =>
  (await api<Notifications>("GET", `/v1/accounts/${account}/notifications?wallet=${wallet}`)).body;

/** Polls until `check` returns a value, so a step waits for the indexer instead of sleeping a fixed time. */
async function until<T>(label: string, check: () => Promise<T | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: Error | undefined;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== undefined && value !== false) return value;
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out: ${label}${last === undefined ? "" : ` (${last.message})`}`);
}

async function signIn(wallet: PrivateKeyAccount): Promise<string> {
  const { body } = await api<{ nonce: string }>("POST", "/v1/auth/nonce");
  const message = createSiweMessage({
    address: wallet.address,
    chainId: 31337,
    domain: new URL(WEB_ORIGIN).host,
    nonce: body.nonce,
    uri: WEB_ORIGIN,
    version: "1",
    issuedAt: new Date(),
  });
  const signature = await wallet.signMessage({ message });
  const verified = await api<{ token: string }>("POST", "/v1/auth/verify", { message, signature });
  assert.equal(verified.status, 201, "sign-in succeeds");
  const replay = await api("POST", "/v1/auth/verify", { message, signature });
  assert.equal(replay.status, 401, "a replayed sign-in message is rejected");
  return verified.body.token;
}

// ---- SSE --------------------------------------------------------------------------------------------------------

interface SseEvent {
  id?: string;
  event: string;
  data: Record<string, unknown>;
}

/** Reads /v1/stream into `events` until `close()`. */
function openStream(account: Address, lastEventId?: string) {
  const events: SseEvent[] = [];
  const controller = new AbortController();
  const done = (async () => {
    const res = await fetch(`${API}/v1/stream?account=${account}`, {
      signal: controller.signal,
      headers: lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId },
    });
    assert.equal(res.headers.get("content-type")?.startsWith("text/event-stream"), true, "the stream is SSE");
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) return;
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const fields = Object.fromEntries(
          block
            .split("\n")
            .filter((line) => !line.startsWith(":"))
            .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]),
        ) as Record<string, string>;
        if (fields.data !== undefined) {
          events.push({ id: fields.id, event: fields.event ?? "message", data: JSON.parse(fields.data) as Record<string, unknown> });
        }
      }
    }
  })().catch((error: unknown) => {
    if (!controller.signal.aborted) throw error;
  });
  return {
    events,
    names: () => events.filter((e) => e.event === "feed").map((e) => String(e.data.name)),
    waitFor: (label: string, predicate: (e: SseEvent) => boolean) =>
      until(`SSE ${label}`, () => Promise.resolve(events.find(predicate))),
    close: async () => {
      controller.abort();
      await done;
    },
  };
}

const feedEvent = (name: string, extra: (e: SseEvent) => boolean = () => true) => (e: SseEvent) =>
  e.event === "feed" && e.data.name === name && extra(e);

// ---- The demo ---------------------------------------------------------------------------------------------------

const log = (step: string) => console.log(`ok  ${step}`);

async function main() {
  const [seller, clubAdmin, clubTreasurer, lp] = await Promise.all([actor(), actor(), actor(), actor()]);
  const predict = (admin: Address) =>
    client.readContract({ address: d.factory, abi: zalFactoryAbi, functionName: "predictAccount", args: [admin, zeroHash] });
  const sellerAccount = (await predict(seller.address)).toLowerCase() as Address;
  const club = (await predict(clubAdmin.address)).toLowerCase() as Address;
  const me = seller.address.toLowerCase() as Address;

  const sellerStream = openStream(sellerAccount);
  const clubStream = openStream(club);
  await sellerStream.waitFor("ready (seller)", (e) => e.event === "ready");
  await clubStream.waitFor("ready (club)", (e) => e.event === "ready");

  // Seed, as the sandbox does: the seller's account with USDC, the club with two signers and an Events budget and
  // a pool credit line, and an LP deposit.
  await send(seller, d.factory, zalFactoryAbi, "createAccount", [seller.address, zeroHash]);
  await send(OWNER, d.usdc, zusdcAbi, "mint", [sellerAccount, usdc(10_000)]);
  await send(clubAdmin, d.factory, zalFactoryAbi, "createAccount", [clubAdmin.address, zeroHash]);
  await send(clubAdmin, club, canvasAccountAbi, "setMember", [clubTreasurer.address, 2]);
  await send(clubAdmin, club, canvasAccountAbi, "setPolicy", [2, 0n]);
  await send(clubAdmin, club, canvasAccountAbi, "setBudget", [1n, usdc(10_000), 0n]);
  await send(OWNER, d.usdc, zusdcAbi, "mint", [club, usdc(20_000)]);
  await send(OWNER, d.pool, zalFundingPoolAbi, "setObligorLimit", [club, usdc(20_000)]);
  await send(OWNER, d.usdc, zusdcAbi, "mint", [lp.address, usdc(50_000)]);
  await send(lp, d.usdc, zusdcAbi, "approve", [d.pool, usdc(50_000)]);
  const poolBefore = await client.readContract({ address: d.pool, abi: zalFundingPoolAbi, functionName: "idleCash" });
  await send(lp, d.pool, zalFundingPoolAbi, "deposit", [usdc(50_000), lp.address]);

  const seeded = await until("seed indexed", async () => {
    const c = await canvasOf(sellerAccount, me);
    return c.canvas.account.exists && c.canvas.account.balance === String(usdc(10_000)) ? c : undefined;
  });
  assert.equal(seeded.canvas.account.myRole, "admin");
  assert.equal(seeded.canvas.account.balance, String(await balanceOf(sellerAccount)), "account balance matches the chain");
  const pool = await until("LP deposit indexed", async () => {
    const p = (await api<{ pool: { idleCash: string } }>("GET", "/v1/pool")).body;
    return BigInt(p.pool.idleCash) === poolBefore + usdc(50_000) ? p : undefined;
  });
  assert.equal(
    pool.pool.idleCash,
    String(await client.readContract({ address: d.pool, abi: zalFundingPoolAbi, functionName: "idleCash" })),
  );
  log(`seed: seller account ${sellerAccount} holds 10,000 USDC, club ${club} has 2 signers, pool idle cash ${pool.pool.idleCash}`);

  // Step 1.
  await send(seller, sellerAccount, canvasAccountAbi, "setRoute", [
    [
      { kind: 2, target: d.vault, bps: 1000 },
      { kind: 0, target: zeroAddress, bps: 9000 },
    ],
  ]);
  await send(seller, sellerAccount, canvasAccountAbi, "setEndpointPublic", [true]);
  await until("route and endpoint", async () => {
    const c = await canvasOf(sellerAccount, me);
    return c.canvas.account.route.length === 2 && c.canvas.account.endpointPublic;
  });
  await sellerStream.waitFor("RouteSet", feedEvent("RouteSet"));
  log("step 1: the Split (10% vault, 90% held) and the public endpoint show on the canvas and the stream");

  // Steps 2 and 3.
  const proposed = await send(seller, sellerAccount, canvasAccountAbi, "proposeRelationship", [club, 1, 0n]);
  const [proposal] = parseEventLogs({ abi: relationshipRegistryAbi, logs: proposed.logs, eventName: "RelationshipProposed" });
  const relId = proposal!.args.id;
  await until("relationship proposed", async () =>
    (await canvasOf(sellerAccount, me)).canvas.relationships.some((r) => r.id === String(relId) && r.status === "proposed"),
  );
  await clubStream.waitFor("RelationshipProposed (club)", feedEvent("RelationshipProposed"));
  const clubInbox = await until("club proposal notification", async () => {
    const n = await notificationsOf(club, clubAdmin.address);
    return n.notifications.some((x) => x.kind === "proposalReceived") ? n : undefined;
  });
  log(`step 2: relationship #${relId} proposed; the club's inbox has "${clubInbox.notifications[0]!.title}"`);

  await send(clubAdmin, club, canvasAccountAbi, "acceptRelationship", [relId]);
  const accepted = await until("relationship active", async () => {
    const c = await canvasOf(sellerAccount, me);
    return c.canvas.relationships.find((r) => r.id === String(relId) && r.status === "active");
  });
  assert.equal(accepted.seller, sellerAccount);
  assert.equal(accepted.buyer, club);
  await sellerStream.waitFor("RelationshipAccepted", feedEvent("RelationshipAccepted"));
  log("step 3: the club accepted; both sides read the relationship as active");

  // Step 4.
  const due = (await client.getBlock()).timestamp + 30n * DAY;
  const issued = await send(seller, sellerAccount, canvasAccountAbi, "issueInvoice", [
    relId,
    usdc(5_000),
    due,
    keccak256(toHex(`stack demo ${relId}`)),
  ]);
  const [issue] = parseEventLogs({ abi: zalInvoiceAbi, logs: issued.logs, eventName: "InvoiceIssued" });
  const invoiceId = issue!.args.id;
  const invoiceOf = async (account: Address, wallet: Address) =>
    (await canvasOf(account, wallet)).canvas.invoices.find((i) => i.id === String(invoiceId));
  await until("invoice issued", async () => (await invoiceOf(sellerAccount, me))?.status === "issued");
  await clubStream.waitFor("InvoiceIssued (club)", feedEvent("InvoiceIssued", (e) => e.data.invoiceId === String(invoiceId)));
  await until("club invoice notification", async () =>
    (await notificationsOf(club, clubAdmin.address)).notifications.some((n) => n.kind === "invoiceIssued"),
  );
  log(`step 4: invoice #${invoiceId} for 5,000 USDC due in 30 days; the club is notified`);

  // Step 5: two signers approve against the Events budget, then escrow.
  for (const call of [
    encodeFunctionData({ abi: canvasAccountAbi, functionName: "approveInvoice", args: [invoiceId, 1n] }),
    encodeFunctionData({ abi: canvasAccountAbi, functionName: "escrowInvoice", args: [invoiceId] }),
  ]) {
    const submitted = await send(clubAdmin, club, canvasAccountAbi, "submit", [call]);
    const [op] = parseEventLogs({ abi: canvasAccountAbi, logs: submitted.logs, eventName: "OpSubmitted" });
    const opId = op!.args.opId;
    await until("signature needed", async () =>
      (await notificationsOf(club, clubTreasurer.address)).notifications.some(
        (n) => n.kind === "signatureNeeded" && n.title.includes(`#${opId} `),
      ),
    );
    await send(clubTreasurer, club, canvasAccountAbi, "confirm", [opId]);
    await until(`op ${opId} executed`, async () =>
      (await canvasOf(club, clubTreasurer.address)).canvas.account.ops.some(
        (o) => o.opId === String(opId) && o.executed && o.confirmations === 2,
      ),
    );
  }
  const committed = await until("approved and escrowed", async () => {
    const inv = await invoiceOf(sellerAccount, me);
    return inv?.status === "approved" && inv.escrowed === String(usdc(5_000)) ? inv : undefined;
  });
  const clubCanvas = await canvasOf(club, clubAdmin.address);
  assert.equal(clubCanvas.canvas.account.budgets.find((b) => b.id === "1")?.used, String(usdc(5_000)), "the Events budget is charged");
  await sellerStream.waitFor("InvoiceEscrowed", feedEvent("InvoiceEscrowed"));
  log(`step 5: the club approved with 2 of 2 signers and escrowed ${committed.escrowed}`);

  // Step 6.
  const before6 = await balanceOf(sellerAccount);
  await send(seller, sellerAccount, canvasAccountAbi, "requestAdvance", [invoiceId]);
  const advanced = await until("advanced", async () => {
    const inv = await invoiceOf(sellerAccount, me);
    return inv?.advance !== null && inv?.owner === d.pool ? inv : undefined;
  });
  assert.equal(advanced.advance?.principal, String(usdc(4_000)), "80% advance");
  const after6 = await canvasOf(sellerAccount, me);
  assert.equal(after6.canvas.account.balance, String(await balanceOf(sellerAccount)), "account balance matches the chain");
  assert.equal(BigInt(after6.canvas.account.balance) - before6, usdc(4_000));
  await sellerStream.waitFor("Advanced", feedEvent("Advanced"));
  await until("advance notification", async () =>
    (await notificationsOf(sellerAccount, me)).notifications.some((n) => n.kind === "advancePaid"),
  );
  log("step 6: an 80% advance of 4,000 USDC; the pool now owns the invoice NFT");

  // Step 7: the due date arrives and the club pays in one transaction.
  await client.request({ method: "evm_increaseTime" as never, params: [Number(31n * DAY)] as never });
  await client.request({ method: "evm_mine" as never, params: [] as never });
  const pay = encodeFunctionData({ abi: canvasAccountAbi, functionName: "payInvoice", args: [invoiceId] });
  const submitted = await send(clubAdmin, club, canvasAccountAbi, "submit", [pay]);
  const [payOp] = parseEventLogs({ abi: canvasAccountAbi, logs: submitted.logs, eventName: "OpSubmitted" });
  const paid = await send(clubTreasurer, club, canvasAccountAbi, "confirm", [payOp!.args.opId]);
  const settled = await until("paid", async () => {
    const c = await canvasOf(sellerAccount, me);
    const inv = c.canvas.invoices.find((i) => i.id === String(invoiceId));
    return inv?.status === "paid" && inv.advance === null && c.canvas.routed.some((r) => r.invoiceId === String(invoiceId))
      ? c
      : undefined;
  });
  assert.equal(settled.canvas.account.balance, String(await balanceOf(sellerAccount)), "account balance matches the chain");
  const paidEvent = await sellerStream.waitFor("InvoicePaid", feedEvent("InvoicePaid"));
  assert.equal(String(paidEvent.data.transactionHash), paid.transactionHash, "the stream names the settling transaction");
  await sellerStream.waitFor("PaymentRouted", feedEvent("PaymentRouted"));
  const inbox = await until("payment notification", async () => {
    const n = await notificationsOf(sellerAccount, me);
    return n.notifications.some((x) => x.kind === "paymentReceived") ? n : undefined;
  });
  log("step 7: one transaction repaid the pool and ran the reserve through the seller's Split");

  // Step 8.
  const titles = settled.canvas.activity.map((a) => a.title);
  for (const title of [
    `Relationship #${relId} proposed`,
    `Relationship #${relId} accepted`,
    `Invoice #${invoiceId} issued`,
    `Invoice #${invoiceId} approved`,
    `Invoice #${invoiceId} escrowed`,
    `Invoice #${invoiceId} advanced by the pool`,
    `Invoice #${invoiceId} paid`,
    `Payment for invoice #${invoiceId} ran through the Split`,
  ]) {
    assert.ok(titles.includes(title), `activity has "${title}"`);
  }
  const page = (await api<{ items: { title: string }[]; nextCursor: string | null }>("GET", `/v1/accounts/${sellerAccount}/activity?limit=3`)).body;
  assert.equal(page.items.length, 3);
  assert.ok(page.nextCursor !== null, "activity pages");
  log(`step 8: the Timeline lists the whole journey (${titles.length} items)`);

  // Presentation state: sign in, save the layout as a member, refuse a non-member, store read state.
  const token = await signIn(seller);
  const layout = { version: 1, positions: { account: { x: 0, y: 0 }, split: { x: 300, y: 0 } }, children: [], drafts: [], links: [] };
  const saved = await api<{ layout: { revision: number } }>("PUT", `/v1/accounts/${sellerAccount}/layout`, { layout, revision: 0 }, token);
  assert.equal(saved.status, 200, "a member saves the layout");
  await sellerStream.waitFor("layout", (e) => e.event === "layout" && e.data.revision === saved.body.layout.revision);
  const outsider = await api("PUT", `/v1/accounts/${sellerAccount}/layout`, { layout }, await signIn(clubAdmin));
  assert.equal(outsider.status, 403, "a signed-in non-member cannot write the layout");
  assert.equal((await api("PUT", `/v1/accounts/${sellerAccount}/layout`, { layout, revision: 0 }, token)).status, 409);
  assert.deepEqual((await canvasOf(sellerAccount, me)).layout?.revision, saved.body.layout.revision);
  const first = inbox.notifications[0]!;
  assert.equal((await api("POST", "/v1/notifications/read", { keys: [first.key] }, token)).status, 200);
  const reread = await notificationsOf(sellerAccount, me);
  assert.equal(reread.notifications.find((n) => n.key === first.key)?.read, true);
  assert.equal(reread.unread, inbox.unread - 1);
  log(`layout saved at revision ${saved.body.layout.revision}, pushed on the stream; non-member refused (403); read state stored`);

  // Resume: a client that reconnects with Last-Event-ID gets exactly what came after.
  const events = sellerStream.events.filter((e) => e.event === "feed");
  const resumeAt = events.findIndex((e) => e.data.name === "Advanced");
  const resumed = openStream(sellerAccount, events[resumeAt]!.id);
  const expected = events.slice(resumeAt + 1).map((e) => e.id);
  await until("resume replay", () =>
    Promise.resolve(resumed.events.filter((e) => e.event === "feed").length >= expected.length),
  );
  assert.deepEqual(resumed.events.filter((e) => e.event === "feed").map((e) => e.id), expected);
  log(`SSE resume from ${events[resumeAt]!.id} replayed ${expected.length} events in order`);

  // Three streams are open now. Streams dropped mid-handshake must give their slots back, and one client holds 10.
  const url = `${API}/v1/stream?account=${sellerAccount}`;
  await Promise.all(
    Array.from({ length: 30 }, async () => {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 5);
      await fetch(url, { signal: ac.signal }).catch(() => undefined);
    }),
  );
  const held: AbortController[] = [];
  const openRaw = async () => {
    const ac = new AbortController();
    held.push(ac);
    return (await fetch(url, { signal: ac.signal })).status;
  };
  await until("dropped streams released their slots", async () => {
    for (const ac of held.splice(0)) ac.abort();
    return (await Promise.all(Array.from({ length: 7 }, openRaw))).every((status) => status === 200);
  });
  assert.equal(await openRaw(), 429, "an 11th stream from one client is refused");
  for (const ac of held) ac.abort();
  log("30 streams dropped mid-handshake released their slots; the 11th concurrent stream from one client got 429");

  console.log(`\nseller stream: ${sellerStream.names().join(", ")}`);
  console.log(`asOf: ${JSON.stringify(settled.asOf)}`);
  await Promise.all([sellerStream.close(), clubStream.close(), resumed.close()]);
}

await main();
console.log("\nstack demo passed");
