import { describe, expect, test } from "vitest";

import { readConfig } from "../lib/config.ts";

// anvil's public development key 1, local-only.
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const env = { ZAL_CHAIN_ID: "31337", ZAL_RPC_URL: "http://anvil:8545", ZAL_API_URL: "http://indexer:42069/", ZAL_KEEPER_PRIVATE_KEY: KEY };

describe("keeper config", () => {
  test("derives the keeper address and applies defaults", () => {
    const config = readConfig(env);
    expect(config).toMatchObject({ apiUrl: "http://indexer:42069", tickMs: 10_000, port: 42070, webOrigins: [] });
    expect(config.signer.address).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  });

  test("names a bad key without echoing it", () => {
    const bad = `${KEY.slice(0, -1)}z`;
    expect(() => readConfig({ ...env, ZAL_KEEPER_PRIVATE_KEY: bad })).toThrow(/ZAL_KEEPER_PRIVATE_KEY/);
    try {
      readConfig({ ...env, ZAL_KEEPER_PRIVATE_KEY: bad });
    } catch (err) {
      expect(String(err)).not.toContain(bad.slice(2, 20));
    }
  });

  test("refuses a tick under one second", () => {
    expect(() => readConfig({ ...env, KEEPER_TICK_MS: "10" })).toThrow(/KEEPER_TICK_MS/);
  });
});
