// The gas faucet: a fresh wallet holds no native token, so it cannot pay for its first transaction (minting zUSDC,
// creating its canvas). POST /v1/faucet sends it a small drip from a dedicated faucet wallet.

import type { Context, Hono } from "hono";
import type { AppDb } from "./app-db/client.ts";
import type { AsOf } from "./checkpoint.ts";
import type { RateLimiter } from "./rate-limit.ts";

import { and, asc, eq, gt, sql } from "drizzle-orm";
import { type Address, type Hash } from "viem";
import { z } from "zod";

import { faucetDrips } from "./app-db/schema.ts";
import { toWire } from "./canvas.ts";
import { ApiError, parseInput } from "./errors.ts";
import { createRateLimiter } from "./rate-limit.ts";

export const DRIP_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DRIPS_PER_WALLET = 1;
export const DRIPS_PER_IP = 5;

/** The faucet wallet on the chain. Its private key stays inside `send`. */
export interface Faucet {
  /** The faucet wallet's public address. */
  readonly address: Address;
  readonly dripWei: bigint;
  /** A wallet at or above this native balance gets no drip. */
  readonly minBalanceWei: bigint;
  readonly balanceOf: (wallet: Address) => Promise<bigint>;
  /** Sends `valueWei` of the native token and resolves once the node accepted it. The routes call it one at a time. */
  readonly send: (to: Address, valueWei: bigint) => Promise<Hash>;
}

export interface FaucetRouteDeps {
  readonly chainId: number;
  readonly appDb: AppDb;
  /** Undefined when no faucet key is configured. */
  readonly faucet: Faucet | undefined;
  readonly asOf: () => Promise<AsOf>;
  readonly clientIp: (c: Context) => string;
  readonly now: () => Date;
  readonly readJson: (c: Context) => Promise<unknown>;
  readonly throttle: (limiter: RateLimiter, key: string) => void;
}

const dripBody = z.strictObject({
  wallet: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "not an address")
    .transform((a) => a.toLowerCase() as Address),
});

/** Runs one task at a time, in call order, so two drips never pick the same nonce. */
function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

const retryAfter = (oldest: Date, now: Date) =>
  String(Math.max(1, Math.ceil((oldest.getTime() + DRIP_WINDOW_MS - now.getTime()) / 1000)));

export function registerFaucetRoutes<E extends { Variables: object }>(app: Hono<E>, deps: FaucetRouteDeps): void {
  const { chainId, appDb: db, faucet } = deps;
  const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
  const serial = createSerialQueue();

  const requireFaucet = (): Faucet => {
    if (faucet === undefined) throw new ApiError("unavailable", "The faucet is not configured");
    return faucet;
  };

  /**
   * Records a drip unless the wallet or the IP is over its limit. The transaction-scoped advisory lock makes the
   * count and the insert one step across concurrent requests and API processes.
   */
  const claim = (wallet: Address, ip: string, amountWei: bigint) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('zal_app.faucet_drips'))`);
      const now = deps.now();
      const since = new Date(now.getTime() - DRIP_WINDOW_MS);
      const recent = (column: typeof faucetDrips.wallet | typeof faucetDrips.ip, value: string) =>
        tx
          .select({ createdAt: faucetDrips.createdAt })
          .from(faucetDrips)
          .where(and(eq(faucetDrips.chainId, chainId), eq(column, value), gt(faucetDrips.createdAt, since)))
          .orderBy(asc(faucetDrips.createdAt));
      const [byWallet, byIp] = await Promise.all([recent(faucetDrips.wallet, wallet), recent(faucetDrips.ip, ip)]);
      if (byWallet.length >= DRIPS_PER_WALLET) {
        throw new ApiError("rate_limited", "This wallet got gas in the last 24 h", undefined, {
          "Retry-After": retryAfter(byWallet[0]!.createdAt, now),
        });
      }
      if (byIp.length >= DRIPS_PER_IP) {
        throw new ApiError("rate_limited", `At most ${DRIPS_PER_IP} drips per IP in 24 h`, undefined, {
          "Retry-After": retryAfter(byIp[0]!.createdAt, now),
        });
      }
      const [row] = await tx
        .insert(faucetDrips)
        .values({ chainId, wallet, ip, amountWei: amountWei.toString(), createdAt: now })
        .returning({ id: faucetDrips.id });
      return row!.id;
    });

  app.get("/v1/faucet", async (c) => {
    const asOf = await deps.asOf();
    if (faucet === undefined) {
      return c.json(
        toWire({ asOf, enabled: false, address: null, dripWei: null, minBalanceWei: null, faucetBalanceWei: null }) as Record<
          string,
          unknown
        >,
      );
    }
    return c.json(
      toWire({
        asOf,
        enabled: true,
        address: faucet.address,
        dripWei: faucet.dripWei,
        minBalanceWei: faucet.minBalanceWei,
        faucetBalanceWei: await faucet.balanceOf(faucet.address),
      }) as Record<string, unknown>,
    );
  });

  app.post("/v1/faucet", async (c) => {
    const ip = deps.clientIp(c);
    deps.throttle(limiter, `ip:${ip}`);
    const source = requireFaucet();
    const { wallet } = parseInput(dripBody, await deps.readJson(c));
    const asOf = await deps.asOf();
    if ((await source.balanceOf(wallet)) >= source.minBalanceWei) {
      throw new ApiError("conflict", "This wallet already has gas");
    }
    const id = await claim(wallet, ip, source.dripWei);
    let txHash: Hash;
    try {
      txHash = await serial(() => source.send(wallet, source.dripWei));
    } catch (err) {
      await db.delete(faucetDrips).where(eq(faucetDrips.id, id));
      console.error("faucet send failed", err instanceof Error ? err.message : err);
      throw new ApiError("unavailable", "The faucet could not send. Try again later");
    }
    await db.update(faucetDrips).set({ txHash }).where(eq(faucetDrips.id, id));
    return c.json(toWire({ asOf, txHash, amountWei: source.dripWei }) as Record<string, unknown>, 201);
  });
}
