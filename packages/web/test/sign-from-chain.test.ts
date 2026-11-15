import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const SIGNABLE_OP = "components/canvas/signable-op.tsx";
const SIGNING_HOOK = /\buse(?:Confirm|Revoke)Op\s*\(/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return tsxFiles(path);

    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** Every `file:line` in `components/` and `app/` that builds a Confirm or Revoke mutation outside SignableOp. */
function signingOutsideSignableOp(root: string): string[] {
  return ["components", "app"]
    .flatMap((dir) => tsxFiles(join(root, dir)))
    .map((path) => relative(root, path))
    .filter((rel) => rel !== SIGNABLE_OP)
    .flatMap((rel) =>
      readFileSync(join(root, rel), "utf8")
        .split("\n")
        .flatMap((line, i) =>
          SIGNING_HOOK.test(line) ? [`${rel}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
}

describe("what Confirm signs is what the panel shows", () => {
  it("builds Confirm and Revoke only in SignableOp, which renders ChainVerified data alone", () => {
    const found = signingOutsideSignableOp(WEB);

    expect(
      found,
      `Render <SignableOp subject={ChainVerified<ChainOp>} /> from @/${SIGNABLE_OP} instead of calling useConfirmOp or useRevokeOp, so no API value sits next to a signing button:\n${found.join("\n")}`,
    ).toEqual([]);
  });
});
