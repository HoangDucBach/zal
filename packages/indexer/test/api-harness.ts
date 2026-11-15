// A /v1 app over PGlite with the real zal_app migrations, a fake chain (roles by account and wallet), and real
// signatures from viem's local accounts.

import type { ApiDeps, WalletAccountRow } from "../lib/app.ts";

import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { verifyMessage, type Address } from "viem";
import { createSiweMessage } from "viem/siwe";

import * as schema from "../lib/app-db/schema.ts";
import { createApp } from "../lib/app.ts";

export const CHAIN_ID = 31337;
/** Two allowed origins, as the local stack sets them: the docker web and a `next dev` server. */
export const WEB_ORIGINS = ["http://localhost:3100", "http://localhost:3001"] as const;
export const WEB_ORIGIN = WEB_ORIGINS[0];
export const REGISTRY: Address = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0";

/** A member row: its role, or the role with where the switcher orders it (default: not acted, block 1). */
export type MemberFixture = number | { role: number; acted: boolean; activeBlock: number; activeLogIndex?: number };

const rowOf = (account: string, fixture: MemberFixture): WalletAccountRow => {
  const m = typeof fixture === "number" ? { role: fixture, acted: false, activeBlock: 1 } : fixture;
  return {
    account: account as Address,
    role: m.role,
    acted: m.acted,
    activeBlock: BigInt(m.activeBlock),
    activeLogIndex: m.activeLogIndex ?? 0,
  };
};

/** The order readWalletAccounts sorts in SQL: every key descending. */
const sortKey = (r: Omit<WalletAccountRow, "role">) =>
  [r.acted ? 1 : 0, r.activeBlock, r.activeLogIndex, r.account.toLowerCase()] as const;
const compareDesc = (a: Omit<WalletAccountRow, "role">, b: Omit<WalletAccountRow, "role">) => {
  const [x, y] = [sortKey(a), sortKey(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! > y[i]! ? -1 : 1;
  return 0;
};

export async function createHarness(roles: Record<string, Record<string, MemberFixture>> = {}) {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: join(import.meta.dirname, "..", "drizzle"), migrationsSchema: "zal_app" });

  /** `<proposer>:<nonce>` pairs the fake chain reports as consumed by acceptInvite. */
  const usedInviteNonces = new Set<string>();
  const deps: ApiDeps = {
    config: { chainId: CHAIN_ID, webOrigins: WEB_ORIGINS, registry: REGISTRY, sessionTtlSeconds: 3600, nonceTtlSeconds: 600 },
    appDb: db,
    asOf: () => Promise.resolve({ block: 7, updatedAt: 1_700_000_000 }),
    canvasRows: () => Promise.reject(new Error("not used")),
    feedPage: () => Promise.resolve([]),
    walletAccounts: (wallet, page) =>
      Promise.resolve(
        Object.entries(roles)
          .flatMap(([account, byWallet]) => {
            const fixture = byWallet[wallet.toLowerCase()];
            return fixture === undefined ? [] : [rowOf(account, fixture)];
          })
          .filter((r) => r.role > 0)
          .filter((r) => page.acted === undefined || r.acted === page.acted)
          .filter((r) => page.query === undefined || r.account.toLowerCase().includes(page.query))
          .filter((r) => page.after === undefined || compareDesc(r, page.after) > 0)
          .sort(compareDesc)
          .slice(0, page.limit),
      ),
    pool: () => Promise.resolve({}),
    lp: () => Promise.resolve({}),
    roleOf: (account, wallet) => {
      const fixture = roles[account.toLowerCase()]?.[wallet.toLowerCase()];
      return Promise.resolve(fixture === undefined ? 0 : rowOf(account, fixture).role);
    },
    inviteNonceUsed: (proposer, nonce) => Promise.resolve(usedInviteNonces.has(`${proposer.toLowerCase()}:${nonce}`)),
    verifyMessage: (args) => verifyMessage(args),
    stream: () => Promise.reject(new Error("not used")),
    clientIp: () => "127.0.0.1",
  };
  const app = createApp(deps);

  const request = (method: string, path: string, body?: unknown, token?: string) =>
    app.request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: WEB_ORIGIN,
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  /** A SIWE message for the wallet over a fresh nonce, as the web would build it. */
  async function signIn(
    signer: { address: Address; signMessage: (a: { message: string }) => Promise<`0x${string}`> },
    overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {},
  ) {
    const nonceRes = await request("POST", "/v1/auth/nonce");
    const { nonce } = (await nonceRes.json()) as { nonce: string };
    const message = createSiweMessage({
      address: signer.address,
      chainId: CHAIN_ID,
      domain: new URL(WEB_ORIGIN).host,
      nonce,
      uri: WEB_ORIGIN,
      version: "1",
      issuedAt: new Date(),
      ...overrides,
    });
    const signature = await signer.signMessage({ message });
    return { message, signature };
  }

  async function sessionFor(signer: Parameters<typeof signIn>[0]): Promise<string> {
    const res = await request("POST", "/v1/auth/verify", await signIn(signer));
    if (res.status !== 201) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { token: string }).token;
  }

  return { app, db, pg, request, signIn, sessionFor, usedInviteNonces };
}

