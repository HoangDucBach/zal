// /v1/explorer: public, read-only views of the ex_* tables (docs/plans/explorer.md). Every query is bounded: lists
// read at most `limit + 1` rows by an index in key order, details read by primary key, and totals come from the
// one-row ex_totals. Wire form: amounts and block numbers as decimal strings, times and counts as numbers.

import type { Context, Env, Hono, Next } from "hono";

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from "ponder";
import { db } from "ponder:api";
import schema from "ponder:schema";
import { z } from "zod";
import type { Address } from "viem";

import { throttle } from "../../lib/app.ts";
import { toWire } from "../../lib/canvas.ts";
import type { AsOf } from "../../lib/checkpoint.ts";
import { ApiError, parseInput } from "../../lib/errors.ts";
import { dayOf, TX_KINDS, type TxKind } from "../../lib/explorer/chain.ts";
import { decodeZalLog } from "../../lib/explorer/decode.ts";
import {
  CHART_RANGES,
  chartWindow,
  classifySearch,
  decodeCursor,
  encodeCursor,
  escapeLike,
  fillDays,
  MAX_SEARCH_LENGTH,
  type CursorPart,
} from "../../lib/explorer/wire.ts";
import { createRateLimiter } from "../../lib/rate-limit.ts";
import { config } from "./config.ts";
import { streamExplorer } from "./explorer-stream.ts";
import { readAsOf } from "./read.ts";

/** Per client IP, across every explorer route. A page load makes about ten requests. */
const READS_PER_MINUTE = 300;
const HOLDINGS_LIMIT = 100;
const SEARCH_LIMIT = 10;
const AVG_BLOCK_WINDOW = 100n;
const INVOICE_STATUS = ["", "issued", "approved", "paid", "rejected", "cancelled"] as const;

type TxRow = typeof schema.exTx.$inferSelect;
type BlockRow = typeof schema.exBlock.$inferSelect;
type TokenRow = typeof schema.exToken.$inferSelect;
type TransferRow = typeof schema.exTransfer.$inferSelect;

// ---- Input --------------------------------------------------------------------------------------------------------

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "not an address")
  .transform((a) => a.toLowerCase() as Address);
const hashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "not a transaction hash")
  .transform((h) => h.toLowerCase() as `0x${string}`);
const blockIdSchema = z.union([
  z
    .string()
    .regex(/^\d{1,20}$/)
    .transform((n) => ({ number: BigInt(n) })),
  hashSchema.transform((hash) => ({ hash })),
], { error: "not a block number or hash" });

const listQuery = (shape: readonly CursorPart[]) =>
  z.object({
    before: z
      .string()
      .transform((text, ctx) => {
        const parts = decodeCursor(text, shape);
        if (parts === undefined) {
          ctx.addIssue({ code: "custom", message: "not a cursor from this list" });
          return z.NEVER;
        }
        return parts;
      })
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
const blocksQuery = listQuery(["uint"]);
/** `block` narrows the list to one block, for a block page's further pages. */
const txsQuery = listQuery(["uint", "uint"]).extend({
  block: z.string().regex(/^\d{1,20}$/, "not a block number").transform(BigInt).optional(),
});
const positionQuery = listQuery(["uint", "uint"]);
const nftsQuery = listQuery(["address", "uint"]);
const rankQuery = listQuery(["uint", "address"]);
const searchQuery = z.object({ q: z.string().max(MAX_SEARCH_LENGTH * 2) });
const chartsQuery = z.object({ range: z.enum(CHART_RANGES).default("1m") });

// ---- Wire ---------------------------------------------------------------------------------------------------------

const blockSummary = (b: BlockRow) => ({
  number: b.number,
  hash: b.hash,
  timestamp: Number(b.timestamp),
  txCount: b.txCount,
  gasUsed: b.gasUsed,
});
const blockDetail = (b: BlockRow) => ({
  ...blockSummary(b),
  parentHash: b.parentHash,
  gasLimit: b.gasLimit,
  baseFeePerGas: b.baseFeePerGas,
  miner: b.miner,
});
const txSummary = (t: TxRow) => ({
  hash: t.hash,
  blockNumber: t.blockNumber,
  timestamp: Number(t.timestamp),
  from: t.from,
  to: t.to,
  value: t.value,
  fee: t.fee,
  status: t.status,
  method: t.method,
  selector: t.selector,
  kind: t.kind,
});
const txDetail = (t: TxRow) => ({
  ...txSummary(t),
  index: t.index,
  gasUsed: t.gasUsed,
  effectiveGasPrice: t.effectiveGasPrice,
  contractCreated: t.contractCreated,
  input: t.input,
});
const tokenRef = (t: TokenRow) => ({ address: t.address, symbol: t.symbol, decimals: t.decimals, standard: t.standard });
const tokenView = (t: TokenRow) => ({
  address: t.address,
  standard: t.standard,
  name: t.name,
  symbol: t.symbol,
  decimals: t.decimals,
  totalSupply: t.totalSupply,
  holderCount: t.holderCount,
  transferCount: t.transferCount,
});
/** A token row that is missing (it cannot be, as transfers create it) still yields a usable reference. */
const unknownRef = (address: string) => ({ address, symbol: null, decimals: null, standard: "erc20" });

async function tokensByAddress(addresses: readonly string[]) {
  const unique = [...new Set(addresses)] as Address[];
  const rows = unique.length === 0 ? [] : await db.select().from(schema.exToken).where(inArray(schema.exToken.address, unique));
  return new Map(rows.map((t) => [t.address, t]));
}

async function transferViews(rows: readonly TransferRow[]) {
  const tokens = await tokensByAddress(rows.map((r) => r.token));
  return rows.map((r) => {
    const token = tokens.get(r.token);
    return {
      txHash: r.txHash,
      logIndex: r.logIndex,
      blockNumber: r.blockNumber,
      timestamp: Number(r.timestamp),
      token: token === undefined ? unknownRef(r.token) : tokenRef(token),
      from: r.from,
      to: r.to,
      value: r.value,
      tokenId: r.tokenId,
    };
  });
}

/** One page from `limit + 1` rows: `next` is the last item's key when another page follows. */
function page<T>(rows: readonly T[], limit: number, keyOf: (row: T) => readonly (string | number | bigint)[]) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, next: rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null };
}

/** Rows strictly before a `(block, position)` cursor, in a tuple comparison the composite indexes serve. */
const beforePosition = (block: unknown, position: unknown, cursor: readonly string[] | undefined) =>
  cursor === undefined ? undefined : sql`(${block}, ${position}) < (${BigInt(cursor[0]!)}, ${Number(cursor[1])})`;

/**
 * Newest first by `(blockNumber, position)`, from two indexed queries (one per column) of `limit + 1` rows each,
 * merged. One OR query would have to read every row of a busy address before sorting.
 */
function mergeNewest<T extends { blockNumber: bigint }>(
  a: readonly T[],
  b: readonly T[],
  position: (row: T) => number,
  identity: (row: T) => string,
  take: number,
): T[] {
  const seen = new Set<string>();
  return [...a, ...b]
    .sort((x, y) =>
      x.blockNumber === y.blockNumber ? position(y) - position(x) : x.blockNumber < y.blockNumber ? 1 : -1,
    )
    .filter((row) => {
      const id = identity(row);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, take);
}

// ---- Reads --------------------------------------------------------------------------------------------------------

async function requireAddress(address: Address) {
  const [row] = await db.select().from(schema.exAddress).where(eq(schema.exAddress.address, address));
  if (row === undefined) throw new ApiError("not_found", "No such address in the explorer");
  return row;
}

async function requireToken(address: Address) {
  const [row] = await db.select().from(schema.exToken).where(eq(schema.exToken.address, address));
  if (row === undefined) throw new ApiError("not_found", "No such token");
  return row;
}

async function readStats() {
  const b = schema.exBlock;
  const [[head], [totals], [usdc]] = await Promise.all([
    db.select().from(b).orderBy(desc(b.number)).limit(1),
    db.select().from(schema.exTotals).where(eq(schema.exTotals.id, 1)),
    db.select().from(schema.exToken).where(eq(schema.exToken.address, config.addresses.usdc)),
  ]);
  let avgBlockTimeSec: number | null = null;
  if (head !== undefined && head.number > 0n) {
    const floor = head.number > AVG_BLOCK_WINDOW ? head.number - AVG_BLOCK_WINDOW : 0n;
    const [first] = await db.select().from(b).where(gte(b.number, floor)).orderBy(asc(b.number)).limit(1);
    if (first !== undefined && first.number < head.number) {
      avgBlockTimeSec = Number(head.timestamp - first.timestamp) / Number(head.number - first.number);
    }
  }
  return {
    height: head?.number ?? 0n,
    totalTxs: Number(totals?.txCount ?? 0n),
    totalAddresses: Number(totals?.addressCount ?? 0n),
    totalContracts: Number(totals?.contractCount ?? 0n),
    avgBlockTimeSec: avgBlockTimeSec === null ? null : Math.round(avgBlockTimeSec * 100) / 100,
    baseFeePerGas: head?.baseFeePerGas ?? null,
    zusdcSupply: usdc?.totalSupply ?? 0n,
    canvases: Number(totals?.canvasCount ?? 0n),
  };
}

function readTxs(cursor: readonly string[] | undefined, take: number, block?: bigint) {
  const t = schema.exTx;
  return db
    .select()
    .from(t)
    .where(and(block === undefined ? undefined : eq(t.blockNumber, block), beforePosition(t.blockNumber, t.index, cursor)))
    .orderBy(desc(t.blockNumber), desc(t.index))
    .limit(take);
}

async function readAddressTxs(address: Address, cursor: readonly string[] | undefined, take: number) {
  const t = schema.exTx;
  const side = (column: typeof t.from | typeof t.to) =>
    db
      .select()
      .from(t)
      .where(and(eq(column, address), beforePosition(t.blockNumber, t.index, cursor)))
      .orderBy(desc(t.blockNumber), desc(t.index))
      .limit(take);
  const [sent, received] = await Promise.all([side(t.from), side(t.to)]);
  return mergeNewest(sent, received, (r) => r.index, (r) => r.hash, take);
}

async function readAddressTransfers(address: Address, cursor: readonly string[] | undefined, take: number) {
  const t = schema.exTransfer;
  const side = (column: typeof t.from | typeof t.to) =>
    db
      .select()
      .from(t)
      .where(and(eq(column, address), beforePosition(t.blockNumber, t.logIndex, cursor)))
      .orderBy(desc(t.blockNumber), desc(t.logIndex))
      .limit(take);
  const [sent, received] = await Promise.all([side(t.from), side(t.to)]);
  return mergeNewest(sent, received, (r) => r.logIndex, (r) => `${r.txHash}:${r.logIndex}`, take);
}

async function search(raw: string) {
  const query = classifySearch(raw);
  if (query === undefined) return [];
  switch (query.kind) {
    case "address": {
      const [[address], [token]] = await Promise.all([
        db.select().from(schema.exAddress).where(eq(schema.exAddress.address, query.address)),
        db.select().from(schema.exToken).where(eq(schema.exToken.address, query.address)),
      ]);
      return [
        ...(token === undefined ? [] : [{ type: "token", id: token.address, label: token.symbol ?? token.name }]),
        ...(address === undefined ? [] : [{ type: "address", id: address.address, label: address.label }]),
      ];
    }
    case "hash": {
      const [tx] = await db.select().from(schema.exTx).where(eq(schema.exTx.hash, query.hash));
      if (tx !== undefined) return [{ type: "tx", id: tx.hash, label: tx.method }];
      const [block] = await db.select().from(schema.exBlock).where(eq(schema.exBlock.hash, query.hash));
      return block === undefined ? [] : [{ type: "block", id: block.number.toString(), label: `Block ${block.number}` }];
    }
    case "block": {
      const [block] = await db.select().from(schema.exBlock).where(eq(schema.exBlock.number, query.number));
      return block === undefined ? [] : [{ type: "block", id: block.number.toString(), label: `Block ${block.number}` }];
    }
    case "invoice": {
      const [invoice] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, query.id));
      return invoice === undefined ? [] : [{ type: "invoice", id: invoice.id.toString(), label: `Invoice #${invoice.id}` }];
    }
    case "text": {
      const pattern = `${escapeLike(query.prefix)}%`;
      const tk = schema.exToken;
      // ex_token holds one row per token contract ever seen, a small table; the scan stops at SEARCH_LIMIT.
      const tokens = await db
        .select()
        .from(tk)
        .where(or(ilike(tk.symbol, pattern), ilike(tk.name, pattern)))
        .orderBy(desc(tk.transferCount), asc(tk.address))
        .limit(SEARCH_LIMIT);
      // Labels other than `Zal canvas` are the deployment's names, so only those few rows are matched.
      const deployment = Object.values(config.addresses);
      const labelled = await db
        .select()
        .from(schema.exAddress)
        .where(and(inArray(schema.exAddress.address, deployment), ilike(schema.exAddress.label, pattern)))
        .orderBy(asc(schema.exAddress.label))
        .limit(SEARCH_LIMIT);
      return [
        ...tokens.map((t) => ({ type: "token", id: t.address, label: t.symbol ?? t.name })),
        ...labelled.map((a) => ({ type: "address", id: a.address, label: a.label })),
      ].slice(0, SEARCH_LIMIT);
    }
  }
}

async function readCharts(range: (typeof CHART_RANGES)[number], asOf: AsOf) {
  const d = schema.exDaily;
  const lastDay = Math.max(dayOf(Math.floor(Date.now() / 1000)), dayOf(asOf.updatedAt));
  const [first] = await db.select({ day: d.day }).from(d).orderBy(asc(d.day)).limit(1);
  const window = chartWindow(range, lastDay, first?.day);
  const rows = await db.select().from(d).where(and(gte(d.day, window.from), lte(d.day, window.to))).orderBy(asc(d.day));
  const kinds: Record<TxKind, number> = { zal: 0, token: 0, native: 0, deploy: 0, other: 0 };
  for (const r of rows) {
    kinds.zal += r.zalTxs;
    kinds.token += r.tokenTxs;
    kinds.native += r.nativeTxs;
    kinds.deploy += r.deployTxs;
    kinds.other += r.otherTxs;
  }
  const days = fillDays(
    window,
    rows.map((r) => ({
      day: r.day,
      txCount: r.txCount,
      activeAddresses: r.activeAddresses,
      gasUsed: r.gasUsed,
      fees: r.fees,
      zusdcSettled: r.zusdcSettled,
      newAccounts: r.newAccounts,
    })),
    (day) => ({ day, txCount: 0, activeAddresses: 0, gasUsed: 0n, fees: 0n, zusdcSettled: 0n, newAccounts: 0 }),
  );
  return { days, kinds: TX_KINDS.map((kind) => ({ kind, count: kinds[kind] })) };
}

// ---- Routes -------------------------------------------------------------------------------------------------------

export function registerExplorerRoutes<E extends Env>(app: Hono<E>, { clientIp }: { clientIp: (c: Context<E>) => string }): void {
  const limiter = createRateLimiter({ limit: READS_PER_MINUTE, windowMs: 60_000 });
  const ok = (c: Context, asOf: AsOf, body: Record<string, unknown>) =>
    c.json(toWire({ asOf, ...body }) as Record<string, unknown>);
  const param = <T extends z.ZodType>(c: Context, name: string, schemaFor: T) => parseInput(schemaFor, c.req.param(name));

  app.use("/v1/explorer/*", async (c: Context<E>, next: Next) => {
    throttle(limiter, `ip:${clientIp(c)}`);
    await next();
  });

  app.get("/v1/explorer/stats", async (c) => {
    const asOf = await readAsOf();
    return ok(c, asOf, await readStats());
  });

  app.get("/v1/explorer/blocks", async (c) => {
    const { before, limit } = parseInput(blocksQuery, c.req.query());
    const asOf = await readAsOf();
    const b = schema.exBlock;
    const rows = await db
      .select()
      .from(b)
      .where(before === undefined ? undefined : sql`${b.number} < ${BigInt(before[0]!)}`)
      .orderBy(desc(b.number))
      .limit(limit + 1);
    const { items, next } = page(rows, limit, (r) => [r.number]);
    return ok(c, asOf, { items: items.map(blockSummary), next });
  });

  app.get("/v1/explorer/blocks/:id", async (c) => {
    const id = param(c, "id", blockIdSchema);
    const asOf = await readAsOf();
    const b = schema.exBlock;
    const [block] = await db
      .select()
      .from(b)
      .where("number" in id ? eq(b.number, id.number) : eq(b.hash, id.hash))
      .limit(1);
    if (block === undefined) throw new ApiError("not_found", "No such block");
    const limit = 25;
    const { items, next } = page(await readTxs(undefined, limit + 1, block.number), limit, (r) => [r.blockNumber, r.index]);
    return ok(c, asOf, { block: blockDetail(block), txs: items.map(txSummary), txsNext: next });
  });

  app.get("/v1/explorer/txs", async (c) => {
    const { before, limit, block } = parseInput(txsQuery, c.req.query());
    const asOf = await readAsOf();
    const { items, next } = page(await readTxs(before, limit + 1, block), limit, (r) => [r.blockNumber, r.index]);
    return ok(c, asOf, { items: items.map(txSummary), next });
  });

  app.get("/v1/explorer/txs/:hash", async (c) => {
    const hash = param(c, "hash", hashSchema);
    const asOf = await readAsOf();
    const [tx] = await db.select().from(schema.exTx).where(eq(schema.exTx.hash, hash));
    if (tx === undefined) throw new ApiError("not_found", "No such transaction");
    const [logs, transfers] = await Promise.all([
      db.select().from(schema.exLog).where(eq(schema.exLog.txHash, hash)).orderBy(asc(schema.exLog.logIndex)),
      db.select().from(schema.exTransfer).where(eq(schema.exTransfer.txHash, hash)).orderBy(asc(schema.exTransfer.logIndex)),
    ]);
    return ok(c, asOf, {
      tx: txDetail(tx),
      logs: logs.map((l) => ({
        logIndex: l.logIndex,
        address: l.address,
        topics: l.topics,
        data: l.data,
        decoded: decodeZalLog(l.topics, l.data),
      })),
      transfers: await transferViews(transfers),
    });
  });

  app.get("/v1/explorer/address/:address", async (c) => {
    const address = param(c, "address", addressSchema);
    const asOf = await readAsOf();
    const row = await requireAddress(address);
    const h = schema.exHolding;
    const [holdings, [nfts], [account]] = await Promise.all([
      db
        .select({ balance: h.balance, token: schema.exToken })
        .from(h)
        .innerJoin(schema.exToken, eq(schema.exToken.address, h.token))
        .where(eq(h.holder, address))
        .orderBy(asc(h.token))
        .limit(HOLDINGS_LIMIT),
      db.select({ n: count() }).from(schema.exNft).where(eq(schema.exNft.owner, address)),
      db.select({ admin: schema.account.admin }).from(schema.account).where(eq(schema.account.address, address)),
    ]);
    return ok(c, asOf, {
      address: row.address,
      isContract: row.isContract,
      label: row.label,
      txCount: row.txCount,
      firstSeenBlock: row.firstSeenBlock,
      holdings: holdings.map((x) => ({ token: tokenRef(x.token), balance: x.balance })),
      nftCount: nfts?.n ?? 0,
      canvas: account === undefined ? null : { admin: account.admin },
    });
  });

  app.get("/v1/explorer/address/:address/txs", async (c) => {
    const address = param(c, "address", addressSchema);
    const { before, limit } = parseInput(positionQuery, c.req.query());
    const asOf = await readAsOf();
    await requireAddress(address);
    const { items, next } = page(await readAddressTxs(address, before, limit + 1), limit, (r) => [r.blockNumber, r.index]);
    return ok(c, asOf, { items: items.map(txSummary), next });
  });

  app.get("/v1/explorer/address/:address/transfers", async (c) => {
    const address = param(c, "address", addressSchema);
    const { before, limit } = parseInput(positionQuery, c.req.query());
    const asOf = await readAsOf();
    await requireAddress(address);
    const rows = await readAddressTransfers(address, before, limit + 1);
    const { items, next } = page(rows, limit, (r) => [r.blockNumber, r.logIndex]);
    return ok(c, asOf, { items: await transferViews(items), next });
  });

  app.get("/v1/explorer/address/:address/nfts", async (c) => {
    const address = param(c, "address", addressSchema);
    const { before, limit } = parseInput(nftsQuery, c.req.query());
    const asOf = await readAsOf();
    await requireAddress(address);
    const n = schema.exNft;
    const rows = await db
      .select()
      .from(n)
      .where(
        and(
          eq(n.owner, address),
          before === undefined ? undefined : sql`(${n.token}, ${n.tokenId}) < (${before[0]}, ${BigInt(before[1]!)})`,
        ),
      )
      .orderBy(desc(n.token), desc(n.tokenId))
      .limit(limit + 1);
    const { items, next } = page(rows, limit, (r) => [r.token, r.tokenId]);
    const tokens = await tokensByAddress(items.map((r) => r.token));
    const invoiceIds = items.filter((r) => r.token === config.addresses.invoices).map((r) => r.tokenId);
    const invoices =
      invoiceIds.length === 0 ? [] : await db.select().from(schema.invoice).where(inArray(schema.invoice.id, invoiceIds));
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    return ok(c, asOf, {
      items: items.map((r) => {
        const token = tokens.get(r.token);
        const invoice = r.token === config.addresses.invoices ? invoiceById.get(r.tokenId) : undefined;
        return {
          token: token === undefined ? { ...unknownRef(r.token), standard: "erc721" } : tokenRef(token),
          tokenId: r.tokenId,
          invoice:
            invoice === undefined
              ? null
              : { status: INVOICE_STATUS[invoice.status] ?? "unknown", faceValue: invoice.faceValue, dueDate: Number(invoice.dueDate) },
        };
      }),
      next,
    });
  });

  app.get("/v1/explorer/tokens", async (c) => {
    const { before, limit } = parseInput(rankQuery, c.req.query());
    const asOf = await readAsOf();
    const t = schema.exToken;
    const rows = await db
      .select()
      .from(t)
      .where(before === undefined ? undefined : sql`(${t.transferCount}, ${t.address}) < (${Number(before[0])}, ${before[1]})`)
      .orderBy(desc(t.transferCount), desc(t.address))
      .limit(limit + 1);
    const { items, next } = page(rows, limit, (r) => [r.transferCount, r.address]);
    return ok(c, asOf, { items: items.map(tokenView), next });
  });

  app.get("/v1/explorer/tokens/:address", async (c) => {
    const address = param(c, "address", addressSchema);
    const asOf = await readAsOf();
    return ok(c, asOf, { token: tokenView(await requireToken(address)) });
  });

  app.get("/v1/explorer/tokens/:address/holders", async (c) => {
    const address = param(c, "address", addressSchema);
    const { before, limit } = parseInput(rankQuery, c.req.query());
    const asOf = await readAsOf();
    await requireToken(address);
    const h = schema.exHolding;
    const rows = await db
      .select({ holder: h.holder, balance: h.balance })
      .from(h)
      .where(
        and(
          eq(h.token, address),
          before === undefined ? undefined : sql`(${h.balance}, ${h.holder}) < (${BigInt(before[0]!)}, ${before[1]})`,
        ),
      )
      .orderBy(desc(h.balance), desc(h.holder))
      .limit(limit + 1);
    const { items, next } = page(rows, limit, (r) => [r.balance, r.holder]);
    return ok(c, asOf, { items, next });
  });

  app.get("/v1/explorer/tokens/:address/transfers", async (c) => {
    const address = param(c, "address", addressSchema);
    const { before, limit } = parseInput(positionQuery, c.req.query());
    const asOf = await readAsOf();
    await requireToken(address);
    const t = schema.exTransfer;
    const rows = await db
      .select()
      .from(t)
      .where(and(eq(t.token, address), beforePosition(t.blockNumber, t.logIndex, before)))
      .orderBy(desc(t.blockNumber), desc(t.logIndex))
      .limit(limit + 1);
    const { items, next } = page(rows, limit, (r) => [r.blockNumber, r.logIndex]);
    return ok(c, asOf, { items: await transferViews(items), next });
  });

  app.get("/v1/explorer/search", async (c) => {
    const { q } = parseInput(searchQuery, c.req.query());
    const asOf = await readAsOf();
    return ok(c, asOf, { results: await search(q) });
  });

  app.get("/v1/explorer/charts", async (c) => {
    const { range } = parseInput(chartsQuery, c.req.query());
    const asOf = await readAsOf();
    return ok(c, asOf, await readCharts(range, asOf));
  });

  app.get("/v1/explorer/stream", (c) => {
    // Hono runs HEAD through this GET handler and drops the body, so nothing would ever read or close a stream.
    if (c.req.method === "HEAD") return c.body(null, 200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    return streamExplorer(c, clientIp(c));
  });
}
