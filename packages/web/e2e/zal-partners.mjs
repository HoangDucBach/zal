// Sandbox with any number of counterparties: relate both seeded bots, create a demo partner, propose, see it
// accepted; then paste wallets and see guidance instead of a revert.
// Usage: BASE=<web url> node e2e/zal-partners.mjs [outDir]
import { BASE, OUT, VISITOR, launch, stubWallet } from "./lib.mjs";

const CLUB_ADMIN_WALLET = "0x00000000000000000000000000000000000c1b01";
const LP_WALLET = "0x000000000000000000000000000000000000f00d";
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => m.type() === "error" && logs.push(`console: ${m.text().split("\n")[0]}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message.split("\n")[0]}`));
await stubWallet(page);

let passed = 0;
const failures = [];
const check = (ok, what) => {
  if (ok) passed++;
  else failures.push(what);
  console.log(ok ? "  pass" : "  FAIL", what);
};
let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(450);
  const file = `${OUT}/partners-${String(n++).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file });
  console.log("shot", file);
};
const button = (name) => page.getByRole("button", { name, exact: false });
const node = (kind, text) => page.locator(`.react-flow__node-${kind}`).filter({ hasText: text });
const inspector = () => page.locator('[data-canvas-panel="column"]');
const deselect = () => page.locator(".react-flow__pane").click({ position: { x: 1000, y: 120 } });
const field = () => inspector().getByLabel("Their canvas (account) address");
const openPropose = async () => {
  await deselect();
  await page.locator("[data-component=counterparty] button").click();
  await field().waitFor();
};
const accepted = async (name) => {
  await node("counterparty", name).getByText("waiting for acceptance").waitFor({ state: "detached", timeout: 60_000 });
};

try {
  await page.goto(`${BASE}/app/canvas?sandbox=1`);
  await button("Connect wallet").first().click();
  await page.locator(".react-flow__node-account").getByText("10,000.00").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  if ((await button("Reset").count()) > 0) {
    // A sandbox from an earlier run: start clean so partner numbering is predictable.
  }

  await openPropose();
  await button("Use demo club").click();
  await button("Propose relationship").click();
  await node("counterparty", "Demo club").first().waitFor({ timeout: 30_000 });
  await accepted("Demo club");
  check(true, "demo club accepted the proposal");

  await deselect();
  await node("counterparty", "Demo print shop").first().click();
  await inspector().getByRole("button", { name: "Accept", exact: true }).click();
  await node("counterparty", "Demo print shop").getByText("waiting for", { exact: false }).waitFor({ state: "detached", timeout: 60_000 });
  check(true, "print shop relationship accepted");
  await shot("both-bots-related");

  await openPropose();
  check((await inspector().getByRole("button", { name: /^Use demo/ }).count()) === 0, "no suggestions left once both bots are related");
  await shot("no-suggestions");
  await button("Add buyer").click();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[placeholder="0x…"]');
    return input !== null && /^0x[0-9a-fA-F]{40}$/.test(input.value);
  }, undefined, { timeout: 60_000 });
  const partnerAccount = await field().inputValue();
  check(/^0x[0-9a-fA-F]{40}$/.test(partnerAccount), `create prefilled the partner canvas ${partnerAccount}`);
  const propose = inspector().getByRole("button", { name: "Propose relationship" });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Propose relationship"));
    return b !== undefined && !b.disabled && b.getAttribute("aria-disabled") !== "true" && b.getAttribute("data-disabled") !== "true";
  }, undefined, { timeout: 30_000 });
  await shot("partner-prefilled");
  await propose.click();
  await node("counterparty", "Demo partner 1").first().waitFor({ timeout: 30_000 });
  await shot("partner-ghost");
  await accepted("Demo partner 1");
  check(true, "Demo partner 1 accepted: ghost turned solid");
  await deselect();
  await shot("partner-solid");

  await openPropose();
  await field().fill(CLUB_ADMIN_WALLET);
  await inspector().getByText("That is a wallet, not a canvas").waitFor({ timeout: 20_000 });
  check(await propose.isDisabled(), "propose is disabled for a wallet");
  await shot("wallet-guidance");
  await inspector().getByRole("button", { name: /Use their canvas/ }).click();
  check((await field().inputValue()).toLowerCase() !== CLUB_ADMIN_WALLET, "Use their canvas swaps in the canvas address");
  await inspector().getByText("Already proposed or active in this direction").waitFor({ timeout: 20_000 });
  check(await propose.isDisabled(), "propose is disabled for an existing relationship in this direction");
  await shot("already-related");

  await field().fill(LP_WALLET);
  await inspector().getByText("Not a Zal canvas").waitFor({ timeout: 20_000 });
  check(await inspector().getByText("Use their canvas address, or invite them").isVisible(), "not-a-canvas guidance shows");
  check(await propose.isDisabled(), "propose is disabled for an address with no canvas");
  await shot("not-a-canvas");

  await field().fill(VISITOR);
  await inspector().getByText("That is your own canvas").waitFor({ timeout: 20_000 });
  check(await propose.isDisabled(), "propose is disabled for your own wallet");

  await page.reload();
  await page.locator(".react-flow__node-account").getByText("10,000.00", { exact: false }).first().waitFor({ timeout: 120_000 }).catch(() => undefined);
  await node("counterparty", "Demo partner 1").first().waitFor({ timeout: 60_000 });
  check(true, "Demo partner 1 survives a reload");
  await shot("after-reload");
} catch (error) {
  failures.push(`threw: ${error.message.split("\n")[0]}`);
  await shot("error").catch(() => undefined);
}
check(!logs.some((l) => l.includes("0x603872fc")), "no raw NotAccount selector in the console");
console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("FAIL", f);
for (const l of logs.slice(0, 10)) console.log(l);
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
