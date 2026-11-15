// Shared setup for the e2e drivers: the app under test, the browser, the screenshot folder and a stub wallet.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "playwright-core";

export const BASE = process.env.BASE ?? "http://localhost:3100";

/** Screenshots go to the first positional argument, or to `e2e/.out`. */
export const OUT = resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? new URL(".out", import.meta.url).pathname,
);
mkdirSync(OUT, { recursive: true });

/** `PLAYWRIGHT_CHROMIUM` names a Chromium or headless-shell binary; without it, Playwright's own install is used. */
export const launch = () =>
  chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

export const VISITOR = "0xa11ce00000000000000000000000000000000a11";

/** A wallet that only connects: enough for the sandbox, whose chain runs in the page. */
export const stubWallet = (target, account = VISITOR) =>
  target.addInitScript((address) => {
    window.ethereum = {
      async request({ method }) {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_chainId") return "0xa86a";
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
        throw Object.assign(new Error(`stub wallet: ${method}`), { code: 4200 });
      },
      on() {},
      removeListener() {},
    };
  }, account);

export async function open(viewport = { width: 1280, height: 800 }) {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => m.type() === "error" && logs.push(`console: ${m.text().split("\n")[0]}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message.split("\n")[0]}`));
  await stubWallet(page);
  return { browser, ctx, page, logs };
}

export async function enter(page) {
  await page.goto(`${BASE}/app/canvas?sandbox=1`);
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.locator(".react-flow__node-account").getByText("10,000.00").waitFor({ timeout: 180_000 });
  await page.waitForTimeout(1200);
}

export const zoom = (page) =>
  page.locator(".react-flow__viewport").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
