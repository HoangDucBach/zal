// Drives the app with a stub wallet and asserts the canvas layout holds through navigation, sandbox, reset, resize
// and theme. Usage: BASE=<web url> node e2e/zal-check.mjs [outDir] [tag] [--seller]
import { BASE, OUT, launch, stubWallet } from "./lib.mjs";

const TAG = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))[1] ?? "run";
const SELLER = process.argv.includes("--seller");
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
  await page.waitForTimeout(400);
  const file = `${OUT}/${TAG}-${String(n++).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, ...opts });
  console.log("shot", file);
};
const button = (name) => page.getByRole("button", { name, exact: false });
const node = (kind, text) => {
  const l = page.locator(`.react-flow__node-${kind}`);
  return text === undefined ? l : l.filter({ hasText: text });
};
const pick = (component) => page.locator(`[data-component=${component}] button`);
const inspector = () => page.locator('[data-canvas-panel="column"]');
const deselect = () => page.locator(".react-flow__pane").click({ position: { x: 900, y: 140 } });

/** The layout invariants the owner saw broken: absolute panels, a dot grid, no panel on top of another. */
async function assertCanvas(label) {
  await page.locator(".react-flow__panel").first().waitFor();
  await page.waitForTimeout(600);
  const probe = await page.evaluate(() => {
    // The floating panels share one xyflow Panel; each region in it is tagged `data-canvas-panel`.
    const absolute = [...document.querySelectorAll(".react-flow__panel")].every((p) => getComputedStyle(p).position === "absolute");
    const panels = [...document.querySelectorAll("[data-canvas-panel]")].map((p) => {
      const r = p.getBoundingClientRect();
      // A panel's own box can be wider than what it shows (the bottom bar is full width); measure its content.
      const kids = [...p.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0);
      const box = kids.length === 0 ? r : {
        left: Math.min(...kids.map((b) => b.left)), top: Math.min(...kids.map((b) => b.top)),
        right: Math.max(...kids.map((b) => b.right)), bottom: Math.max(...kids.map((b) => b.bottom)),
      };
      return { cls: p.dataset.canvasPanel, box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } };
    });
    const pattern = document.querySelector(".react-flow__background pattern circle, .react-flow__background-pattern.dots");
    const bg = document.querySelector(".react-flow__background");
    const rf = document.querySelector(".react-flow");
    return {
      absolute,
      panels,
      pattern: pattern !== null,
      bgImage: bg ? getComputedStyle(bg).backgroundImage : "none",
      theme: rf?.classList.contains("dark") ? "dark" : "light",
      htmlTheme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      nodes: document.querySelectorAll(".react-flow__node").length,
    };
  });
  check(probe.panels.length > 0 && probe.absolute, `${label}: every .react-flow__panel is position:absolute`);
  check(probe.pattern, `${label}: background dot pattern exists`);
  check(probe.bgImage.includes("radial-gradient"), `${label}: radial token gradient behind the grid`);
  check(probe.theme === probe.htmlTheme, `${label}: xyflow colorMode follows the app theme (${probe.theme})`);
  const overlaps = [];
  for (let i = 0; i < probe.panels.length; i++)
    for (let j = i + 1; j < probe.panels.length; j++) {
      const a = probe.panels[i].box, b = probe.panels[j].box;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
        overlaps.push(`${probe.panels[i].cls} x ${probe.panels[j].cls}`);
    }
  check(overlaps.length === 0, `${label}: panels do not overlap${overlaps.length ? ` (${overlaps.join("; ")})` : ""}`);
  return probe;
}

const navTo = async (name) => {
  await page.getByRole("navigation", { name: "App" }).getByRole("link", { name }).click();
  await page.waitForURL(new RegExp(`/app/${name.toLowerCase()}`));
};

try {
  console.log("fresh load, disconnected");
  await page.goto(`${BASE}/app/canvas`);
  await page.getByText("Connect a wallet").first().waitFor();
  await assertCanvas("fresh disconnected");
  await shot("canvas-disconnected");

  console.log("connect, sandbox on");
  await page.goto(`${BASE}/app/canvas?sandbox=1`);
  await button("Connect wallet").first().click();
  await node("account").getByText("10,000.00").waitFor({ timeout: 120_000 });
  await assertCanvas("sandbox seeded");
  await shot("canvas-seeded");

  console.log("client navigation Overview -> Canvas -> Overview -> Canvas");
  await navTo("Overview");
  await page.getByText("Your money at a glance").first().waitFor();
  console.log("  overview headings:", await page.getByText("Your money at a glance").evaluateAll((els) => els.map((e) => `${e.tagName}:${e.checkVisibility()}`).join(",")));
  await page.getByText("Account balance").first().waitFor({ timeout: 60_000 });
  await shot("overview-empty", { fullPage: true });
  await navTo("Canvas");
  await node("account").waitFor();
  await assertCanvas("nav back 1");
  await navTo("Overview");
  await page.getByText("Account balance").first().waitFor();
  await navTo("Canvas");
  await node("account").waitFor();
  await assertCanvas("nav back 2");

  if (SELLER) {
    console.log("seller demo");
    await pick("split").click();
    await button("Save Split").click();
    await node("split").getByText("90%").waitFor();
    await deselect();
    await pick("endpoint").click();
    await inspector().getByText("Public: buyers see your Split").click();
    await page.getByText("Split visibility saved").first().waitFor();
    await deselect();
    await page.dragAndDrop("[data-component=counterparty]", ".react-flow__node-account");
    await button("Use demo club").click();
    await button("Propose relationship").click();
    await node("counterparty", "Demo club").getByText("waiting for acceptance").waitFor();
    await node("counterparty", "Demo club").getByText("waiting for acceptance").waitFor({ state: "detached", timeout: 40_000 });
    await node("counterparty", "Demo club").click();
    await pick("invoice").click();
    await button("Issue invoice").click();
    await node("invoice", "Invoice #1").waitFor();
    await node("invoice", "Invoice #1").getByText("escrow-backed").waitFor({ timeout: 60_000 });
    await assertCanvas("seller mid-demo (invoice selected, inspector open)");
    await shot("canvas-invoice");
    await node("invoice", "Invoice #1").click();
    await pick("pool").click();
    await button("Request advance").click();
    await node("invoice", "Invoice #1").getByText("financed").waitFor();
    await deselect();
    await shot("canvas-financed");
    await navTo("Overview");
    await page.getByText("Early cash").first().waitFor();
    await page.waitForTimeout(1500);
    await shot("overview-financed", { fullPage: true });
    await navTo("Canvas");
    await node("invoice", "Invoice #1").waitFor();
    await button("Jump to due date of #1").click();
    await node("invoice", "Invoice #1").getByText("paid").first().waitFor({ timeout: 60_000 });
    await deselect();
    await assertCanvas("seller demo done");
    await shot("canvas-paid");
    await navTo("Overview");
    await page.getByRole("link", { name: "Invoice #1" }).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    await shot("overview-after-seller", { fullPage: true });
    await page.getByRole("link", { name: "Invoice #1" }).first().click();
    await page.waitForURL(/focus=invoice-1/);
    await inspector().getByText("Payment recipient").waitFor();
    check(true, "overview row deep-links to the invoice node");
    await assertCanvas("deep link focus");
    await shot("canvas-focus");
  }

  console.log("resize");
  await page.setViewportSize({ width: 1280, height: 800 });
  await assertCanvas("resized 1280x800");
  await shot("canvas-1280");
  await page.setViewportSize({ width: 1680, height: 1050 });

  console.log("theme");
  await button("Switch to light theme").click();
  await assertCanvas("light theme");
  await shot("canvas-light");
  await navTo("Overview");
  await page.waitForTimeout(1200);
  await shot("overview-light", { fullPage: true });
  await navTo("Canvas");
  await button("Switch to dark theme").click();
  await assertCanvas("back to dark");

  console.log("reset");
  await button("Reset").click();
  await node("account").getByText("10,000.00").waitFor({ timeout: 120_000 });
  await assertCanvas("after reset");

  console.log("sandbox off, then on");
  await page.getByRole("switch", { name: "Sandbox" }).click({ force: true });
  await page.waitForTimeout(2500);
  await assertCanvas("sandbox off");
  await shot("canvas-sandbox-off");
  await page.getByRole("switch", { name: "Sandbox" }).click({ force: true });
  await node("account").waitFor({ timeout: 120_000 });
  await assertCanvas("sandbox on again");

  console.log("hard reload");
  await page.reload();
  await node("account").waitFor({ timeout: 120_000 });
  await assertCanvas("reload");
} catch (error) {
  failures.push(`threw: ${error.message.split("\n")[0]}`);
  await shot("THREW");
} finally {
  console.log(`\n${TAG}: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  -", f);
  console.log("console errors:", logs.length === 0 ? "none" : `\n${[...new Set(logs)].slice(0, 10).join("\n")}`);
  await browser.close();
  process.exitCode = failures.length === 0 ? 0 : 1;
}
