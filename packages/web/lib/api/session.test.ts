import type { Address, Hex } from "viem";

import { parseSiweMessage } from "viem/siwe";
import { describe, expect, test, vi } from "vitest";

import { API_NONCE_TTL_MS, createSessionStore } from "./session";

const WALLET: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const NOW = Date.parse("2026-11-15T10:00:00Z");

function memoryStorage(): Storage {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

function setup(over: { now?: () => number } = {}) {
  const storage = memoryStorage();
  let clock = NOW;
  const verify = vi.fn(async (message: string, _signature: Hex) => ({
    token: `token-${verify.mock.calls.length}`,
    wallet: (
      parseSiweMessage(message).address ?? WALLET
    ).toLowerCase() as Address,
    expiresAt: new Date(clock + 3_600_000).toISOString(),
  }));
  const revoke = vi.fn(async () => undefined);
  const store = createSessionStore({
    storage: () => storage,
    now: over.now ?? (() => clock),
    nonce: async () => ({
      nonce: "a1b2c3d4e5f6a7b8",
      expiresAt: new Date(clock + API_NONCE_TTL_MS).toISOString(),
    }),
    verify,
    revoke,
  });

  return {
    store,
    storage,
    verify,
    revoke,
    tick: (ms: number) => (clock += ms),
  };
}

const params = (sign: (message: string) => Promise<Hex>) => ({
  chainId: 31_337,
  wallet: WALLET,
  origin: "http://localhost:3100",
  sign,
});

describe("API session store", () => {
  test("signs a SIWE message bound to the web origin and chain, then keeps the token", async () => {
    const { store, storage } = setup();
    const sign = vi.fn(async (_message: string) => "0xsig" as Hex);

    const session = await store.signIn(params(sign));
    const message = parseSiweMessage(sign.mock.calls[0]?.[0] ?? "");

    expect(message.domain).toBe("localhost:3100");
    expect(message.uri).toBe("http://localhost:3100");
    expect(message.chainId).toBe(31_337);
    expect(message.nonce).toBe("a1b2c3d4e5f6a7b8");
    expect(session.token).toBe("token-1");
    expect(store.get(31_337, WALLET)?.token).toBe("token-1");
    expect(storage.getItem("zal.api-session.v1:31337")).toContain("token-1");
  });

  test("a second sign-in while one is pending waits for the same signature", async () => {
    const { store, verify } = setup();
    let release: (sig: Hex) => void = () => undefined;
    const sign = vi.fn(
      () => new Promise<Hex>((resolve) => (release = resolve)),
    );

    const first = store.signIn(params(sign));
    const second = store.signIn(params(sign));

    expect(store.isSigningIn(31_337)).toBe(true);
    await vi.waitFor(() => expect(sign).toHaveBeenCalledOnce());
    release("0xsig");
    expect((await first).token).toBe((await second).token);
    expect(verify).toHaveBeenCalledOnce();
    expect(store.isSigningIn(31_337)).toBe(false);
  });

  test("is another wallet's session, an expired one, or a dropped one: none", async () => {
    const { store, tick } = setup();

    await store.signIn(params(async () => "0xsig"));
    expect(store.get(31_337, OTHER)).toBeUndefined();
    expect(store.get(1, WALLET)).toBeUndefined();
    tick(3_600_000);
    expect(store.get(31_337, WALLET)).toBeUndefined();
  });

  test("survives a reload in the same tab through sessionStorage", async () => {
    const first = setup();

    await first.store.signIn(params(async () => "0xsig"));
    const reloaded = createSessionStore({
      storage: () => first.storage,
      now: () => NOW,
      nonce: async () => ({ nonce: "x", expiresAt: "" }),
      verify: first.verify,
      revoke: first.revoke,
    });

    expect(reloaded.get(31_337, WALLET)?.token).toBe("token-1");
  });

  test("drop forgets a token the API rejected; sign-out also revokes it", async () => {
    const { store, storage, revoke } = setup();
    const listener = vi.fn();

    store.subscribe(listener);
    await store.signIn(params(async () => "0xsig"));
    store.drop(31_337);
    expect(store.get(31_337, WALLET)).toBeUndefined();
    expect(storage.getItem("zal.api-session.v1:31337")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();

    await store.signIn(params(async () => "0xsig"));
    await store.signOut(31_337);
    expect(revoke).toHaveBeenCalledWith("token-2");
    expect(store.get(31_337, WALLET)).toBeUndefined();
    expect(listener).toHaveBeenCalled();
  });

  test("dates the message from the API's clock, not the visitor's", async () => {
    const { store } = setup({ now: () => NOW + 120_000 });
    const sign = vi.fn(async (_message: string) => "0xsig" as Hex);

    await store.signIn(params(sign));
    const message = parseSiweMessage(sign.mock.calls[0]?.[0] ?? "");

    expect(message.issuedAt?.getTime()).toBe(NOW);
  });

  test("a refused signature leaves no session and no pending sign-in", async () => {
    const { store } = setup();

    await expect(
      store.signIn(params(() => Promise.reject(new Error("rejected")))),
    ).rejects.toThrow("rejected");
    expect(store.get(31_337, WALLET)).toBeUndefined();
    expect(store.isSigningIn(31_337)).toBe(false);
  });
});
