// Free placement, drag-to-connect, tooltips and Reset on the sandbox canvas.
// Usage: BASE=<web url> node e2e/zal-connect.mjs [outDir]
import { OUT, enter, open, zoom } from "./lib.mjs";

const { browser, page, logs } = await open({ width: 1280, height: 800 });
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
  const file = `${OUT}/connect-${String(n++).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, ...opts });
  console.log("shot", file);
};
const button = (name) => page.getByRole("button", { name, exact: false });
const node = (kind, text) => {
  const l = page.locator(`.react-flow__node-${kind}`);
  return text === undefined ? l : l.filter({ hasText: text });
};
const inspector = () => page.locator(".react-flow__panel.top.right");
const draftLinks = () => page.locator('[data-testid^="rf__edge-link:"]');
const centre = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const pane = async (dx, dy) => {
  const b = await page.locator(".react-flow__pane").boundingBox();
  return { x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy };
};

/** Drags a palette item to a point on the pane (HTML5 drag and drop). */
async function dropAt(component, point) {
  const pb = await page.locator(".react-flow__pane").boundingBox();
  await page.dragAndDrop(`[data-component=${component}]`, ".react-flow__pane", {
    targetPosition: { x: point.x - pb.x, y: point.y - pb.y },
  });
  await page.waitForTimeout(300);
}

/** Starts a connection from a node's right edge and moves over `to`; returns a function that releases it. */
async function dragConnection(from, to, hold) {
  await from.hover();
  const handle = from.locator(".react-flow__handle-right.source").first();
  const h = await centre(handle);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  const t = await centre(to);
  await page.mouse.move(t.x, t.y, { steps: 18 });
  await page.waitForTimeout(250);
  if (hold !== undefined) await hold();
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** Connects two nodes by dragging, the way a user does. */
const connect = (from, to, hold) => dragConnection(from, to, hold);

try {
  console.log("seeded canvas at 1280x800");
  await enter(page);
  await button("Fit view").click();
  await page.waitForTimeout(800);
  const z = await zoom(page);
  check(z >= 0.6, `seeded root canvas fits at a readable zoom (${Math.round(z * 100)}%)`);
  await shot("seeded-1280");

  console.log("palette tooltip");
  await page.locator("[data-component=escrow] button").hover();
  await page.getByText("Locks face value for an approved invoice you pay").waitFor({ timeout: 4000 }).then(
    () => check(true, "palette item tooltip"),
    () => check(false, "palette item tooltip"),
  );
  await shot("palette-tooltip");
  await page.mouse.move(700, 700);

  console.log("drop a draft anywhere");
  const spot = await pane(40, 230);
  await dropAt("counterparty", spot);
  await node("draft").first().waitFor();
  const d = await node("draft").first().boundingBox();
  check(Math.abs(d.x + d.width / 2 - spot.x) < 30 && Math.abs(d.y + d.height / 2 - spot.y) < 30, `draft lands where it was dropped (${Math.round(d.x)},${Math.round(d.y)} vs ${Math.round(spot.x)},${Math.round(spot.y)})`);
  check((await node("draft").first().getByText("Draft").count()) === 1, "draft is labelled Draft");
  await node("draft").first().hover();
  await page.getByText(/connects to your Account/i).waitFor({ timeout: 4000 }).then(
    () => check(true, "draft tooltip says what it connects to"),
    () => check(false, "draft tooltip says what it connects to"),
  );  await shot("draft-placed");
  await node("draft").first().click();
  const panel = page.getByTestId("draft-panel");
  await panel.waitFor();
  check((await panel.getByText("connects to your Account").count()) === 1, "draft panel says what it connects to");
  await shot("draft-panel");
  await panel.getByRole("button", { name: "Close" }).click();
  await panel.waitFor({ state: "detached" });
  await page.mouse.move(700, 120);
  await page.waitForTimeout(300);

  console.log("drag a connection to an invalid node");
  const draft = node("draft").first();
  await dragConnection(draft, node("split"), async () => {
    check((await node("split").locator("[data-connect=invalid]").count()) === 1, "Split shows disabled while dragging");
    check((await node("account").locator("[data-connect=valid]").count()) === 1, "Account highlights as a valid target");
    const hint = await page.getByTestId("connect-hint").textContent().catch(() => null);
    check(hint !== null && hint.includes("Counterparty attaches to the Account"), `hover tooltip gives the reason (${hint})`);
    await shot("dragging-invalid");
  });
  check((await draftLinks().count()) === 0, "invalid drop adds no connection");
  check((await inspector().getByText("New counterparty").count()) === 0, "invalid drop opens no form");
  check((await page.getByText(/Counterparty attaches to the Account/).count()) >= 1, "invalid drop toasts the reason");
  await shot("invalid-toast");

  console.log("drag a connection to a valid node");
  await dragConnection(draft, node("account"), async () => {
    const hint = await page.getByTestId("connect-hint").textContent().catch(() => null);
    check(hint !== null && hint.startsWith("Connect: Propose"), `valid hover tooltip says what it does (${hint})`);
    await shot("dragging-valid");
  });
  await inspector().getByText("New counterparty").waitFor();
  check(true, "valid drop opens the prefilled Propose form");
  check((await draftLinks().count()) === 1, "a dashed draft link joins the two");
  await shot("valid-form");

  console.log("seller demo by connections");
  await button("Use demo club").click();
  await button("Propose relationship").click();
  await node("counterparty", "Demo club").waitFor();
  await node("draft").first().waitFor({ state: "detached" }).then(
    () => check(true, "draft gives way to the on-chain node once confirmed"),
    () => check(false, "draft gives way to the on-chain node once confirmed"),
  );
  check((await draftLinks().count()) === 0, "draft link settles");
  await node("counterparty", "Demo club").getByText("waiting for acceptance").waitFor({ state: "detached", timeout: 60_000 });  await connect(node("account"), node("split"));
  await inspector().getByText(/leg = amount × %/).waitFor();
  await shot("split-form");
  await button("Save Split").click();
  await node("split").getByText("90%").waitFor();

  await dropAt("endpoint", await pane(-200, 240));
  await connect(node("split"), node("draft").first());
  await inspector().getByText("Public: buyers see your Split").click();
  await node("split").getByText("endpoint public").waitFor();
  if ((await node("draft").count()) > 0) {
    await node("draft").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /Delete draft/ }).click();
  }
  await node("draft").first().waitFor({ state: "detached" });
  check(true, "a draft deletes from its context menu");

  await page.mouse.click(1000, 615);
  await dropAt("invoice", await pane(-150, 260));
  await connect(node("counterparty", "Demo club"), node("draft").first());
  await button("Issue invoice").click();
  await node("invoice", "Invoice #1").waitFor();
  await node("invoice", "Invoice #1").getByText("escrow-backed").waitFor({ timeout: 90_000 });
  await button("Fit view").click();
  await page.waitForTimeout(700);  await connect(node("invoice", "Invoice #1"), node("pool"));
  await inspector().getByText("Reserve at payment").waitFor();
  check((await inspector().getByText(/advance = 80% × face · fee fixed now · reserve = face − advance − fee/).count()) === 1, "advance form shows its formula");
  await shot("advance-form");
  await button("Request advance").click();
  await node("invoice", "Invoice #1").getByText("financed").waitFor({ timeout: 30_000 });
  check(true, "seller demo through advance done by connecting");
  await button("Fit view").click();
  await shot("seller-demo-done");

  console.log("Delete key removes a selected draft");
  await page.mouse.click(1000, 615);
  await dropAt("vault", await pane(-150, 150));
  await node("draft").first().click();
  await page.keyboard.press("Delete");
  await node("draft").first().waitFor({ state: "detached", timeout: 3000 }).then(
    () => check(true, "Delete key removes a draft"),
    () => check(false, "Delete key removes a draft"),
  );

  console.log("child canvas port tooltip");
  await node("counterparty", "Demo club").click();
  await node("invoice", "Invoice #1").click({ modifiers: ["Shift"] });
  await node("invoice", "Invoice #1").click({ button: "right" });
  await page.getByRole("menuitem", { name: /Move 2 nodes to a child canvas/ }).click();
  await node("gate").waitFor();
  await node("gate").getByText("child canvas").hover();
  await page.getByText(/Ports: money in · money out · links across the edge/).waitFor({ timeout: 4000 }).then(
    () => check(true, "gate tooltip"),
    () => check(false, "gate tooltip"),
  );
  await node("gate").getByRole("button", { name: "Open" }).click();
  await page.getByTestId("child-canvas-bar").waitFor();
  await page.waitForTimeout(800);
  const linkPort = node("port").filter({ hasText: "Link with" }).first();
  await linkPort.hover();
  await page.getByTestId("port-hint").waitFor({ timeout: 4000 });
  const portHint = await page.getByTestId("port-hint").textContent();
  check(/^Link with .* · no money moves$/.test(portHint ?? ""), `Link with port tooltip (${portHint})`);
  await shot("port-tooltip");
  await page.getByRole("button", { name: "Back to the parent canvas" }).click();
  await node("gate").waitFor();

  console.log("Reset leaves no stale grouping");
  await dropAt("budget", await pane(-150, 150));
  await button("Reset").click();
  await node("account").getByText("10,000.00").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(3000);
  check((await node("gate").count()) === 0, "no gate after Reset");
  check((await node("draft").count()) === 0, "no draft after Reset");
  await shot("after-reset");
  await page.reload();
  await node("account").getByText("10,000.00").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2000);
  check((await node("gate").count()) === 0, "no gate after Reset and reload (old state not saved back)");
  await shot("after-reset-reload");
} catch (error) {
  failures.push(`threw: ${error.message.split("\n")[0]}`);
  await shot("THREW");
} finally {
  console.log(`\nconnect: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  -", f);
  console.log("console errors:", logs.length === 0 ? "none" : `\n${[...new Set(logs)].slice(0, 10).join("\n")}`);
  await browser.close();
  process.exitCode = failures.length === 0 ? 0 : 1;
}
