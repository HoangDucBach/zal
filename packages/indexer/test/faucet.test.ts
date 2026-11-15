// POST /v1/faucet over PGlite with a fake chain: balances in a map, sends recorded in order.
import type { Address, Hash } from "viem";
import type { Faucet } from "../lib/faucet.ts";

import { describe, expect, test } from "vitest";

import { DRIPS_PER_IP } from "../lib/faucet.ts";
import { createHarness, TEST_IP_HEADER } from "./api-harness.ts";

const DRIP = 50_000_000_000_000_000n;
const MIN = 10_000_000_000_000_000n;
const FAUCET_ADDRESS: Address = "0x00000000000000000000000000000000000fa0ce";
const wallet = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;

/** A chain whose `send` takes `sendMs`, records each transfer and counts overlapping sends. */
function fakeFaucet({ sendMs = 0, fail = false } = {}) {
  const balances = new Map<string, bigint>([[FAUCET_ADDRESS, 1_000n * DRIP]]);
  const sent: { to: Address; value: bigint }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const faucet: Faucet = {
    address: FAUCET_ADDRESS,
    dripWei: DRIP,
    minBalanceWei: MIN,
    balanceOf: (a) => Promise.resolve(balances.get(a.toLowerCase()) ?? 0n),
    async send(to, value) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, sendMs));
      inFlight -= 1;
      if (fail) throw new Error("insufficient funds for gas * price + value");
      sent.push({ to, value });
      const hash: Hash = `0x${sent.length.toString(16).padStart(64, "0")}`;
      return hash;
    },
  };
  return { faucet, balances, sent, maxInFlight: () => maxInFlight };
}

async function setup(chain = fakeFaucet()) {
  const h = await createHarness({}, { faucet: chain.faucet });
  const drip = async (to: Address, ip = "10.0.0.1") => h.request("POST", "/v1/faucet", { wallet: to }, undefined, { [TEST_IP_HEADER]: ip });
  return { ...h, ...chain, drip };
}

describe("POST /v1/faucet", () => {
  test("drips once to an empty wallet and answers the hash and amount", async () => {
    const f = await setup();
    const res = await f.drip(wallet(1));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      asOf: { block: 7, updatedAt: 1_700_000_000 },
      txHash: `0x${"1".padStart(64, "0")}`,
      amountWei: DRIP.toString(),
    });
    expect(f.sent).toEqual([{ to: wallet(1), value: DRIP }]);
    const rows = await f.pg.query<{ tx_hash: string }>("select tx_hash from zal_app.faucet_drips");
    expect(rows.rows).toEqual([{ tx_hash: `0x${"1".padStart(64, "0")}` }]);
  });

  test("refuses a wallet that already has gas, without recording a drip", async () => {
    const f = await setup();
    f.balances.set(wallet(2), MIN);
    const res = await f.drip(wallet(2));
    expect(res.status).toBe(409);
    expect(f.sent).toEqual([]);
  });

  test("gives one wallet one drip per 24 h, even from another IP", async () => {
    const f = await setup();
    expect((await f.drip(wallet(3), "10.0.0.1")).status).toBe(201);
    const again = await f.drip(wallet(3), "10.0.0.2");
    expect(again.status).toBe(429);
    expect(Number(again.headers.get("Retry-After"))).toBeGreaterThan(23 * 3600);
    expect(f.sent).toHaveLength(1);
  });

  test(`gives one IP at most ${DRIPS_PER_IP} drips per 24 h`, async () => {
    const f = await setup();
    for (let n = 1; n <= DRIPS_PER_IP; n++) expect((await f.drip(wallet(100 + n))).status).toBe(201);
    expect((await f.drip(wallet(200))).status).toBe(429);
    expect((await f.drip(wallet(200), "10.0.0.9")).status).toBe(201);
  });

  test("two concurrent requests for one wallet drip once", async () => {
    const f = await setup(fakeFaucet({ sendMs: 20 }));
    const statuses = (await Promise.all([f.drip(wallet(4)), f.drip(wallet(4), "10.0.0.2")])).map((r) => r.status);
    expect(statuses.sort()).toEqual([201, 429]);
    expect(f.sent).toHaveLength(1);
  });

  test("sends one drip at a time, so two drips never share a nonce", async () => {
    const f = await setup(fakeFaucet({ sendMs: 20 }));
    const statuses = (await Promise.all([1, 2, 3].map((n) => f.drip(wallet(300 + n))))).map((r) => r.status);
    expect({ statuses, maxInFlight: f.maxInFlight() }).toEqual({ statuses: [201, 201, 201], maxInFlight: 1 });
  });

  test("a failed send is a 503 and frees the wallet's claim", async () => {
    const f = await setup(fakeFaucet({ fail: true }));
    const res = await f.drip(wallet(5));
    expect(res.status).toBe(503);
    const rows = await f.pg.query("select 1 from zal_app.faucet_drips");
    expect(rows.rows).toEqual([]);
  });

  test("refuses a body that is not an address", async () => {
    const f = await setup();
    expect((await f.request("POST", "/v1/faucet", { wallet: "0x123" })).status).toBe(400);
  });

  test("throttles bursts from one IP before touching the chain", async () => {
    const f = await setup();
    const statuses: number[] = [];
    for (let n = 0; n < 11; n++) statuses.push((await f.request("POST", "/v1/faucet", { wallet: "nope" })).status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
  });

  test("without a faucet key the route answers 503 and GET says disabled", async () => {
    const h = await createHarness();
    const res = await h.request("POST", "/v1/faucet", { wallet: wallet(6) });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { detail: string }).detail).toBe("The faucet is not configured");
    expect(await (await h.request("GET", "/v1/faucet")).json()).toMatchObject({ enabled: false, dripWei: null });
  });
});

describe("GET /v1/faucet", () => {
  test("states the drip, the threshold and what the faucet holds", async () => {
    const f = await setup();
    expect(await (await f.request("GET", "/v1/faucet")).json()).toEqual({
      asOf: { block: 7, updatedAt: 1_700_000_000 },
      enabled: true,
      address: FAUCET_ADDRESS,
      dripWei: DRIP.toString(),
      minBalanceWei: MIN.toString(),
      faucetBalanceWei: (1_000n * DRIP).toString(),
    });
  });
});
