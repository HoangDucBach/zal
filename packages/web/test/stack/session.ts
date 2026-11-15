import "./env";
import type { Hex } from "viem";

import { createSessionStore } from "@/lib/api/session";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/query/errors";

/**
 * Retries an auth call the API rate-limited (20 per minute per IP, shared by every stack test file running in
 * parallel), as a patient client would, instead of failing the test on the shared budget.
 */
export async function patiently<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 429 || attempt >= 30)
        throw error;
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

/** The real session store on the real API: one SIWE sign-in for a wallet. */
export async function signInReal(member: {
  account: {
    address: `0x${string}`;
    signMessage: (a: { message: string }) => Promise<Hex>;
  };
}) {
  const store = createSessionStore({
    storage: () => undefined,
    now: () => Date.now(),
    nonce: () => patiently(() => api.nonce()),
    verify: (m, s) => patiently(() => api.verify(m, s)),
    revoke: (t) => api.signOut(t),
  });
  const session = await store.signIn({
    chainId: 31337,
    wallet: member.account.address,
    origin: "http://localhost:3100",
    sign: (message) => member.account.signMessage({ message }),
  });

  return { store, session };
}
