// The floating canvas panels at window sizes from half-screen to full HD, with the sidebar expanded and collapsed:
// no panel on top of another, no page scroll, the minimap hidden where it does not fit, and empty space around the
// panels passing pointer events through to the canvas.
// Usage: BASE=<web url> node e2e/zal-responsive.mjs [outDir]
import { BASE, OUT, launch, stubWallet } from "./lib.mjs";

const SIZES = [
  { width: 1150, height: 1300 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
];

let passed = 0;
const failures = [];
const check = (ok, what) => {
  if (ok) passed++;
  else failures.push(what);
  console.log(ok ? "  pass" : "  FAIL", what);
};

/** Each tagged region measured by what it shows: a region's own box spans its whole flex track. */
const probe = (page) =>
  page.evaluate(() => {
    const boxOf = (el) => el.getBoundingClientRect();
    const panels = [...document.querySelectorAll("[data-canvas-panel]")].map((p) => {
      const own = boxOf(p);
      // A scrolling region shows only its own box; content scrolled out of it is not on screen.
      const clips = getComputedStyle(p).overflowY !== "visible";
      const kids = [...p.children]
        .map(boxOf)
        .map((b) => clips ? { left: b.left, right: b.right, top: Math.max(b.top, own.top), bottom: Math.min(b.bottom, own.bottom), width: b.width, height: Math.min(b.bottom, own.bottom) - Math.max(b.top, own.top) } : b)
        .filter((b) => b.width > 0 && b.height > 0);
      const box = kids.length === 0 ? own : {
        left: Math.min(...kids.map((b) => b.left)), top: Math.min(...kids.map((b) => b.top)),
        right: Math.max(...kids.map((b) => b.right)), bottom: Math.max(...kids.map((b) => b.bottom)),
      };
      return { name: p.dataset.canvasPanel, box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } };
    });
    const flow = document.querySelector(".react-flow").getBoundingClientRect();
    return {
      panels,
      flow: { left: flow.left, top: flow.top, right: flow.right, bottom: flow.bottom },
      pageScroll: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
      minimap: document.querySelector(".react-flow__minimap") !== null,
    };
  });
const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
const inside = (a, b) => a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
const transform = (page) => page.locator(".react-flow__viewport").evaluate((el) => getComputedStyle(el).transform);

const browser = await launch();
try {
  for (const viewport of SIZES)
    for (const sidebar of ["expanded", "collapsed"]) {
      const label = `${viewport.width}x${viewport.height} ${sidebar}`;
      const ctx = await browser.newContext({ viewport });
      await ctx.addInitScript((choice) => {
        try {
          localStorage.setItem("zal.sidebar", choice);
        } catch {
          // A blocked storage only loses the choice; the run then uses the breakpoint default.
        }
      }, sidebar);
      const page = await ctx.newPage();
      await stubWallet(page);
      await page.goto(`${BASE}/app/canvas?sandbox=1`);
      await page.getByRole("button", { name: "Connect wallet" }).first().click();
      await page.locator(".react-flow__node-split").first().waitFor({ timeout: 180_000 });
      await page.waitForTimeout(1200);

      const p = await probe(page);
      const overlaps = [];
      for (let i = 0; i < p.panels.length; i++)
        for (let j = i + 1; j < p.panels.length; j++)
          if (hit(p.panels[i].box, p.panels[j].box)) overlaps.push(`${p.panels[i].name} x ${p.panels[j].name}`);
      check(overlaps.length === 0, `${label}: panels do not overlap${overlaps.length ? ` (${overlaps.join("; ")})` : ""}`);
      const outside = p.panels.filter((x) => !inside(x.box, p.flow)).map((x) => x.name);
      check(outside.length === 0, `${label}: panels stay inside the canvas${outside.length ? ` (${outside.join(", ")})` : ""}`);
      check(!p.pageScroll, `${label}: the page does not scroll`);
      const fits = viewport.width >= 1024 && viewport.height >= 700;
      if (!fits) check(!p.minimap, `${label}: minimap hidden`);
      await page.screenshot({ path: `${OUT}/resp-${viewport.width}x${viewport.height}-${sidebar}.png` });

      if (viewport.width === 1150) {
        // The empty space under the Inbox column belongs to the canvas: it hit-tests to the pane and pans.
        const column = p.panels.find((x) => x.name === "column").box;
        const x = Math.round((column.left + column.right) / 2);
        const y = Math.round(column.bottom + 120);
        const target = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.className ?? "", [x, y]);
        check(String(target).includes("react-flow__pane"), `${label}: empty space under the Inbox hits the pane (${target})`);
        const before = await transform(page);
        await page.mouse.move(x, y);
        await page.mouse.down({ button: "middle" });
        await page.mouse.move(x - 150, y + 60, { steps: 10 });
        await page.mouse.up({ button: "middle" });
        await page.waitForTimeout(300);
        check((await transform(page)) !== before, `${label}: a drag under the Inbox pans the canvas`);
      }
      await ctx.close();
    }
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log("  -", f);
  process.exit(1);
}
