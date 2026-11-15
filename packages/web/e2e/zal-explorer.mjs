// Drives the explorer without a wallet against the local stack (web :3100, API :42069 with /v1/explorer): opens
// the home page, searches an address, a tx hash and a block number, opens each detail page and a token page, then
// the home page in sandbox mode for the "live L1" chip. Screenshots every step.
// Usage: BASE=<web url> API=<api url> node e2e/zal-explorer.mjs [outDir]
import { BASE, OUT, launch } from "./lib.mjs";

const API = process.env.API ?? "http://localhost:42069";
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => m.type() === "error" && logs.push(`console: ${m.text().split("\n")[0]}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message.split("\n")[0]}`));

let passed = 0;
const failures = [];
const check = (ok, what) => {
  if (ok) passed++;
  else failures.push(what);
  console.log(ok ? "  pass" : "  FAIL", what);
};
let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(500);
  const file = `${OUT}/explorer-${String(n++).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log("shot", file);
};

/** Real ids to search for, from the API itself. */
const api = async (path) => {
  const res = await fetch(`${API}/v1/explorer${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};
const { items: txs } = await api("/txs?limit=25");
const { items: tokens } = await api("/tokens?limit=5");
const tx = txs.find((t) => t.kind === "zal") ?? txs[0];
if (tx === undefined) throw new Error("no indexed transactions on the stack");
const address = tx.from;
const blockNumber = String(tx.blockNumber);

const search = async (text) => {
  const input = page.getByRole("searchbox", { name: "Search the Zal L1" });
  await input.fill(text);
  await input.press("Enter");
};

// Home, no wallet.
await page.goto(`${BASE}/app/explorer`);
await page.getByRole("list", { name: "Latest blocks" }).waitFor({ timeout: 30_000 });
await page.getByRole("list", { name: "Latest transactions" }).waitFor();
check((await page.getByRole("list", { name: "Latest blocks" }).locator("li").count()) > 0, "home: latest blocks listed");
check((await page.getByRole("list", { name: "Latest transactions" }).locator("li").count()) > 0, "home: latest txs listed");
await page.getByText("Transactions", { exact: true }).first().waitFor();
await page.locator(".recharts-surface").first().waitFor({ timeout: 15_000 });
check((await page.locator(".recharts-surface").count()) >= 3, "home: charts drawn");
await shot("home");
await page.getByRole("region", { name: "Charts" }).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.getByRole("region", { name: "Charts" }).screenshot({ path: `${OUT}/explorer-charts-1m.png` });
console.log("shot", `${OUT}/explorer-charts-1m.png`);
await page.getByRole("radio", { name: "1W", exact: true }).click();
await page.waitForTimeout(600);
await page.getByRole("region", { name: "Charts" }).screenshot({ path: `${OUT}/explorer-charts-1w.png` });
console.log("shot", `${OUT}/explorer-charts-1w.png`);
await page.getByRole("radio", { name: "ALL", exact: true }).click();
await page.waitForTimeout(600);
await page.getByRole("region", { name: "Charts" }).screenshot({ path: `${OUT}/explorer-charts-all.png` });
console.log("shot", `${OUT}/explorer-charts-all.png`);

// ⌘K focuses search.
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Meta+k");
check(await page.getByRole("searchbox", { name: "Search the Zal L1" }).evaluate((el) => el === document.activeElement), "⌘K focuses search");

// Address.
await search(address);
await page.waitForURL(/\/app\/explorer\/address\//, { timeout: 15_000 });
await page.getByRole("tab", { name: "Transactions" }).waitFor();
await page.getByRole("grid", { name: "Transactions" }).or(page.getByRole("table", { name: "Transactions" })).first().waitFor();
check(page.url().includes(address.toLowerCase()), "search address → address page");
await shot("address");
for (const tab of ["Token transfers", "Tokens", "NFTs"]) {
  await page.getByRole("tab", { name: tab }).click();
  await page.waitForTimeout(800);
  await shot(`address-${tab.toLowerCase().replace(/\s+/g, "-")}`);
}

// Tx hash: the API decides tx or block.
await search(tx.hash);
await page.waitForURL(/\/app\/explorer\/tx\//, { timeout: 15_000 });
await page.getByText("Logs ·").waitFor();
check(page.url().includes(tx.hash.toLowerCase()), "search tx hash → tx page");
await shot("tx");

// Block number.
await search(blockNumber);
await page.waitForURL(/\/app\/explorer\/block\//, { timeout: 15_000 });
await page.getByText("Fee recipient").waitFor();
check(page.url().endsWith(`/block/${blockNumber}`), "search block number → block page");
await shot("block");

// Token (zUSDC), via search by symbol.
const zusdc = tokens.find((t) => t.symbol === "zUSDC") ?? tokens[0];
if (zusdc !== undefined) {
  await search(zusdc.symbol ?? zusdc.address);
  await page.getByRole("list", { name: "Search results" }).waitFor();
  await shot("search-results");
  await page.getByRole("list", { name: "Search results" }).getByRole("link").first().click();
  await page.waitForURL(/\/app\/explorer\/(token|address)\//, { timeout: 15_000 });
  await page.goto(`${BASE}/app/explorer/token/${zusdc.address}`);
  await page.getByText("Total supply").waitFor();
  check(true, "token page renders");
  await shot("token");
  await page.getByRole("tab", { name: "Holders" }).click();
  await page.waitForTimeout(800);
  await shot("token-holders");
}

// Unknown tx: terse 404.
await page.goto(`${BASE}/app/explorer/tx/0x${"00".repeat(32)}`);
await page.getByText("Transaction not found").waitFor({ timeout: 15_000 });
check(true, "unknown tx → not found");
await shot("tx-404");

// An address the indexer never saw: terse state, RPC balance still read.
await page.goto(`${BASE}/app/explorer/address/0x000000000000000000000000000000000000dead`);
await page.getByText("not seen on chain").waitFor({ timeout: 15_000 });
check(true, "unseen address → not seen on chain");
await shot("address-unseen");

// Sandbox mode keeps the live L1 and says so.
await page.evaluate(() =>
  localStorage.setItem(
    "zal.sandbox.mode.v1",
    JSON.stringify({ version: 1, enabled: true, account: "0xa11ce00000000000000000000000000000000a11" }),
  ),
);
await page.goto(`${BASE}/app/explorer`);
await page.getByRole("list", { name: "Latest blocks" }).waitFor({ timeout: 30_000 });
const chip = await page.getByText("live L1", { exact: true }).isVisible().catch(() => false);
check(chip, "sandbox: live L1 chip");
await shot("home-sandbox");

await page.evaluate(() => localStorage.removeItem("zal.sandbox.mode.v1"));

// Narrow viewport.
await page.setViewportSize({ width: 820, height: 1000 });
await page.goto(`${BASE}/app/explorer`);
await page.getByRole("list", { name: "Latest blocks" }).waitFor({ timeout: 30_000 });
await shot("home-narrow");

await browser.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (logs.length) console.log("browser errors:\n" + [...new Set(logs)].slice(0, 20).join("\n"));
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
