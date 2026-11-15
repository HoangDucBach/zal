// G2: the API accepts a SIWE message at most 60 s ahead of its clock, so the client dates it from the API's clock.
import "./env";
import { expect, test } from "vitest";

import { freshMember } from "./chain";
import { patiently } from "./session";

import { API_NONCE_TTL_MS, createSessionStore } from "@/lib/api/session";
import { api } from "@/lib/api/client";

test("G2: a browser clock 2 minutes fast cannot sign in at all", async () => {
  const m = await freshMember();
  const skew = 120_000;
  const store = createSessionStore({
    storage: () => undefined,
    now: () => Date.now() + skew, // the only change: the visitor's clock
    nonce: () => patiently(() => api.nonce()),
    verify: (msg, sig) => patiently(() => api.verify(msg, sig)),
    revoke: (t) => api.signOut(t),
  });
  const err: any = await store
    .signIn({
      chainId: 31337,
      wallet: m.account.address,
      origin: "http://localhost:3100",
      sign: (message) => m.account.signMessage({ message }),
    })
    .then(
      () => undefined,
      (e) => e,
    );

  // The message is dated from the API's clock (the nonce's expiry), so the visitor's clock does not matter.
  expect(err).toBeUndefined();
});

test("G2b: the nonce TTL the client dates messages from is the API's", async () => {
  let res = await fetch("http://localhost:42069/v1/auth/nonce", {
    method: "POST",
  });

  // The auth rate limit is shared with every stack file running in parallel: wait out a 429 as it asks.
  while (res.status === 429) {
    await new Promise((r) =>
      setTimeout(r, Number(res.headers.get("retry-after") ?? "3") * 1_000),
    );
    res = await fetch("http://localhost:42069/v1/auth/nonce", {
      method: "POST",
    });
  }
  const body = (await res.json()) as { expiresAt: string };
  const serverNow = Date.parse(res.headers.get("date") ?? "");
  const ttl = Date.parse(body.expiresAt) - serverNow;

  // The Date header has whole seconds: the TTL is within one second of the client's constant.
  expect(Math.abs(ttl - API_NONCE_TTL_MS)).toBeLessThan(1_000);
});
