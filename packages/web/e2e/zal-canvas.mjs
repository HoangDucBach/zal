// Drives the seller demo through child canvases, notifications, persistence and the minimap, asserting the
// layout invariants on the way. Usage: BASE=<web url> node e2e/zal-canvas.mjs [outDir] [tag]
import { BASE, OUT, launch, stubWallet } from "./lib.mjs";

const TAG = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))[1] ?? "canvas";
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
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
const inspector = () => page.locator(".react-flow__panel.top.right");
const deselect = () => page.locator(".react-flow__pane").click({ position: { x: 700, y: 400 } });
const menuItem = (name) => page.getByRole("menuitem", { name });

async function probePanels() {
  return page.evaluate(() => {
    const boxOf = (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
    };
    const panels = [...document.querySelectorAll(".react-flow__panel")].map((p) => {
      const kids = [...p.children].map(boxOf).filter((b) => b.width > 0 && b.height > 0);
      const box = kids.length === 0 ? boxOf(p) : {
        left: Math.min(...kids.map((b) => b.left)), top: Math.min(...kids.map((b) => b.top)),
        right: Math.max(...kids.map((b) => b.right)), bottom: Math.max(...kids.map((b) => b.bottom)),
      };
      return { cls: p.className.replace("react-flow__panel", "").trim(), position: getComputedStyle(p).position, box, kids };
    });
    const nodes = [...document.querySelectorAll(".react-flow__node")].map((el) => ({ id: el.getAttribute("data-id"), box: boxOf(el) }));
    return {
      panels,
      nodes,
      pattern: document.querySelector(".react-flow__background pattern circle, .react-flow__background-pattern.dots") !== null,
      bgImage: getComputedStyle(document.querySelector(".react-flow__background")).backgroundImage,
    };
  });
}
const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

/** Absolute panels, a dot grid over the token gradient, no panel on top of another. */
async function assertCanvas(label) {
  await page.locator(".react-flow__panel").first().waitFor();
  await page.waitForTimeout(500);
  const probe = await probePanels();
  check(probe.panels.every((p) => p.position === "absolute"), `${label}: every panel is position:absolute`);
  check(probe.pattern, `${label}: background dot pattern exists`);
  check(probe.bgImage.includes("radial-gradient"), `${label}: radial token gradient behind the grid`);
  const overlaps = [];
  for (let i = 0; i < probe.panels.length; i++)
    for (let j = i + 1; j < probe.panels.length; j++)
      if (hit(probe.panels[i].box, probe.panels[j].box)) overlaps.push(`${probe.panels[i].cls} x ${probe.panels[j].cls}`);
  check(overlaps.length === 0, `${label}: panels do not overlap${overlaps.length ? ` (${overlaps.join("; ")})` : ""}`);
  return probe;
}

/** After Fit view, no panel content sits over any node. */
async function assertFit(label) {
  await deselect();
  await button("Fit view").click();
  await page.waitForTimeout(700);
  const probe = await probePanels();
  const covered = [];
  for (const nd of probe.nodes)
    for (const p of probe.panels)
      for (const k of p.kids) if (hit(nd.box, k)) covered.push(`${nd.id} under ${p.cls}`);
  check(covered.length === 0, `${label}: no panel covers a node after fitView (${probe.nodes.length} nodes)${covered.length ? ` (${[...new Set(covered)].join("; ")})` : ""}`);
}

const navTo = async (name) => {
  await page.getByRole("navigation", { name: "App" }).getByRole("link", { name }).click();
  await page.waitForURL(new RegExp(`/app/${name.toLowerCase()}`));
};

try {
  console.log("connect, sandbox on");
  await page.goto(`${BASE}/app/canvas?sandbox=1`);
  await button("Connect wallet").first().click();
  await node("account").getByText("10,000.00").waitFor({ timeout: 120_000 });
  await assertCanvas("sandbox seeded");
  await assertFit("sandbox seeded");
  await shot("seeded");
  check((await page.locator(".react-flow__minimap").count()) === 1, "minimap shows by default");

  console.log("seller demo up to an issued invoice");
  await pick("split").click();
  await button("Save Split").click();
  await node("split").getByText("90%").waitFor();
  await deselect();
  await pick("endpoint").click();
  await inspector().getByText("Public: buyers see your Split").click();
  await node("split").getByText("endpoint public").waitFor();
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
  await deselect();
  await assertCanvas("invoice escrowed");
  await assertFit("invoice escrowed");
  await shot("before-child");

  console.log("child canvas from three nodes (shift-click, context menu)");
  await node("counterparty", "Demo club").click();
  await node("invoice", "Invoice #1").click({ modifiers: ["Shift"] });
  await node("escrow").first().click({ modifiers: ["Shift"] });
  check((await page.locator(".react-flow__node.selected").count()) === 3, "shift-click selects three nodes");
  await node("invoice", "Invoice #1").click({ button: "right" });
  await menuItem(/Move 3 nodes to a child canvas/).waitFor();
  await shot("context-menu");
  await menuItem(/Move 3 nodes to a child canvas/).click();
  await node("gate").waitFor();
  check((await node("gate").getByText("3 nodes").count()) === 1, "gate shows its node count");
  check((await node("invoice", "Invoice #1").count()) === 0, "grouped invoice left the root canvas");
  check((await node("account").count()) === 1, "Account stays on the root");
  await assertCanvas("gate on root");
  await assertFit("gate on root");
  await shot("gate-on-root");

  console.log("deep link from Overview opens the child level");
  await navTo("Overview");
  await page.getByRole("link", { name: "Invoice #1" }).first().waitFor({ timeout: 60_000 });
  await page.getByRole("link", { name: "Invoice #1" }).first().click();
  await page.waitForURL(/focus=invoice-1/);
  await page.getByTestId("child-canvas-bar").waitFor();
  await node("invoice", "Invoice #1").waitFor();
  check(true, "?focus=invoice-1 opened the child canvas holding it");
  await shot("deep-link-child");

  console.log("inside the child canvas");
  check((await node("port").count()) >= 2, `gate ports at the edge of the child view (${await node("port").count()})`);
  check((await node("account").count()) === 0, "the Account is not drawn inside the child");
  await assertCanvas("inside child");
  await assertFit("inside child");
  await shot("inside-child");
  await node("invoice", "Invoice #1").click();
  await pick("pool").click();
  await button("Request advance").click();
  await node("invoice", "Invoice #1").getByText("financed").waitFor();
  check(true, "advance requested from inside the child canvas");

  console.log("notification arrives and the Inbox glows");
  await page.locator('[data-testid=inbox][data-glowing=true]').waitFor({ timeout: 30_000 });
  check(true, "Inbox glows on a new notification");
  await page.getByText("Advance on invoice #1 paid").first().waitFor();
  const inboxBox = await page.getByTestId("inbox").boundingBox();
  await shot("inbox-glow", { clip: { x: inboxBox.x - 40, y: inboxBox.y - 30, width: inboxBox.width + 80, height: inboxBox.height + 60 } });
  await shot("glow-full");
  await page.getByTestId("inbox").hover();
  await page.locator('[data-testid=inbox][data-glowing=false]').waitFor();
  check(true, "glow stops once the Inbox is seen");
  const unreadBefore = await page.getByRole("button", { name: /, unread$/ }).count();
  await button("Mark all read").click();
  check(unreadBefore > 0 && (await page.getByRole("button", { name: /, unread$/ }).count()) === 0, `mark all read clears ${unreadBefore} unread`);

  console.log("leave the child via the breadcrumb");
  await page.getByTestId("child-canvas-bar").getByText("Canvas", { exact: true }).click();
  await page.getByTestId("child-canvas-bar").waitFor({ state: "detached" });
  await node("gate").getByText("3,949.99").waitFor({ timeout: 10_000 }).then(
    () => check(true, "gate shows money in from the advance"),
    () => check(false, "gate shows money in from the advance"),
  );
  await shot("back-on-root");

  console.log("pay at the due date, notification flies across levels");
  await button("Jump to due date of #1").click();
  await page.getByText("Invoice #1 paid").first().waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: /Invoice #1 paid, unread/ }).click();
  await page.getByTestId("child-canvas-bar").waitFor();
  await node("invoice", "Invoice #1").getByText("paid").first().waitFor();
  check(true, "clicking a notification opens the child canvas at its node");
  await page.getByRole("button", { name: "Back to the parent canvas" }).click();

  console.log("dissolve the child canvas");
  await node("gate").click({ button: "right" });
  await menuItem(/Dissolve/).click();
  await node("gate").waitFor({ state: "detached" });
  await node("invoice", "Invoice #1").waitFor();
  check(true, "dissolve returns the nodes to the root");
  await assertCanvas("after dissolve");
  await assertFit("after dissolve");
  await shot("after-dissolve");

  console.log("a node passing under a glass bar stays legible");
  {
    const acc = await node("account").boundingBox();
    const pal = await page.locator("[data-component=counterparty]").boundingBox();
    await page.mouse.move(acc.x + 100, acc.y + 30);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(pal.x + 60, pal.y + 30, { steps: 15 });
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(300);
    const palette = await page.locator(".react-flow__panel.top.left").boundingBox();
    await shot("glass-over-node", { clip: { x: palette.x - 20, y: palette.y, width: palette.width + 220, height: 260 } });
    await button("Fit view").click();
    await page.waitForTimeout(500);
  }

  console.log("drag and reload");
  const before = await node("account").evaluate((el) => el.style.transform);
  const box = await node("account").boundingBox();
  await page.mouse.move(box.x + 40, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 160, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const dragged = await node("account").evaluate((el) => el.style.transform);
  check(dragged !== before, `account moved (${before} -> ${dragged})`);
  await page.reload();
  await node("account").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
  const reloaded = await node("account").evaluate((el) => el.style.transform);
  check(reloaded === dragged, `position persisted across reload (${reloaded})`);
  await shot("after-reload");

  console.log("minimap toggle");
  await page.getByRole("button", { name: "Minimap" }).click();
  check((await page.locator(".react-flow__minimap").count()) === 0, "minimap toggles off");
  await page.getByRole("button", { name: "Minimap" }).click();
  check((await page.locator(".react-flow__minimap").count()) === 1, "minimap toggles on");

  console.log("resize and light theme");
  await page.setViewportSize({ width: 1280, height: 800 });
  await assertCanvas("1280x800");
  await assertFit("1280x800");
  await shot("canvas-1280");
  await page.setViewportSize({ width: 1680, height: 1050 });
  await button("Switch to light theme").click();
  await assertCanvas("light theme");
  await shot("canvas-light");
  await button("Switch to dark theme").click();
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
