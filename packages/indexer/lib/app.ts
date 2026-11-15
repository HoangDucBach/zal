// The /v1 REST surface (ADR 0012). Built from injected reads, so the routes and the auth rules run in tests
// without Ponder or a chain. src/api/index.ts wires in Ponder's database and RPC client.

import type { Context, MiddlewareHandler } from "hono";
import type { AppDb } from "./app-db/client.ts";
import type { CanvasRows, FeedRow, ScheduleRow } from "./canvas.ts";
import type { AsOf } from "./checkpoint.ts";
import type { Faucet } from "./faucet.ts";
import type { FeedCursor } from "./feed-channel.ts";
import type { RateLimiter } from "./rate-limit.ts";

import { randomBytes } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";

import { authNonces, invites, layouts, notificationReads, sessions } from "./app-db/schema.ts";
import { assembleCanvas, toActivity, toWire } from "./canvas.ts";
import { ApiError, parseInput } from "./errors.ts";
import { registerFaucetRoutes } from "./faucet.ts";
import { encodeNotice, FEED_CHANNEL, formatCursor, parseCursor } from "./feed-channel.ts";
import { inviteBodySchema, newInviteId, recoverInviteSigner } from "./invite.ts";
import { LAYOUT_MAX_BYTES, layoutSchema } from "./layout.ts";
import { deriveNotifications } from "./notifications.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { checkSiweMessage, hashToken, newSessionToken } from "./siwe.ts";
import { canWriteLayout } from "./web-mirror/layout-access.ts";
import { MEMBER_ROLES } from "./web-mirror/types.ts";

/** CanvasAccount.MemberRole. */
const ADMIN = 3;
const SMALL_BODY_BYTES = 64 * 1024;
/** zal_app.layouts.revision is an int4. */
const MAX_REVISION = 2_147_483_647;
const MAX_READ_KEYS_PER_WALLET = 5_000;

export interface ApiConfig {
  readonly chainId: number;
  /**
   * The web origins a SIWE message may name. Ponder's server answers CORS with `*`, which grants nothing here:
   * sessions are bearer tokens the web sends explicitly, never cookies.
   */
  readonly webOrigins: readonly string[];
  readonly registry: Address;
  readonly sessionTtlSeconds: number;
  readonly nonceTtlSeconds: number;
}

/** Where one member row sits in the switcher's order; also the cursor of the page that ends at it. */
export interface WalletAccountRow {
  readonly account: Address;
  readonly role: number;
  /** The wallet sent a transaction that emitted an event of this account. */
  readonly acted: boolean;
  readonly activeBlock: bigint;
  readonly activeLogIndex: number;
}

export interface WalletAccountsPage {
  readonly limit: number;
  readonly after?: Omit<WalletAccountRow, "role">;
  /** Only accounts the wallet acted on (true) or was only added to (false). */
  readonly acted?: boolean;
  /** Lowercase hex the account address contains. */
  readonly query?: string;
}

/** A schedule the keeper may run: an active row and the account that holds it. */
export interface DueScheduleRow extends ScheduleRow {
  readonly account: Address;
}

/** Everything the routes need from the indexed tables and the chain. */
export interface ApiDeps {
  readonly config: ApiConfig;
  readonly appDb: AppDb;
  readonly asOf: () => Promise<AsOf>;
  readonly canvasRows: (account: Address, wallet: Address, asOf: AsOf) => Promise<CanvasRows>;
  readonly feedPage: (subject: Address, before: FeedCursor | undefined, limit: number) => Promise<readonly FeedRow[]>;
  /**
   * The accounts where the wallet holds a role other than None, from MemberSet: acted-on first, then newest activity
   * first, ties by account descending. At most `page.limit` rows, all strictly after `page.after` in that order.
   */
  readonly walletAccounts: (wallet: Address, page: WalletAccountsPage) => Promise<readonly WalletAccountRow[]>;
  /** Active schedules with `nextAt <= before`, earliest first, ties by account and id. At most `limit` rows. */
  readonly dueSchedules: (before: bigint, limit: number) => Promise<readonly DueScheduleRow[]>;
  readonly pool: () => Promise<unknown>;
  readonly lp: (wallet: Address, asOf: AsOf) => Promise<unknown>;
  /** 0 for a wallet that is not a member, and for an address that is not a Zal account. Read at the chain head. */
  readonly roleOf: (account: Address, wallet: Address) => Promise<number>;
  /** RelationshipRegistry.inviteNonceUsed: true once acceptInvite has consumed the proposer's nonce. */
  readonly inviteNonceUsed: (proposer: Address, nonce: bigint) => Promise<boolean>;
  /** EOA signatures, plus ERC-1271 and ERC-6492 smart wallets in the service. */
  readonly verifyMessage: (args: { address: Address; message: string; signature: Hex }) => Promise<boolean>;
  readonly stream: (c: Context, account: Address, client: string) => Promise<Response>;
  /** The caller's IP, for rate limits and stream caps. */
  readonly clientIp: (c: Context) => string;
  /** The gas faucet; undefined when no faucet key is configured, and POST /v1/faucet answers 503. */
  readonly faucet?: Faucet;
  readonly now?: () => Date;
}

type Env = { Variables: { wallet: Address } };

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "not an address")
  .transform((a) => a.toLowerCase() as Address);
const cursorSchema = z.string().transform((text, ctx) => {
  const cursor = parseCursor(text);
  if (cursor === undefined) {
    ctx.addIssue({ code: "custom", message: "not a cursor (<block>-<logIndex>)" });
    return z.NEVER;
  }
  return cursor;
});
const walletQuery = z.object({ wallet: addressSchema.default(zeroAddress) });
/** `<acted 0|1>-<block>-<logIndex>-<account>`, the last row of the previous page. */
const accountsCursorSchema = z
  .string()
  .regex(/^[01]-\d{1,20}-\d{1,9}-0x[0-9a-f]{40}$/, "not a cursor (<acted>-<block>-<logIndex>-<account>)")
  .transform((text) => {
    const [acted, block, logIndex, account] = text.split("-");
    return { acted: acted === "1", activeBlock: BigInt(block!), activeLogIndex: Number(logIndex), account: account as Address };
  });
const formatAccountsCursor = (row: WalletAccountRow) =>
  `${row.acted ? 1 : 0}-${row.activeBlock}-${row.activeLogIndex}-${row.account.toLowerCase()}`;
const walletAccountsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: accountsCursorSchema.optional(),
  acted: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  /** Part of an account address: hex, with or without `0x`. */
  q: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{1,40}$/, "not part of an address")
    .transform((q) => q.toLowerCase().replace(/^0x/, ""))
    .optional(),
});
const activityQuery = z.object({
  before: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const dueSchedulesQuery = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  /** Unix seconds. Defaults to the time of the indexed head. */
  before: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const verifyBody = z.strictObject({
  message: z.string().min(1).max(4_000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "not a hex signature").transform((s) => s as Hex),
});
const layoutBody = z.strictObject({
  layout: layoutSchema,
  /** The revision the client edited, 0 when it started from no saved layout. Omit to overwrite. */
  revision: z.number().int().nonnegative().max(MAX_REVISION).optional(),
});
const readBody = z.strictObject({
  keys: z
    .array(z.string().regex(/^0x[0-9a-fA-F]{64}:\d{1,9}$/, "not a notification key"))
    .min(1)
    .max(500),
});

const json = async (c: Context): Promise<unknown> => {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError("bad_request", "The body is not JSON");
  }
};

export const throttle = (limiter: RateLimiter, key: string) => {
  const wait = limiter.hit(key);
  if (wait > 0) {
    throw new ApiError("rate_limited", `Too many requests. Retry in ${wait}s`, undefined, { "Retry-After": String(wait) });
  }
};

export function createApp(deps: ApiDeps): Hono<Env> {
  const { config, appDb: db } = deps;
  const now = deps.now ?? (() => new Date());
  const authLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
  const inviteLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
  const writeLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

  /** Writes read `asOf` before they commit, so a failed read never reports an error for a stored change. */
  const ok = (c: Context, asOf: AsOf, body: Record<string, unknown>, status: 200 | 201 = 200) =>
    c.json(toWire({ asOf, ...body }) as Record<string, unknown>, status);

  const requireSession = async (c: Context<Env>, next: () => Promise<void>) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") === true ? header.slice(7).trim() : undefined;
    if (token === undefined || token === "") throw new ApiError("unauthorized", "Sign in first");
    const [session] = await db
      .select({ wallet: sessions.wallet })
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          eq(sessions.chainId, config.chainId),
          gt(sessions.expiresAt, now()),
        ),
      );
    if (session === undefined) throw new ApiError("unauthorized", "The session is unknown or expired");
    c.set("wallet", session.wallet as Address);
    await next();
  };

  const app = new Hono<Env>();

  // Ponder's server sets no body limit. Only a layout may be large.
  const smallBodies: MiddlewareHandler<Env> = bodyLimit({
    maxSize: SMALL_BODY_BYTES,
    onError: () => {
      throw new ApiError("payload_too_large", `A request body is at most ${SMALL_BODY_BYTES} bytes`);
    },
  });
  app.use("/v1/*", (c: Context<Env, string>, next) => (c.req.path.endsWith("/layout") ? next() : smallBodies(c, next)));

  app.onError((err, c) => {
    const error = err instanceof ApiError ? err : new ApiError("internal", "Internal error");
    if (!(err instanceof ApiError)) console.error(err);
    return c.body(JSON.stringify(error.toProblem(c.req.path)), error.status, {
      ...error.headers,
      "Content-Type": "application/problem+json",
    });
  });
  app.notFound((c) => {
    const error = new ApiError("not_found", "No such route");
    return c.body(JSON.stringify(error.toProblem(c.req.path)), 404, { "Content-Type": "application/problem+json" });
  });

  // ---- Reads -------------------------------------------------------------------------------------------------

  const accountParam = (c: Context) => parseInput(addressSchema, c.req.param("address"));

  app.get("/v1/accounts/:address/canvas", async (c) => {
    const account = accountParam(c);
    const { wallet } = parseInput(walletQuery, c.req.query());
    const asOf = await deps.asOf();
    const [rows, [saved]] = await Promise.all([
      deps.canvasRows(account, wallet, asOf),
      db
        .select()
        .from(layouts)
        .where(and(eq(layouts.chainId, config.chainId), eq(layouts.account, account))),
    ]);
    return c.json(
      toWire({
        asOf,
        canvas: assembleCanvas(rows),
        layout:
          saved === undefined
            ? null
            : {
                layout: saved.layout,
                revision: saved.revision,
                updatedAt: saved.updatedAt.toISOString(),
                updatedBy: saved.updatedBy,
              },
      }) as Record<string, unknown>,
    );
  });

  app.get("/v1/accounts/:address/activity", async (c) => {
    const account = accountParam(c);
    const { before, limit } = parseInput(activityQuery, c.req.query());
    const rows = await deps.feedPage(account, before, limit);
    const last = rows.at(-1);
    return ok(c, await deps.asOf(), {
      items: toActivity(rows).reverse(),
      nextCursor: rows.length === limit && last !== undefined ? formatCursor(last) : null,
    });
  });

  app.get("/v1/accounts/:address/notifications", async (c) => {
    const account = accountParam(c);
    const { wallet } = parseInput(walletQuery, c.req.query());
    const asOf = await deps.asOf();
    const rows = await deps.canvasRows(account, wallet, asOf);
    const feed = deriveNotifications(assembleCanvas(rows));
    const keys = feed.map((n) => n.key);
    const read =
      keys.length === 0 || wallet === zeroAddress
        ? []
        : await db
            .select({ key: notificationReads.key })
            .from(notificationReads)
            .where(
              and(
                eq(notificationReads.chainId, config.chainId),
                eq(notificationReads.wallet, wallet),
                inArray(notificationReads.key, keys),
              ),
            );
    const readKeys = new Set(read.map((r) => r.key));
    const notifications = feed.map((n) => ({ ...n, read: readKeys.has(n.key) }));
    return c.json(
      toWire({ asOf, notifications, unread: notifications.filter((n) => !n.read).length }) as Record<
        string,
        unknown
      >,
    );
  });

  app.get("/v1/wallets/:wallet/accounts", async (c) => {
    const wallet = parseInput(addressSchema, c.req.param("wallet"));
    const { limit, cursor, acted, q } = parseInput(walletAccountsQuery, c.req.query());
    const asOf = await deps.asOf();
    // One row past the page says whether another page follows.
    const rows = await deps.walletAccounts(wallet, {
      limit: limit + 1,
      ...(cursor === undefined ? {} : { after: cursor }),
      ...(acted === undefined ? {} : { acted }),
      ...(q === undefined || q === "" ? {} : { query: q }),
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return ok(c, asOf, {
      wallet,
      accounts: page.map((r) => ({ address: r.account.toLowerCase(), role: MEMBER_ROLES[r.role] ?? "none", acted: r.acted })),
      nextCursor: rows.length > limit && last !== undefined ? formatAccountsCursor(last) : null,
    });
  });

  app.get("/v1/pool", async (c) => {
    const { wallet } = parseInput(walletQuery, c.req.query());
    const asOf = await deps.asOf();
    const [pool, lp] = await Promise.all([
      deps.pool(),
      wallet === zeroAddress ? undefined : deps.lp(wallet, asOf),
    ]);
    return c.json(toWire({ asOf, pool, lp }) as Record<string, unknown>);
  });

  // The keeper's work list (ADR 0015). Running a schedule is permissionless, so this reveals nothing the chain
  // does not, and needs no session.
  app.get("/v1/schedules/due", async (c) => {
    const query = parseInput(dueSchedulesQuery, c.req.query());
    if (query.chainId !== undefined && query.chainId !== config.chainId) {
      throw new ApiError("not_found", `This API indexes chain ${config.chainId}, not ${query.chainId}`);
    }
    const asOf = await deps.asOf();
    const before = query.before ?? asOf.updatedAt;
    const rows = await deps.dueSchedules(BigInt(before), query.limit);
    return ok(c, asOf, {
      chainId: config.chainId,
      before,
      schedules: rows.map((r) => ({
        account: r.account,
        id: r.scheduleId,
        kind: r.kind === 0 ? "transfer" : "payInvoice",
        recipient: r.kind === 0 ? r.recipient : null,
        invoiceId: r.kind === 0 ? null : r.invoiceId,
        amount: r.amount,
        nextAt: Number(r.nextAt),
        interval: r.interval,
        remaining: r.remaining,
      })),
    });
  });

  app.get("/v1/stream", (c) => {
    const account = parseInput(addressSchema, c.req.query("account"));
    // Hono runs HEAD through this GET handler and drops the body, so nothing would ever read or close a stream.
    if (c.req.method === "HEAD") return c.body(null, 200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    return deps.stream(c, account, deps.clientIp(c));
  });

  // ---- Sign-in (EIP-4361), then a bearer session ------------------------------------------------------------

  app.post("/v1/auth/nonce", async (c) => {
    throttle(authLimiter, `ip:${deps.clientIp(c)}`);
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = new Date(now().getTime() + config.nonceTtlSeconds * 1000);
    // An expired nonce can no longer be claimed, used or not.
    await db.delete(authNonces).where(lte(authNonces.expiresAt, now()));
    await db.insert(authNonces).values({ nonce, chainId: config.chainId, expiresAt });
    return ok(c, await deps.asOf(), { nonce, expiresAt: expiresAt.toISOString() }, 201);
  });

  app.post("/v1/auth/verify", async (c) => {
    throttle(authLimiter, `ip:${deps.clientIp(c)}`);
    const body = parseInput(verifyBody, await json(c));
    const asOf = await deps.asOf();
    const message = checkSiweMessage(body.message, {
      origins: config.webOrigins,
      chainId: config.chainId,
      now: now(),
      maxAgeSeconds: config.nonceTtlSeconds,
    });
    const valid = await deps
      .verifyMessage({ address: message.address, message: body.message, signature: body.signature })
      .catch(() => false);
    if (!valid) throw new ApiError("unauthorized", "The signature does not match the address");
    // One UPDATE claims the nonce, so two requests with the same signed message cannot both succeed.
    const claimed = await db
      .update(authNonces)
      .set({ usedAt: now() })
      .where(
        and(
          eq(authNonces.nonce, message.nonce),
          eq(authNonces.chainId, config.chainId),
          isNull(authNonces.usedAt),
          gt(authNonces.expiresAt, now()),
        ),
      )
      .returning({ nonce: authNonces.nonce });
    if (claimed.length === 0) throw new ApiError("unauthorized", "The nonce is unknown, expired or already used");

    const wallet = message.address.toLowerCase() as Address;
    const { token, hash } = newSessionToken();
    const ttlEnd = now().getTime() + config.sessionTtlSeconds * 1000;
    // A session never outlives the expiry the wallet signed.
    const expiresAt = new Date(Math.min(ttlEnd, message.expirationTime?.getTime() ?? ttlEnd));
    await db.delete(sessions).where(lte(sessions.expiresAt, now()));
    await db.insert(sessions).values({ tokenHash: hash, chainId: config.chainId, wallet, expiresAt });
    return ok(c, asOf, { token, wallet, expiresAt: expiresAt.toISOString() }, 201);
  });

  app.get("/v1/auth/session", requireSession, async (c) => ok(c, await deps.asOf(), { wallet: c.get("wallet") }));

  app.delete("/v1/auth/session", requireSession, async (c) => {
    const token = c.req.header("Authorization")?.slice(7).trim() ?? "";
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    return c.body(null, 204);
  });

  // ---- Writes ------------------------------------------------------------------------------------------------

  app.put(
    "/v1/accounts/:address/layout",
    bodyLimit({
      maxSize: LAYOUT_MAX_BYTES,
      onError: () => {
        throw new ApiError("payload_too_large", `A layout is at most ${LAYOUT_MAX_BYTES} bytes`);
      },
    }),
    requireSession,
    async (c) => {
      const account = accountParam(c);
      const wallet = c.get("wallet");
      throttle(writeLimiter, `wallet:${wallet}`);
      const body = parseInput(layoutBody, await json(c));
      const asOf = await deps.asOf();
      if (!canWriteLayout(MEMBER_ROLES[await deps.roleOf(account, wallet)] ?? "none")) {
        throw new ApiError("forbidden", "Only an approver or admin of this account can change its layout");
      }
      const expected = body.revision;
      const returning = { revision: layouts.revision, updatedAt: layouts.updatedAt };
      // From a saved revision the row must still be at it; only revision 0 (or none) may create the row.
      const [written] = expected !== undefined && expected > 0
        ? await db
            .update(layouts)
            .set({ layout: body.layout, revision: sql`${layouts.revision} + 1`, updatedAt: sql`now()`, updatedBy: wallet })
            .where(and(eq(layouts.chainId, config.chainId), eq(layouts.account, account), eq(layouts.revision, expected)))
            .returning(returning)
        : await db
        .insert(layouts)
        .values({ chainId: config.chainId, account, layout: body.layout, updatedBy: wallet })
        .onConflictDoUpdate({
          target: [layouts.chainId, layouts.account],
          set: {
            layout: body.layout,
            revision: sql`${layouts.revision} + 1`,
            updatedAt: sql`now()`,
            updatedBy: wallet,
          },
          ...(expected === undefined ? {} : { setWhere: eq(layouts.revision, expected) }),
        })
        .returning(returning);
      if (written === undefined) {
        throw new ApiError("conflict", "The layout changed since you loaded it. Reload and apply your change again");
      }
      await db.execute(
        sql`select pg_notify(${FEED_CHANNEL}, ${encodeNotice({ kind: "layout", subject: account, revision: written.revision })})`,
      );
      return ok(c, asOf, {
        layout: { revision: written.revision, updatedAt: written.updatedAt.toISOString(), updatedBy: wallet },
      });
    },
  );

  app.post("/v1/notifications/read", requireSession, async (c) => {
    const wallet = c.get("wallet");
    throttle(writeLimiter, `wallet:${wallet}`);
    const { keys } = parseInput(readBody, await json(c));
    const asOf = await deps.asOf();
    const mine = and(eq(notificationReads.chainId, config.chainId), eq(notificationReads.wallet, wallet));
    await db
      .insert(notificationReads)
      .values(keys.map((key) => ({ chainId: config.chainId, wallet, key: key.toLowerCase() })))
      .onConflictDoNothing();
    // Keys are not checked against the feed, so a wallet keeps only its newest reads.
    await db.delete(notificationReads).where(
      and(
        mine,
        notInArray(
          notificationReads.key,
          db
            .select({ key: notificationReads.key })
            .from(notificationReads)
            .where(mine)
            .orderBy(desc(notificationReads.readAt), desc(notificationReads.key))
            .limit(MAX_READ_KEYS_PER_WALLET),
        ),
      ),
    );
    return ok(c, asOf, { read: keys.length });
  });

  app.post("/v1/invites", async (c) => {
    throttle(inviteLimiter, `ip:${deps.clientIp(c)}`);
    const body = parseInput(inviteBodySchema, await json(c));
    const asOf = await deps.asOf();
    if (body.deadline <= Math.floor(now().getTime() / 1000)) throw new ApiError("unprocessable", "The invite has expired");
    const signer = (await recoverInviteSigner(body, config.chainId, config.registry)).toLowerCase() as Address;
    // The same checks acceptInvite makes, so the API never hands out a link the chain would refuse.
    if ((await deps.roleOf(body.proposer, signer)) !== ADMIN) {
      throw new ApiError("forbidden", "The invite must be signed by an admin of the proposing account");
    }
    if (await deps.inviteNonceUsed(body.proposer, BigInt(body.nonce))) {
      throw new ApiError("conflict", "This invite's nonce is already used on-chain");
    }
    const id = newInviteId();
    const [row] = await db
      .insert(invites)
      .values({ id, chainId: config.chainId, ...body, signer })
      .onConflictDoNothing()
      .returning();
    if (row === undefined) throw new ApiError("conflict", "An invite with this nonce already exists for this account");
    c.header("Location", `/v1/invites/${row.id}`);
    return ok(c, asOf, { invite: inviteView(row, now()) }, 201);
  });

  app.get("/v1/invites/:id", async (c) => {
    const id = parseInput(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), c.req.param("id"));
    const [row] = await db
      .select()
      .from(invites)
      .where(and(eq(invites.id, id), eq(invites.chainId, config.chainId)));
    if (row === undefined) throw new ApiError("not_found", "No such invite");
    return ok(c, await deps.asOf(), { invite: inviteView(row, now()) });
  });

  registerFaucetRoutes(app, {
    chainId: config.chainId,
    appDb: db,
    faucet: deps.faucet,
    asOf: deps.asOf,
    clientIp: deps.clientIp,
    now,
    readJson: json,
    throttle,
  });

  return app;
}

const inviteView = (row: typeof invites.$inferSelect, now: Date) => ({
  id: row.id,
  proposer: row.proposer,
  proposerRole: row.proposerRole,
  inviteeEmailHash: row.inviteeEmailHash,
  nonce: row.nonce,
  deadline: row.deadline,
  signature: row.signature,
  signer: row.signer,
  createdAt: row.createdAt.toISOString(),
  expired: row.deadline <= Math.floor(now.getTime() / 1000),
});
