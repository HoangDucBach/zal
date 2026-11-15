// W0/W1: the real API response parses with the client schema, and a number outside its on-chain domain does not.
import "./env";
import { expect, test } from "vitest";

import { canvasResponseSchema } from "@/lib/api/wire";

const real = async () => {
  const pool = await (await fetch("http://localhost:42069/v1/pool")).json();
  const res = await fetch(
    "http://localhost:42069/v1/accounts/0x0000000000000000000000000000000000000001/canvas?wallet=0x0000000000000000000000000000000000000002",
  );

  return { pool, canvas: await res.json() };
};

test("W0: the real API's canvas response parses with the client schema (baseline)", async () => {
  const { canvas } = await real();

  expect(canvasResponseSchema.safeParse(canvas).success).toBe(true);
});

test("W1: out-of-domain numbers are accepted and rendered (negative balance, > uint256 amount)", async () => {
  const { canvas } = await real();
  const bad = structuredClone(canvas);

  bad.canvas.account.balance = "-5000000";
  bad.canvas.lp.walletUsdc = "9".repeat(90);
  bad.canvas.account.threshold = -3;
  const r = canvasResponseSchema.safeParse(bad);

  expect(r.success).toBe(false);
});
