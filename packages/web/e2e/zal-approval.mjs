// The single-signature allowance (ZR-ACC-11, ADR 0016): 2 of 2 above 500 per 24 h. A 300 transfer runs on one
// signature and the Approval node shows the window; a second 300 then needs both signatures.
// Usage: BASE=<web url> node e2e/zal-approval.mjs [outDir]
import { BASE, OUT, launch, stubWallet } from "./lib.mjs";

const COSIGNER = "0x00000000000000000000000000000000000c0517";

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
  const file = `${OUT}/approval-${String(n++).padStart(2, "0")}-${name}.png`;
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
const transfer300 = async (count) => {
  await deselect();
  await node("counterparty", "Demo print shop").first().click();
  await pick("schedule").click();
  await inspector().getByText("Scheduled transfer").waitFor();
  await field("Every").fill("1");
  await inspector().getByText("Commits = amount × 3").waitFor();
  await inspector().getByText(count).waitFor({ timeout: 20_000 });
};

try {
  await page.goto(`${BASE}/app/canvas?sandbox=1`);
  await button("Connect wallet").first().click();
  await node("account", "10,000.00").waitFor({ timeout: 180_000 });
  await page.waitForTimeout(1500);

  console.log("accept the print shop, so there is someone to pay");
  await node("counterparty", "Demo print shop").first().click();
  await inspector().getByRole("button", { name: "Accept", exact: true }).click();
  await node("invoice", "Invoice #1").waitFor({ timeout: 60_000 });

  console.log("add the sandbox co-signer, then 2 of 2 above 500 per 24 h");
  await deselect();
  await node("account", "10,000.00").click();
  await field("Add an approver").fill(COSIGNER);
  await button("Add approver").click();
  const approval = node("approval", "Approval");
  await approval.waitFor({ timeout: 30_000 });
  await approval.click();
  await pick("approval").click();
  await inspector().getByText("Approval policy").waitFor();
  await button("Save policy").click();
  await node("approval", /2 of 2 above 500\.00/).waitFor({ timeout: 30_000 });
  await node("approval", /used 0\.00 of 500\.00 today/).waitFor({ timeout: 30_000 });
  check(true, "an unused window reads used 0.00 of 500.00 today");

  console.log("100 × 3 = 300 fits the allowance: one signature");
  await transfer300("1 signature");
  check(true, "form: 1 signature for 300 of a free 500");
  await button("Schedule transfer").click();
  await node("schedule", "Schedule #1").getByText("active").waitFor({ timeout: 30_000 });
  check(true, "Schedule #1 ran its op on one signature");
  await deselect();
  await node("approval", /used 300\.00 of 500\.00 today/).waitFor({ timeout: 30_000 });
  check(true, "Approval node: used 300.00 of 500.00 today");
  await shot("node-window-used", await clip(approval, 60));

  console.log("a second 300 would take the window to 600: both signatures");
  await transfer300("2 signatures");
  check(true, "form: 2 signatures once the window holds 300");
  await shot("form-needs-two", await clip(inspector()));
  await button("Schedule transfer").click();
  await approval.getByText("1 waiting").waitFor({ timeout: 30_000 });
  check(true, "the second op waits at the Approval node");
  await deselect();
  await approval.click();
  await inspector().getByText("Allowance").waitFor();
  await inspector().filter({ hasText: /2 of 2 above 500\.00 zUSDC per 24 h/ }).waitFor();
  check(true, "inspector states 2 of 2 above 500.00 zUSDC per 24 h");
  await shot("approval-inspector", await clip(inspector()));
} catch (error) {
  failures.push(`threw: ${error.message.split("\n")[0]}`);
  await shot("THREW");
} finally {
  console.log(`\napproval: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  -", f);
  console.log("console errors:", logs.length === 0 ? "none" : `\n${[...new Set(logs)].slice(0, 10).join("\n")}`);
  await browser.close();
  process.exitCode = failures.length === 0 ? 0 : 1;
}
