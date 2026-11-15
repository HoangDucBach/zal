// The PRD seller demo in LIVE mode against the docker stack: two browsers (designer and club), real signatures,
// real transactions on anvil, reads from the indexer API, updates over SSE without reloads. The club account runs
// a 2-of-2 policy: its admin submits each payment op in the browser, and a second approver opens the club canvas
// from the canvas switcher in a third browser and presses Confirm on the waiting op.
// Then layout persistence, an invite link redeemed by a fresh wallet, and the stream-down fallback.
// Usage: BASE=<web url> node e2e/zal-live.mjs [outDir]
import { createPublicClient, encodeFunctionData, http, zeroHash } from "viem";

import { BASE, OUT, launch } from "./lib.mjs";
import { RPC, contextWith, makeWallet } from "./wallet.mjs";

const API = process.env.API ?? "http://localhost:42069";
const FACTORY = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const chainClient = createPublicClient({ transport: http(RPC) });
const accountAbi = [
  { type: "function", name: "opCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "getOp",
    stateMutability: "view",
    inputs: [{ name: "opId", type: "uint256" }],
    outputs: [{ type: "tuple", components: [{ name: "data", type: "bytes" }, { name: "amount", type: "uint256" }, { name: "policyNonce", type: "uint64" }, { name: "confirmations", type: "uint32" }, { name: "executed", type: "bool" }] }],
  },
];
const predict = (wallet) =>
  chainClient.readContract({
    address: FACTORY,
    abi: [{ type: "function", name: "predictAccount", stateMutability: "view", inputs: [{ name: "admin", type: "address" }, { name: "salt", type: "bytes32" }], outputs: [{ type: "address" }] }],
    functionName: "predictAccount",
    args: [wallet, zeroHash],
  });

let passed = 0;
const failures = [];
const check = (ok, what) => {
  if (ok) passed++;
  else failures.push(what);
  console.log(ok ? "  pass" : "  FAIL", what);
};
let n = 0;
const shotOf = (page, who) => async (name) => {
  await page.waitForTimeout(500);
  const file = `${OUT}/live-${String(n++).padStart(2, "0")}-${who}-${name}.png`;
  await page.screenshot({ path: file });
  console.log("  shot", file);
};
const step = async (name, fn) => {
  const t = Date.now();
  console.log(name);
  try {
    await fn();
    console.log(`  ok ${Date.now() - t}ms`);
  } catch (e) {
    failures.push(`${name}: ${e.message.split("\n")[0]}`);
    console.log("  FAILED", e.message.split("\n")[0]);
    throw e;
  }
};
/** Waits for a locator and returns how long it took, for "updated in real time" claims. */
const within = async (locator, timeout = 15_000) => {
  const t = Date.now();
  await locator.waitFor({ timeout });
  return Date.now() - t;
};

function ui(page) {
  const node = (kind, text) => {
    const l = page.locator(`.react-flow__node-${kind}`);
    return text === undefined ? l : l.filter({ hasText: text });
  };
  return {
    node,
    button: (name) => page.getByRole("button", { name, exact: false }),
    pick: (component) => page.locator(`[data-component=${component}] button`),
    inspector: () => page.locator(".react-flow__panel.top.right"),
    deselect: () => page.locator(".react-flow__pane").click({ position: { x: 700, y: 140 } }),
  };
}

/** Counts API reads and page loads, so a "real time" check can prove there was no reload. */
function watch(page) {
  const seen = { api: 0, stream: 0, loads: 0 };
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith(`${API}/v1/accounts/`)) seen.api++;
    if (url.startsWith(`${API}/v1/stream`)) seen.stream++;
  });
  page.on("load", () => seen.loads++);
  return seen;
}

const browser = await launch();
const log = (who) => (m) => console.log(`    ${who} wallet: ${m}`);
const designerWallet = await makeWallet(undefined, { log: log("designer") });
const clubWallet = await makeWallet(undefined, { log: log("club") });
const approverWallet = await makeWallet(undefined, { log: log("approver") });
const designer = await contextWith(browser, designerWallet, { name: "designer" });
const club = await contextWith(browser, clubWallet, { name: "club" });
const approver = await contextWith(browser, approverWallet, { name: "approver" });
const D = ui(designer.page);
const C = ui(club.page);
const dShot = shotOf(designer.page, "designer");
const cShot = shotOf(club.page, "club");
const dSeen = watch(designer.page);
const cSeen = watch(club.page);
const aShot = shotOf(approver.page, "approver");
const logs = [designer.logs, club.logs, approver.logs];
const clubAccount = await predict(clubWallet.address);
const designerAccount = await predict(designerWallet.address);
console.log(`designer ${designerWallet.address} → ${designerAccount}\nclub ${clubWallet.address} → ${clubAccount}`);
console.log(`club approver ${approverWallet.address}`);

const opCount = () => chainClient.readContract({ address: clubAccount, abi: accountAbi, functionName: "opCount" });

/** The node's flow position (xyflow's translate), the coordinate the layout stores, not where it is on screen. */
const flowOf = (page, kind) =>
  page.locator(`.react-flow__node-${kind}`).first().evaluate((el) => {
    const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
    return m === null ? undefined : { x: Number(m[1]), y: Number(m[2]) };
  });
const near = (a, b) => a !== undefined && b !== undefined && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;

/**
 * The club's second approver presses Confirm on op `opId` in its own browser, on the club canvas it opened from the
 * switcher. Resolves once the op executed on chain.
 */
async function approverConfirms(opId, shot) {
  const A = ui(approver.page);
  await A.deselect();
  await A.node("approval").click();
  const row = A.inspector().getByTestId("op-row").filter({ hasText: `#${opId} ` });
  await row.getByText("1 of 2").waitFor({ timeout: 20_000 });
  if (shot !== undefined) await shot();
  const sentAt = Date.now();
  await row.getByRole("button", { name: "Confirm", exact: true }).click();
  const deadline = Date.now() + 30_000;
  while (!(await chainClient.readContract({ address: clubAccount, abi: accountAbi, functionName: "getOp", args: [opId] })).executed) {
    if (Date.now() > deadline) throw new Error(`op ${opId} did not execute after the approver's Confirm`);
    await approver.page.waitForTimeout(200);
  }
  return sentAt;
}

/** Runs `submit` in the club browser and returns the op it created, still waiting for the second signature. */
async function submittedOp(submit) {
  const before = await opCount();
  await submit();
  const deadline = Date.now() + 20_000;
  while ((await opCount()) === before) {
    if (Date.now() > deadline) throw new Error("no op was submitted");
    await club.page.waitForTimeout(200);
  }
  return before + 1n;
}

async function enter(page, who) {
  await page.goto(`${BASE}/app/canvas`);
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.locator(".react-flow__node-account").getByText("Not created yet").waitFor({ timeout: 30_000 });
  const u = ui(page);
  await u.pick("account").click();
  await u.button("Create my canvas").click();
  await page.locator(".react-flow__node-account").getByText("Not created yet").waitFor({ state: "detached", timeout: 30_000 });
  console.log(`  ${who} canvas created`);
}

try {
  await step("both connect and create their canvases (reads from the API)", async () => {
    await Promise.all([enter(designer.page, "designer"), enter(club.page, "club")]);
    check(dSeen.api > 0 && cSeen.api > 0, `both canvases read from the API (${dSeen.api}, ${cSeen.api} requests)`);
    check(dSeen.stream > 0 && cSeen.stream > 0, "both pages opened the SSE stream");
    check((await designer.page.getByTestId("live-paused").count()) === 0, "no 'live updates paused' while the stream is up");
  });
  await dShot("canvas-created");

  await step("demo 1: designer builds the Split and publishes the endpoint", async () => {
    await D.pick("split").click();
    await D.inspector().getByText("Save Split").waitFor();
    await D.button("Save Split").click();
    await D.node("split").getByText("90%").waitFor({ timeout: 20_000 });
    await D.deselect();
    await D.pick("endpoint").click();
    await D.inspector().getByText("Public: buyers see your Split").click();
    await D.node("split").getByText("endpoint public").waitFor({ timeout: 20_000 });
  });
  await dShot("split-endpoint");

  await step("club funds its canvas from the Deposit faucet (testnet MockUSDC)", async () => {
    await C.button("Deposit").click();
    await club.page.getByText("coming later").waitFor();
    await cShot("deposit-popover");
    for (let i = 0; i < 6; i++) {
      await C.button("Mint 1,000 testnet USDC to canvas").click();
      await club.page.getByText("Minted 1,000 testnet USDC").first().waitFor({ timeout: 20_000 });
      await club.page.waitForTimeout(300);
    }
    await club.page.keyboard.press("Escape");
    await C.node("account").getByText("6,000.00").waitFor({ timeout: 20_000 });
  });

  await step("club adds a second approver and sets 2 of 2 above 0 USDC", async () => {
    await C.node("account").click();
    await C.inspector().getByLabel("Add an approver").fill(approverWallet.address);
    await C.button("Add approver").click();
    await club.page.getByText("Member added").first().waitFor({ timeout: 20_000 });
    await C.node("approval").waitFor({ timeout: 20_000 });
    await C.deselect();
    await C.pick("approval").click();
    await C.inspector().getByLabel(/Signatures required/).fill("2");
    await C.inspector().getByLabel("For payments above, USDC").fill("0");
    await C.button("Save policy").click();
    await C.node("approval").getByText("2 of 2 sign above 0").waitFor({ timeout: 20_000 });
    check(true, "the club's Approval node reads 2 of 2 above 0 USDC");
  });
  await cShot("policy-2-of-2");

  await step("the approver opens the club canvas from the canvas switcher (role from chain)", async () => {
    await approver.page.goto(`${BASE}/app/canvas`);
    await approver.page.getByRole("button", { name: "Connect wallet" }).first().click();
    const switcher = approver.page.getByTestId("canvas-switcher");
    await switcher.getByText("My canvas").waitFor({ timeout: 30_000 });
    await switcher.click();
    const short = `${clubAccount.slice(0, 6)}…${clubAccount.slice(-4)}`;
    check((await approver.page.getByRole("option", { name: "My canvas" }).count()) === 1, "the switcher lists My canvas");
    // The approver has not acted on the club canvas yet, so it waits under the collapsed "Added by others".
    check((await approver.page.getByRole("option", { name: short }).count()) === 0, "a canvas the wallet never acted on is not listed until its group is opened");
    await approver.page.getByRole("button", { name: /Added by others/ }).click();
    const item = approver.page.getByRole("option", { name: short });
    await item.waitFor({ timeout: 20_000 });
    check((await item.innerText()).includes("approver"), "the switcher lists the club canvas with the role approver");
    await aShot("switcher-open");
    await item.click();
    await approver.page.waitForURL((url) => url.searchParams.get("account")?.toLowerCase() === clubAccount.toLowerCase(), { timeout: 10_000 });
    await switcher.getByText("approver").waitFor({ timeout: 20_000 });
    await ui(approver.page).node("approval").getByText("2 of 2 sign above 0").waitFor({ timeout: 20_000 });
    check(true, "the approver sees the club's canvas, with ?account= in the URL");
    check((await approver.page.locator("[data-component=split] button").count()) === 0, "an approver gets no admin palette entries (no Split)");
  });
  await aShot("club-canvas-as-approver");

  await step("demo 2: designer proposes to the club as seller; the club sees the ghost and its Inbox glows, no reload", async () => {
    const loadsBefore = cSeen.loads;
    await D.deselect();
    await D.pick("counterparty").click();
    await designer.page.getByLabel("Their canvas (account) address").fill(clubAccount);
    await D.button("Propose relationship").click();
    await D.node("counterparty").getByText("waiting for acceptance").waitFor({ timeout: 20_000 });
    const ms = await within(C.node("counterparty"));
    check(true, `club canvas shows the designer as a ghost ${ms} ms after the designer's proposal confirmed`);
    await club.page.getByText("1 waiting").first().waitFor({ timeout: 10_000 });
    check(cSeen.loads === loadsBefore, "club page did not reload");
  });
  await dShot("proposed-ghost");
  await cShot("inbox-glow-proposal");

  await step("demo 3: the club accepts from its Inbox; both turn solid", async () => {
    await C.button("proposed a relationship").first().click();
    await C.button("Accept").click();
    const ms = await within(D.node("counterparty").getByText("waiting for acceptance"), 1).catch(() => 0);
    await D.node("counterparty").getByText("waiting for acceptance").waitFor({ state: "detached", timeout: 15_000 });
    check(true, `designer's counterparty turned solid without reload (${ms})`);
  });
  await dShot("accepted-solid");

  await step("demo 4: designer issues a 5,000 USDC invoice; a ghost invoice appears on both", async () => {
    await D.node("counterparty").click();
    await D.pick("invoice").click();
    await D.button("Issue invoice NFT").click();
    await D.node("invoice", "Invoice #").waitFor({ timeout: 20_000 });
    const ms = await within(C.node("invoice", "Invoice #"));
    check(true, `club sees the invoice ${ms} ms later`);
  });
  await cShot("invoice-ghost");

  await step("demo 5: club adds the Events budget and approves; the op waits at Approval until the second signature", async () => {
    await C.deselect();
    await C.pick("budget").click();
    await C.button("Add budget").click();
    await C.node("budget").waitFor({ timeout: 20_000 });
    await C.node("invoice", "Invoice #").click();
    const opId = await submittedOp(() => C.inspector().getByRole("button", { name: "Approve", exact: true }).click());
    await C.node("approval").getByText("1 waiting").waitFor({ timeout: 15_000 });
    await C.node("approval").click();
    await C.inspector().getByText("1 of 2").waitFor({ timeout: 15_000 });
    await club.page.waitForTimeout(2_000);
    for (const [who, u] of [["club", C], ["designer", D]]) {
      const invoice = u.node("invoice", "Invoice #");
      const ghost = (await invoice.getByText("ghost", { exact: true }).count()) === 1;
      const approved = (await invoice.getByText("approved").count()) > 0;
      check(ghost && !approved, `with one of two signatures the ${who}'s invoice is still a ghost, not approved`);
    }
    await cShot("approval-waiting");
    const sentAt = await approverConfirms(opId, () => aShot("confirm-waiting-op"));
    await Promise.all(
      [C, D].map(async (u) => {
        const invoice = u.node("invoice", "Invoice #");
        await invoice.getByText("approved").first().waitFor({ timeout: 15_000 });
        await invoice.getByText("ghost", { exact: true }).waitFor({ state: "detached", timeout: 15_000 });
      }),
    );
    check(true, `the invoice turns solid on both canvases ${Date.now() - sentAt} ms after the approver pressed Confirm, no reload`);
    check((await C.node("approval").getByText("waiting").count()) === 0, "the Approval node has nothing waiting");
  });
  await dShot("approved-2-of-2");

  await step("club escrows; the second approver confirms; both see it escrow-backed", async () => {
    await C.node("invoice", "Invoice #").click();
    await C.pick("escrow").click();
    const opId = await submittedOp(() => C.button("Escrow now").click());
    // A tampered API describes the waiting op as another invoice: the approver's Inspector shows the chain's op,
    // flags the difference, and Confirm signs the chain's op. The link with ?account= opens the same canvas.
    const canvasPath = `${API}/v1/accounts/${clubAccount.toLowerCase()}/canvas*`;
    await approver.page.route(canvasPath, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const op of body.canvas?.account?.ops ?? []) if (op.call?.invoiceId !== undefined) op.call.invoiceId = "999";
      await route.fulfill({ response, json: body });
    });
    await approver.page.goto(`${BASE}/app/canvas?account=${clubAccount}`);
    await ui(approver.page).node("approval").waitFor({ timeout: 30_000 });
    const A = ui(approver.page);
    await A.node("approval").click();
    const row = A.inspector().getByTestId("op-row").filter({ hasText: `#${opId} ` });
    await row.getByTestId("op-api-differs").waitFor({ timeout: 20_000 });
    const shown = await row.innerText();
    check(shown.includes("Escrow invoice #") && !shown.includes("#999"), `a tampered API op shows the chain's version, flagged (${shown.replace(/\s+/g, " ")})`);
    await aShot("tampered-op-flagged");
    await approverConfirms(opId);
    await approver.page.unroute(canvasPath);
    await C.node("invoice", "Invoice #").getByText("escrow-backed").waitFor({ timeout: 20_000 });
    await D.node("invoice", "Invoice #").getByText("escrow-backed").waitFor({ timeout: 15_000 });
    check(true, "designer sees the invoice escrow-backed without reload");
  });
  await dShot("escrowed");

  await step("demo 6: designer requests the advance; the club sees it financed", async () => {
    await D.node("invoice", "Invoice #").click();
    await D.pick("pool").click();
    await D.inspector().getByText("Advance now").waitFor();
    await D.button("Request advance").click();
    await D.node("invoice", "Invoice #").getByText("financed").waitFor({ timeout: 20_000 });
    await C.node("invoice", "Invoice #").getByText("financed").waitFor({ timeout: 15_000 });
    check(true, "club sees the financed badge without reload");
  });
  await cShot("financed");

  await step("demo 7: the club pays early; settlement shows on both", async () => {
    await C.node("invoice", "Invoice #").click();
    const opId = await submittedOp(() => C.button("Pay now").click());
    await approver.page.reload();
    await approverConfirms(opId);
    await C.node("invoice", "Invoice #").getByText("paid").first().waitFor({ timeout: 20_000 });
    await D.node("invoice", "Invoice #").getByText("paid").first().waitFor({ timeout: 15_000 });
    check(true, "designer sees the invoice paid without reload");
    check(cSeen.loads === 1 && dSeen.loads === 1, `no page reloaded during the demo (designer ${dSeen.loads}, club ${cSeen.loads} loads)`);
  });
  await dShot("paid");
  await cShot("paid");

  let moved;
  await step("layout: a drag asks for sign-in once, then saves to the API", async () => {
    await D.deselect();
    const split = D.node("split");
    const box = await split.boundingBox();
    await designer.page.mouse.move(box.x + 40, box.y + 20);
    await designer.page.mouse.down();
    await designer.page.mouse.move(box.x + 40, box.y + 180, { steps: 12 });
    await designer.page.mouse.up();
    await designer.page.getByTestId("layout-sign-in").waitFor({ timeout: 5_000 });
    await dShot("sign-in-prompt");
    await D.button("Sign in to save").click();
    await designer.page.getByTestId("layout-sign-in").waitFor({ state: "detached", timeout: 15_000 });
    await designer.page.waitForTimeout(1500);
    const res = await fetch(`${API}/v1/accounts/${designerAccount.toLowerCase()}/canvas?wallet=${designerWallet.address.toLowerCase()}`);
    const body = await res.json();
    moved = body.layout?.layout?.positions?.split;
    check(body.layout?.revision >= 1 && moved !== undefined, `API stored the layout (revision ${body.layout?.revision}, split at ${JSON.stringify(moved)})`);
    check(near(await flowOf(designer.page, "split"), moved), "the dragged position on the canvas is the one the API stored");
  });

  await step("layout survives a reload and shows in a second browser", async () => {
    // Positions persist; the viewport does not: every load fits the whole canvas, so the node keeps its flow
    // position and two browsers that load the same layout show it at the same place on screen.
    const before = await flowOf(designer.page, "split");
    await designer.page.reload();
    await D.node("split").waitFor();
    await designer.page.waitForTimeout(1500);
    const reloaded = await flowOf(designer.page, "split");
    const after = await D.node("split").boundingBox();
    check(near(reloaded, before) && near(reloaded, moved), `split keeps its dragged flow position after reload (${JSON.stringify(before)} → ${JSON.stringify(reloaded)})`);
    const second = await contextWith(browser, designerWallet, { name: "designer-2" });
    logs.push(second.logs);
    await second.page.goto(`${BASE}/app/canvas`);
    await second.page.getByRole("button", { name: "Connect wallet" }).first().click();
    await ui(second.page).node("split").waitFor({ timeout: 20_000 });
    await second.page.waitForTimeout(1500);
    const there = await ui(second.page).node("split").boundingBox();
    const flowBefore = await flowOf(second.page, "split");
    check(near(flowBefore, moved), "a second browser draws the split at the stored flow position");
    check(Math.abs(there.y - after.y) < 4, `both fitted views show it at the same place on screen (y ${Math.round(after.y)}, ${Math.round(there.y)})`);
    await shotOf(second.page, "designer2")("same-layout");
    const split = await D.node("split").boundingBox();
    await designer.page.mouse.move(split.x + 40, split.y + 20);
    await designer.page.mouse.down();
    await designer.page.mouse.move(split.x + 40, split.y - 120, { steps: 12 });
    await designer.page.mouse.up();
    const t = Date.now();
    await second.page.waitForFunction(
      (y) => {
        const el = document.querySelector(".react-flow__node-split");
        const m = el === null ? null : /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
        return m !== null && Math.abs(Number(m[2]) - y) > 60;
      },
      flowBefore.y,
      { timeout: 15_000 },
    );
    check(true, `a layout change in one browser reaches the other over SSE in ${Date.now() - t} ms, no reload`);

    await D.button("Mark all read").click();
    await designer.page.waitForTimeout(1500);
    const notes = await (await fetch(`${API}/v1/accounts/${designerAccount.toLowerCase()}/notifications?wallet=${designerWallet.address.toLowerCase()}`)).json();
    check(notes.notifications.length > 0 && notes.unread === 0, `API stores the read state (${notes.notifications.length} notifications, ${notes.unread} unread)`);
    await second.page.reload();
    await ui(second.page).node("split").waitFor({ timeout: 20_000 });
    await second.page.waitForTimeout(1500);
    const badge = await second.page.getByRole("link", { name: /Canvas/ }).innerText();
    check(!/\d/.test(badge), `the second browser shows no unread badge (sidebar reads "${badge.replace(/\s+/g, " ")}")`);
    await second.ctx.close();
  });

  await step("invite link: designer signs an invite, a fresh wallet creates its canvas and redeems it", async () => {
    await D.deselect();
    await D.pick("counterparty").click();
    await D.button("Copy invite link").click();
    const link = await designer.page.getByTestId("invite-link").inputValue({ timeout: 20_000 });
    check(link.startsWith(`${BASE}/app/invite/`), `invite link ${link}`);
    await dShot("invite-link");
    const freshWallet = await makeWallet(undefined, { log: log("invitee") });
    const fresh = await contextWith(browser, freshWallet, { name: "invitee" });
    logs.push(fresh.logs);
    const F = ui(fresh.page);
    const fShot = shotOf(fresh.page, "invitee");
    await fresh.page.goto(link);
    await fresh.page.getByTestId("invite-proposer").waitFor({ timeout: 20_000 });
    await fresh.page.getByText("ghost", { exact: true }).waitFor();
    await fShot("invite-ghost-signed-out");
    await fresh.page.getByRole("button", { name: "Connect wallet" }).first().click();
    await F.button("Create my canvas").click();
    await F.button("Accept invite").waitFor({ timeout: 30_000 });
    await fShot("invite-ready-to-accept");
    const before = await D.node("counterparty").count();
    await F.button("Accept invite").click();
    await fresh.page.waitForURL(/\/app\/canvas/, { timeout: 30_000 });
    await F.node("counterparty").waitFor({ timeout: 20_000 });
    await fShot("invitee-canvas");
    await designer.page.waitForFunction(
      (n) => document.querySelectorAll(".react-flow__node-counterparty").length > n,
      before,
      { timeout: 20_000 },
    );
    check(true, "designer's canvas gains the invitee as an active counterparty without reload");
    await fresh.page.goto(link);
    await fresh.page.getByText("Already redeemed").waitFor({ timeout: 20_000 });
    check(true, "the link reads as redeemed afterwards");
    await fresh.ctx.close();
  });
  await D.button("Fit view").click().catch(() => undefined);
  await dShot("after-invite");

  await step("stream down: the page says live updates are paused and keeps working by polling", async () => {
    await club.page.route(`${API}/v1/stream*`, (route) => route.abort());
    await club.page.reload();
    await C.node("account").waitFor({ timeout: 20_000 });
    await club.page.getByTestId("live-paused").waitFor({ timeout: 20_000 });
    await cShot("live-paused");
    const balance = await C.node("account").innerText();
    await designerWallet.handle("eth_sendTransaction", [{
      to: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      data: encodeFunctionData({
        abi: [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }],
        functionName: "mint",
        args: [clubAccount, 7_000_000n],
      }),
    }]);
    await club.page.waitForFunction(
      (old) => document.querySelector(".react-flow__node-account")?.innerText !== old,
      balance,
      { timeout: 20_000 },
    );
    check(true, "with the stream down, chain polling still updates the club's balance");
    await club.page.unroute(`${API}/v1/stream*`);
  });
} catch {
  // reported below
} finally {
  const errors = logs.flat();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log("console errors:", errors.length === 0 ? "none" : `\n${errors.join("\n")}`);
  await browser.close();
  process.exitCode = failures.length === 0 ? 0 : 1;
}
