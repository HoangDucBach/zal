// The typed client of /v1/explorer (docs/plans/explorer.md). Public reads: no token, no wallet.

import type { Address } from "viem";

import { apiRequest, apiUrl } from "./client";
import {
  addressResponseSchema,
  blockResponseSchema,
  blockSummarySchema,
  chartsResponseSchema,
  holderSchema,
  nftSchema,
  pageSchema,
  searchResponseSchema,
  statsResponseSchema,
  tokenResponseSchema,
  tokenSchema,
  transferSchema,
  txResponseSchema,
  txSummarySchema,
  type ChartRange,
} from "./explorer-wire";

const BASE = "/v1/explorer";

/** One page of a list: `before` is the previous page's `next`. */
export interface PageQuery {
  readonly before?: string;
  /** 1 to 100, 25 by default. */
  readonly limit?: number;
  /** `/txs` only: the txs of this block. */
  readonly block?: number;
}

const pageQuery = ({ before, limit, block }: PageQuery = {}): string => {
  const search = new URLSearchParams();

  if (block !== undefined) search.set("block", String(block));
  if (before !== undefined) search.set("before", before);
  if (limit !== undefined) search.set("limit", String(limit));
  const text = search.toString();

  return text === "" ? "" : `?${text}`;
};

const lower = (a: Address | string) => a.toLowerCase();

const blocksPage = pageSchema(blockSummarySchema);
const txsPage = pageSchema(txSummarySchema);
const transfersPage = pageSchema(transferSchema);
const nftsPage = pageSchema(nftSchema);
const tokensPage = pageSchema(tokenSchema);
const holdersPage = pageSchema(holderSchema);

export const explorerApi = {
  stats: (signal?: AbortSignal) =>
    apiRequest(`${BASE}/stats`, { schema: statsResponseSchema, signal }),
  blocks: (page?: PageQuery, signal?: AbortSignal) =>
    apiRequest(`${BASE}/blocks${pageQuery(page)}`, {
      schema: blocksPage,
      signal,
    }),
  block: (numberOrHash: string, signal?: AbortSignal) =>
    apiRequest(`${BASE}/blocks/${encodeURIComponent(lower(numberOrHash))}`, {
      schema: blockResponseSchema,
      signal,
    }),
  txs: (page?: PageQuery, signal?: AbortSignal) =>
    apiRequest(`${BASE}/txs${pageQuery(page)}`, { schema: txsPage, signal }),
  tx: (hash: string, signal?: AbortSignal) =>
    apiRequest(`${BASE}/txs/${encodeURIComponent(lower(hash))}`, {
      schema: txResponseSchema,
      signal,
    }),
  address: (address: Address, signal?: AbortSignal) =>
    apiRequest(`${BASE}/address/${lower(address)}`, {
      schema: addressResponseSchema,
      signal,
    }),
  addressTxs: (address: Address, page?: PageQuery, signal?: AbortSignal) =>
    apiRequest(`${BASE}/address/${lower(address)}/txs${pageQuery(page)}`, {
      schema: txsPage,
      signal,
    }),
  addressTransfers: (
    address: Address,
    page?: PageQuery,
    signal?: AbortSignal,
  ) =>
    apiRequest(
      `${BASE}/address/${lower(address)}/transfers${pageQuery(page)}`,
      { schema: transfersPage, signal },
    ),
  addressNfts: (address: Address, page?: PageQuery, signal?: AbortSignal) =>
    apiRequest(`${BASE}/address/${lower(address)}/nfts${pageQuery(page)}`, {
      schema: nftsPage,
      signal,
    }),
  tokens: (page?: PageQuery, signal?: AbortSignal) =>
    apiRequest(`${BASE}/tokens${pageQuery(page)}`, {
      schema: tokensPage,
      signal,
    }),
  token: (address: Address, signal?: AbortSignal) =>
    apiRequest(`${BASE}/tokens/${lower(address)}`, {
      schema: tokenResponseSchema,
      signal,
    }),
  tokenHolders: (address: Address, page?: PageQuery, signal?: AbortSignal) =>
    apiRequest(`${BASE}/tokens/${lower(address)}/holders${pageQuery(page)}`, {
      schema: holdersPage,
      signal,
    }),
  tokenTransfers: (address: Address, page?: PageQuery, signal?: AbortSignal) =>
    apiRequest(`${BASE}/tokens/${lower(address)}/transfers${pageQuery(page)}`, {
      schema: transfersPage,
      signal,
    }),
  search: (q: string, signal?: AbortSignal) =>
    apiRequest(`${BASE}/search?q=${encodeURIComponent(q)}`, {
      schema: searchResponseSchema,
      signal,
    }),
  charts: (range: ChartRange, signal?: AbortSignal) =>
    apiRequest(`${BASE}/charts?range=${range}`, {
      schema: chartsResponseSchema,
      signal,
    }),
} as const;

/** The block stream: `event: block` with a BlockSummary on each new block. */
export const explorerStreamUrl = (): string | undefined =>
  apiUrl === undefined ? undefined : `${apiUrl}${BASE}/stream`;

/** One `block` event's data, or undefined when it does not parse. */
export function parseBlockEvent(data: string) {
  let json: unknown;

  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  const parsed = blockSummarySchema.safeParse(json);

  return parsed.success ? parsed.data : undefined;
}
