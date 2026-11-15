// The /v1/explorer wire form (docs/plans/explorer.md, "API") parsed into the web's own types. Same rules as
// wire.ts: bigints as decimal strings, lowercase addresses (returned checksummed), `null` for a missing value, an
// `asOf` envelope. Block numbers, timestamps and counts become numbers; amounts become bigints.

import { z } from "zod";

import { address, asOfSchema, big, hash, hex, int } from "./wire";

/** A block number, timestamp or count. The API may send a bigint column as a decimal string or a safe integer. */
const num = z.union([
  int,
  z
    .string()
    .regex(/^\d{1,15}$/, "not a safe decimal integer")
    .transform(Number),
]);
/** An amount: a decimal string, or a safe integer for a small one. */
const amount = z.union([big, int.transform((n) => BigInt(n))]);

/** `schema`, or `null` when the field is `null` or missing. */
const maybe = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((v): z.output<T> | null => v ?? null);

const DAY = 86_400;

export const TX_KINDS = ["zal", "token", "native", "deploy", "other"] as const;
export type TxKind = (typeof TX_KINDS)[number];
/** An unknown kind from a newer API counts as `other`. */
const txKind = z.enum(TX_KINDS).catch("other");

export type TxStatus = "success" | "reverted";
/** `success` / `reverted`, or the receipt's own form (`1`, `0x1`, `true`). */
const txStatus = z
  .union([z.string(), z.boolean(), z.number()])
  .transform((s): TxStatus =>
    s === true || s === 1 || s === "success" || s === "0x1" || s === "1"
      ? "success"
      : "reverted",
  );

const standard = z.enum(["erc20", "erc721"]);

export type TokenStandard = z.output<typeof standard>;

export const tokenRefSchema = z.object({
  address,
  symbol: maybe(z.string()),
  decimals: maybe(num),
  standard,
});
export type TokenRef = z.output<typeof tokenRefSchema>;

export const blockSummarySchema = z.object({
  number: num,
  hash,
  timestamp: num,
  txCount: num,
  gasUsed: amount,
});
export type BlockSummary = z.output<typeof blockSummarySchema>;

const blockSchema = blockSummarySchema.extend({
  parentHash: hash,
  gasLimit: amount,
  baseFeePerGas: maybe(amount),
  miner: address,
});

export type Block = z.output<typeof blockSchema>;

export const txSummarySchema = z.object({
  hash,
  blockNumber: num,
  timestamp: num,
  from: address,
  /** `null` on a contract creation. */
  to: maybe(address),
  value: amount,
  fee: amount,
  status: txStatus,
  /** Decoded from the Zal ABIs, else `null` and the UI shows `selector`. */
  method: maybe(z.string()),
  selector: maybe(hex),
  kind: txKind,
});
export type TxSummary = z.output<typeof txSummarySchema>;

const txSchema = txSummarySchema.extend({
  index: num,
  gasUsed: amount,
  effectiveGasPrice: amount,
  contractCreated: maybe(address),
  input: hex,
});

export type Tx = z.output<typeof txSchema>;

/** Decoded event args as text: a nested value (an array or struct) is shown as JSON. */
const args = z
  .record(z.string(), z.unknown())
  .transform((record) =>
    Object.fromEntries(
      Object.entries(record).map(([k, v]) => [
        k,
        typeof v === "string" ? v : JSON.stringify(v),
      ]),
    ),
  );

const logSchema = z.object({
  logIndex: num,
  address,
  topics: z.array(hex),
  data: hex,
  decoded: maybe(z.object({ name: z.string(), args })),
});

export type Log = z.output<typeof logSchema>;

export const transferSchema = z.object({
  txHash: hash,
  logIndex: num,
  blockNumber: num,
  timestamp: num,
  token: tokenRefSchema,
  from: address,
  to: address,
  /** ERC-20 amount; `null` for an ERC-721 transfer. */
  value: maybe(amount),
  /** ERC-721 id; `null` for an ERC-20 transfer. */
  tokenId: maybe(amount),
});
export type Transfer = z.output<typeof transferSchema>;

export const tokenSchema = z.object({
  address,
  standard,
  name: maybe(z.string()),
  symbol: maybe(z.string()),
  decimals: maybe(num),
  totalSupply: maybe(amount),
  holderCount: num,
  transferCount: num,
});
export type Token = z.output<typeof tokenSchema>;

export const holderSchema = z.object({ holder: address, balance: amount });
export type Holder = z.output<typeof holderSchema>;

export const nftSchema = z.object({
  token: tokenRefSchema,
  tokenId: amount,
  /** Set when the NFT is a Zal Invoice. */
  invoice: maybe(
    z.object({ status: z.string(), faceValue: amount, dueDate: num }),
  ),
});
export type Nft = z.output<typeof nftSchema>;

/** One page of a cursor list: `next` is the `before` of the following page, `null` on the last. */
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    asOf: asOfSchema,
    items: z.array(item).max(100),
    next: maybe(z.string()),
  });
export interface Page<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}

export const statsResponseSchema = z.object({
  asOf: asOfSchema,
  height: num,
  totalTxs: num,
  totalAddresses: num,
  totalContracts: num,
  /** Over the last 100 blocks; `null` before there are two. */
  avgBlockTimeSec: maybe(
    z.union([z.number().nonnegative(), z.string().transform(Number)]),
  ),
  baseFeePerGas: maybe(amount),
  zusdcSupply: amount,
  canvases: num,
});
export type ExplorerStats = z.output<typeof statsResponseSchema>;

export const blockResponseSchema = z.object({
  asOf: asOfSchema,
  block: blockSchema,
  txs: z.array(txSummarySchema),
  /** The `before` of the block's next txs page (`GET /txs?block=<number>`), `null` when `txs` holds them all. */
  txsNext: maybe(z.string()),
});
export type BlockDetail = z.output<typeof blockResponseSchema>;

export const txResponseSchema = z.object({
  asOf: asOfSchema,
  tx: txSchema,
  logs: z.array(logSchema),
  transfers: z.array(transferSchema),
});
export type TxDetail = z.output<typeof txResponseSchema>;

export const addressResponseSchema = z.object({
  asOf: asOfSchema,
  address,
  isContract: z.boolean(),
  /** A deployment name or `Zal canvas`. */
  label: maybe(z.string()),
  txCount: num,
  firstSeenBlock: maybe(num),
  holdings: z.array(z.object({ token: tokenRefSchema, balance: amount })),
  nftCount: num,
  /** Set when the address is a Zal CanvasAccount. */
  canvas: maybe(z.object({ admin: address })),
});
export type AddressDetail = z.output<typeof addressResponseSchema>;

export const tokenResponseSchema = z.object({
  asOf: asOfSchema,
  token: tokenSchema,
});

export const SEARCH_TYPES = [
  "address",
  "tx",
  "block",
  "token",
  "invoice",
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const searchResponseSchema = z.object({
  asOf: asOfSchema,
  results: z
    .array(
      z.object({
        type: z.enum(SEARCH_TYPES),
        id: z.string().min(1),
        label: maybe(z.string()),
      }),
    )
    .max(10),
});
export type SearchResult = z.output<
  typeof searchResponseSchema
>["results"][number];

export const CHART_RANGES = ["1d", "1w", "1m", "all"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

export const chartsResponseSchema = z.object({
  asOf: asOfSchema,
  days: z.array(
    z.object({
      /** The UTC unix day on the wire, unix seconds at its midnight here. A value already in seconds is kept. */
      day: num.transform((d) => (d < 10_000_000 ? d * DAY : d)),
      txCount: num,
      activeAddresses: num,
      gasUsed: amount,
      fees: amount,
      zusdcSettled: amount,
      newAccounts: num,
    }),
  ),
  kinds: z.array(z.object({ kind: txKind, count: num })),
});
export type ExplorerCharts = z.output<typeof chartsResponseSchema>;
export type ChartDay = ExplorerCharts["days"][number];
