// The API session: sign-in with Ethereum, then a bearer token. The token lives in memory and in
// sessionStorage, so a reload in the same tab keeps it and closing the tab ends it. Only off-chain writes need it
// (layout, read state); every read works signed out, so sign-in is asked for only on the first write.

import type { Address, Hex } from "viem";

import { useSyncExternalStore } from "react";
import { isAddressEqual } from "viem";
import { createSiweMessage } from "viem/siwe";
import { z } from "zod";

import { api } from "./client";

export interface ApiSession {
  readonly chainId: number;
  readonly wallet: Address;
  readonly token: string;
  /** Unix milliseconds. */
  readonly expiresAt: number;
}

export interface SignInParams {
  readonly chainId: number;
  readonly wallet: Address;
  /** The web origin the API binds sign-in to, `window.location.origin` in the app. */
  readonly origin: string;
  /** Signs the EIP-4361 message with the wallet (wagmi `signMessage`). */
  readonly sign: (message: string) => Promise<Hex>;
}

interface SessionDeps {
  readonly storage: () => Storage | undefined;
  readonly now: () => number;
  /** A fresh nonce, and when the API lets it expire (its own clock plus `API_NONCE_TTL_MS`). */
  readonly nonce: () => Promise<{
    readonly nonce: string;
    readonly expiresAt: string;
  }>;
  readonly verify: (
    message: string,
    signature: Hex,
  ) => Promise<{
    readonly token: string;
    readonly wallet: Address;
    readonly expiresAt: string;
  }>;
  readonly revoke: (token: string) => Promise<unknown>;
}

const STORAGE_PREFIX = "zal.api-session.v1:";
/** Treat a session as over a little early, so a write never races its expiry. */
const EXPIRY_MARGIN_MS = 30_000;
/** The validity window the wallet signs; the API caps the session at it. */
const SIGNED_TTL_MS = 60 * 60 * 1000;

/**
 * How long the API keeps a sign-in nonce (the indexer's `nonceTtlSeconds`). The nonce's `expiresAt` minus this is
 * the API's clock when it answered, which dates the message: the API refuses one issued more than 60 s ahead of its
 * clock, so a visitor whose clock runs fast could otherwise never sign in. `asOf.updatedAt` is no substitute: it is
 * the indexed block's time, which on a dev chain can be months away from the wall clock.
 */
export const API_NONCE_TTL_MS = 10 * 60 * 1000;

const storedSchema = z.object({
  chainId: z.number().int(),
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  token: z.string().min(1),
  expiresAt: z.number(),
});

/** The sign-in message: domain and URI are the web origin, so the API can check the binding (EIP-4361). */
export function signInMessage({
  chainId,
  wallet,
  origin,
  nonce,
  now,
}: {
  readonly chainId: number;
  readonly wallet: Address;
  readonly origin: string;
  readonly nonce: string;
  readonly now: number;
}): string {
  const url = new URL(origin);

  return createSiweMessage({
    domain: url.host,
    uri: url.origin,
    address: wallet,
    chainId,
    nonce,
    version: "1",
    statement: "Sign in to Zal to save your canvas layout and read state.",
    issuedAt: new Date(now),
    expirationTime: new Date(now + SIGNED_TTL_MS),
  });
}

export function createSessionStore(deps: SessionDeps) {
  const memory = new Map<number, ApiSession>();
  const pending = new Map<number, Promise<ApiSession>>();
  const listeners = new Set<() => void>();
  const key = (chainId: number) => `${STORAGE_PREFIX}${chainId}`;
  const notify = () => {
    for (const listener of listeners) listener();
  };

  function load(chainId: number): ApiSession | undefined {
    if (memory.has(chainId)) return memory.get(chainId);
    try {
      const text = deps.storage()?.getItem(key(chainId));

      if (text === null || text === undefined) return undefined;
      const parsed = storedSchema.safeParse(JSON.parse(text));

      if (!parsed.success) return undefined;
      const session = { ...parsed.data, wallet: parsed.data.wallet as Address };

      memory.set(chainId, session);

      return session;
    } catch {
      return undefined;
    }
  }

  function store(chainId: number, session: ApiSession | undefined): void {
    if (session === undefined) memory.delete(chainId);
    else memory.set(chainId, session);
    try {
      if (session === undefined) deps.storage()?.removeItem(key(chainId));
      else deps.storage()?.setItem(key(chainId), JSON.stringify(session));
    } catch {
      // Storage blocked: the session lasts for this page.
    }
    notify();
  }

  /** The live session of `wallet` on `chainId`, or undefined when there is none, it expired, or it is another wallet's. */
  function get(
    chainId: number,
    wallet: Address | undefined,
  ): ApiSession | undefined {
    const session = load(chainId);

    if (session === undefined || wallet === undefined) return undefined;
    if (!isAddressEqual(session.wallet, wallet)) return undefined;
    if (session.expiresAt - EXPIRY_MARGIN_MS <= deps.now()) return undefined;

    return session;
  }

  /** Signs in once per chain at a time: a second call while one is pending waits for the same signature. */
  function signIn(params: SignInParams): Promise<ApiSession> {
    const current = get(params.chainId, params.wallet);

    if (current !== undefined) return Promise.resolve(current);
    const running = pending.get(params.chainId);

    if (running !== undefined) return running;
    const attempt = (async () => {
      const { nonce, expiresAt } = await deps.nonce();
      const apiNow = Date.parse(expiresAt) - API_NONCE_TTL_MS;
      const message = signInMessage({
        ...params,
        nonce,
        now: Number.isNaN(apiNow) ? deps.now() : apiNow,
      });
      const signature = await params.sign(message);
      const verified = await deps.verify(message, signature);
      const session: ApiSession = {
        chainId: params.chainId,
        wallet: verified.wallet,
        token: verified.token,
        expiresAt: Date.parse(verified.expiresAt),
      };

      store(params.chainId, session);

      return session;
    })().finally(() => {
      pending.delete(params.chainId);
      notify();
    });

    pending.set(params.chainId, attempt);
    notify();

    return attempt;
  }

  /** Forgets the session locally, after the API rejected it (401). */
  function drop(chainId: number): void {
    if (load(chainId) !== undefined) store(chainId, undefined);
  }

  async function signOut(chainId: number): Promise<void> {
    const session = load(chainId);

    store(chainId, undefined);
    if (session !== undefined)
      await deps.revoke(session.token).catch(() => undefined);
  }

  return {
    get,
    signIn,
    signOut,
    drop,
    isSigningIn: (chainId: number) => pending.has(chainId),
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;

export const apiSessions: SessionStore = createSessionStore({
  storage: () => {
    try {
      return typeof window === "undefined" ? undefined : window.sessionStorage;
    } catch {
      return undefined;
    }
  },
  now: () => Date.now(),
  nonce: () => api.nonce(),
  verify: (message, signature) => api.verify(message, signature),
  revoke: (token) => api.signOut(token),
});

export type ApiSessionState =
  | { readonly status: "signedOut" }
  | { readonly status: "signingIn" }
  | { readonly status: "signedIn"; readonly session: ApiSession };

/** The wallet's API session on `chainId`, re-rendering on sign-in, sign-out and a rejected token. */
export function useApiSession(
  chainId: number | undefined,
  wallet: Address | undefined,
): ApiSessionState {
  const snapshot = () => {
    if (chainId === undefined) return "out";
    const session = apiSessions.get(chainId, wallet);

    if (session !== undefined) return session.token;

    return apiSessions.isSigningIn(chainId) ? "pending" : "out";
  };
  const token = useSyncExternalStore(
    apiSessions.subscribe,
    snapshot,
    () => "out",
  );

  if (token === "out" || chainId === undefined) return { status: "signedOut" };
  if (token === "pending") return { status: "signingIn" };
  const session = apiSessions.get(chainId, wallet);

  return session === undefined
    ? { status: "signedOut" }
    : { status: "signedIn", session };
}
