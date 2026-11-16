// Scheduled payments on-chain (ADR 0015): a recurring transfer every minute for 3 runs and a pay-at schedule on an
// approved invoice; +1 day, and the sandbox keeper has run all of them.
// Usage: BASE=<web url> node e2e/zal-schedule.mjs [outDir]
import { BASE, OUT, launch, stubWallet } from "./lib.mjs";

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
const shot = async (name, opts = {}) => {
  await page.waitForTimeout(450);
  const file = `${OUT}/schedule-${String(n++).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, ...opts });
  console.log("shot", file);
};
const button = (name) => page.getByRole("button", { name, exact: false });
const node = (kind, text) => page.locator(`.react-flow__node-${kind}`).filter({ hasText: text });
const pick = (component) => page.locator(`[data-component=${component}] button`);
const inspector = () => page.locator(".react-flow__panel.top.right");
const deselect = () => page.locator(".react-flow__pane").click({ position: { x: 1000, y: 120 } });
const field = (label) => inspector().getByLabel(label, { exact: true });
const clip = async (locator, pad = 24) => {
  await page.waitForTimeout(900);
  const box = await locator.boundingBox();
  return { clip: { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad } };
};

try {
  await page.goto(`${BASE}/app/canvas?sandbox=1`);
  await button("Connect wallet").first().click();
  await node("account", "10,000.00").waitFor({ timeout: 180_000 });
  await page.waitForTimeout(1500);

  console.log("accept the print shop, which issues an invoice to pay");
  await node("counterparty", "Demo print shop").first().click();
  await inspector().getByRole("button", { name: "Accept", exact: true }).click();
  await node("invoice", "Invoice #1").waitFor({ timeout: 60_000 });
  check(true, "print shop issued invoice #1");

  console.log("recurring transfer: 100 zUSDC every 1 min, 3 runs, from the counterparty");
  await deselect();
  await node("counterparty", "Demo print shop").first().click();
  await pick("schedule").click();
  await inspector().getByText("Scheduled transfer").waitFor();
  check((await inspector().getByText("Demo print shop").count()) > 0, "recipient prefilled from the counterparty");
  check((await button("Schedule transfer").isEnabled()) === true, "defaults are valid: every 1 min, 3 runs, start in 1 min");
  await field("Every").fill("0");
  await inspector().getByText("Every ≥ 1 min").waitFor();
  check(await button("Schedule transfer").isDisabled(), "every 0 min is refused before the wallet: Every ≥ 1 min");
  await field("Every").fill("1");
  await inspector().getByText("Commits = amount × 3").waitFor();
  check((await inspector().getByText("300", { exact: false }).count()) > 0, "commits 100 × 3 = 300");
  await shot("transfer-form", await clip(inspector()));
  await button("Schedule transfer").click();
  const transfer = node("schedule", "Schedule #1");
  await transfer.waitFor({ timeout: 30_000 });
  await transfer.getByText("3 left").waitFor();
  check((await transfer.getByText("active").count()) === 1, "Schedule #1 is solid and active with 3 runs left");
  check((await transfer.getByText("every 1 min").count()) === 1, "node shows the cadence");
  await shot("transfer-node", await clip(transfer, 60));

  console.log("pay-at: budget, approve invoice #1, then schedule its payment");
  await deselect();
  await pick("budget").click();
  await button("Add budget").click();
  await node("budget", "Budget #1").waitFor({ timeout: 20_000 });
  await node("invoice", "Invoice #1").click();
  await inspector().getByRole("button", { name: "Approve", exact: true }).click();
  await node("invoice", "Invoice #1").getByText("ghost").waitFor({ state: "detached", timeout: 30_000 });
  await deselect();
  await node("invoice", "Invoice #1").click();
  await pick("schedule").click();
  await inspector().getByText("Scheduled payment").waitFor();
  await field("Pay in").fill("2");
  await shot("payment-form", await clip(inspector()));
  await button("Schedule payment").click();
  const payment = node("schedule", "Schedule #2");
  await payment.waitFor({ timeout: 30_000 });
  check((await payment.getByText("invoice #1").count()) === 1, "Schedule #2 pays invoice #1");
  await deselect();
  await shot("schedules-on-canvas");

  console.log("cancel: one approver stops a schedule (ZR-SCH-04)");
  await deselect();
  await node("counterparty", "Demo print shop").first().click();
  await pick("schedule").click();
  await field("Start in").fill("3");
  await button("Schedule transfer").click();
  const cancelled = node("schedule", "Schedule #3");
  await cancelled.waitFor({ timeout: 30_000 });
  await cancelled.click();
  await inspector().getByRole("button", { name: "Cancel", exact: true }).waitFor();
  await shot("active-inspector", await clip(inspector()));
  await inspector().getByRole("button", { name: "Cancel", exact: true }).click();
  await cancelled.getByText("cancelled").waitFor({ timeout: 30_000 });
  check(true, "Schedule #3 cancelled");
  await deselect();

  console.log("+1 day: the sandbox keeper runs every due run");
  await button("+1 day").click();
  await transfer.getByText("ended").waitFor({ timeout: 90_000 });
  check(true, "Schedule #1 ended after its 3 runs");
  await payment.getByText("ended").waitFor({ timeout: 60_000 });
  check(true, "Schedule #2 ended after paying");
  await node("invoice", "Invoice #1").getByText("paid").first().waitFor({ timeout: 30_000 });
  check(true, "invoice #1 is paid");
  const ran = await page.getByTestId("inbox").getByRole("button", { name: /Schedule #1 ran/ }).count();
  check(ran === 3, `three "Schedule #1 ran" notifications (${ran})`);
  await shot("after-a-day");
  await transfer.click();
  await inspector().getByText("Cadence").waitFor();
  await shot("transfer-ended-inspector", await clip(inspector()));
} catch (error) {
  failures.push(`threw: ${error.message.split("\n")[0]}`);
  await shot("THREW");
} finally {
  console.log(`\nschedule: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  -", f);
  console.log("console errors:", logs.length === 0 ? "none" : `\n${[...new Set(logs)].slice(0, 10).join("\n")}`);
  await browser.close();
  process.exitCode = failures.length === 0 ? 0 : 1;
}
