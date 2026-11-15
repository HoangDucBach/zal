// The keeper's whole HTTP surface: health for the container check and status for an operator. Neither moves funds.

import type { Address } from "viem";
import type { Keeper } from "./keeper.ts";

import { Hono } from "hono";
import { cors } from "hono/cors";

export interface HttpDeps {
  readonly keeper: Keeper;
  readonly address: Address;
  readonly gasBalance: () => Promise<bigint>;
  readonly tickMs: number;
  /** Origins whose pages may read the responses. */
  readonly webOrigins: readonly string[];
  readonly now: () => number;
}

/** The loop is alive while a tick finished within this many tick periods; a send waits up to a minute. */
const STALE_TICKS = 3;
const SEND_ALLOWANCE_MS = 60_000;

const toJson = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));

export function createHttp({ keeper, address, gasBalance, tickMs, webOrigins, now }: HttpDeps) {
  const app = new Hono();
  app.use("*", cors({ origin: [...webOrigins], allowMethods: ["GET"] }));
  const startedAt = now();

  app.get("/health", async (c) => {
    const { lastTick, counts } = keeper.snapshot();
    const reference = lastTick?.finishedAt ?? startedAt;
    const ok = now() - reference <= STALE_TICKS * tickMs + SEND_ALLOWANCE_MS;
    const balance = await gasBalance().catch(() => undefined);
    return c.json(
      toJson({
        ok,
        keeper: address.toLowerCase(),
        gasBalanceWei: balance ?? null,
        lastTick: lastTick ?? null,
        counts,
      }) as Record<string, unknown>,
      ok ? 200 : 503,
    );
  });

  app.get("/status", (c) => {
    const { runs, failures, counts, lastTick } = keeper.snapshot();
    return c.json(toJson({ keeper: address.toLowerCase(), lastTick: lastTick ?? null, counts, runs, failures }) as Record<string, unknown>);
  });

  return app;
}
