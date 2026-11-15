// Runs every sandbox driver against BASE, one after another, and fails if any fails.
// Usage: BASE=<web url> node e2e/sandbox.mjs [outDir]
import { spawnSync } from "node:child_process";

const drivers = [["zal-connect.mjs"], ["zal-canvas.mjs"], ["zal-check.mjs", "--seller"], ["zal-partners.mjs"]];
const failed = [];
for (const [driver, ...flags] of drivers) {
  console.log(`\n== ${driver}`);
  const run = spawnSync(process.execPath, [new URL(driver, import.meta.url).pathname, ...process.argv.slice(2), ...flags], {
    stdio: "inherit",
  });
  if (run.status !== 0) failed.push(driver);
}
console.log(failed.length === 0 ? "\nsandbox e2e passed" : `\nsandbox e2e failed: ${failed.join(", ")}`);
process.exitCode = failed.length === 0 ? 0 : 1;
