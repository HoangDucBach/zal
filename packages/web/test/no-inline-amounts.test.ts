import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const AMOUNT = "components/ui/amount.tsx";
const FORMATTER_CALL = /\bformat(?:Usdc|UsdcCents|Bps)\s*\(/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return tsxFiles(path);

    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** Every `file:line` in `components/` and `app/` that formats money itself instead of rendering `Amount` or `Bps`. */
function inlineAmounts(root: string): string[] {
  return ["components", "app"]
    .flatMap((dir) => tsxFiles(join(root, dir)))
    .map((path) => relative(root, path))
    .filter((rel) => rel !== AMOUNT)
    .flatMap((rel) =>
      readFileSync(join(root, rel), "utf8")
        .split("\n")
        .flatMap((line, i) =>
          FORMATTER_CALL.test(line) ? [`${rel}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
}

describe("money is the loudest text", () => {
  it("formats USDC and bps only inside the Amount component", () => {
    const found = inlineAmounts(WEB);

    expect(
      found,
      `Render money with <Amount value={…} /> or <Bps value={…} /> from @/${AMOUNT}, or amountText() where only a string fits:\n${found.join("\n")}`,
    ).toEqual([]);
  });
});
