// Explorer routes and the client half of search. The client routes only a direct hit (an address or a block
// number); a 32-byte hash (tx or block) and free text go to GET /v1/explorer/search, which decides.

import type { SearchResult } from "@/lib/api/explorer-wire";

import { getAddress, type Address } from "viem";

export const EXPLORER = "/app/explorer";

export const explorerHref = {
  home: () => EXPLORER,
  address: (address: string) => `${EXPLORER}/address/${address.toLowerCase()}`,
  tx: (hash: string) => `${EXPLORER}/tx/${hash.toLowerCase()}`,
  block: (id: number | string) => `${EXPLORER}/block/${String(id)}`,
  token: (address: string) => `${EXPLORER}/token/${address.toLowerCase()}`,
} as const;

export type SearchQuery =
  | { readonly kind: "empty" }
  | { readonly kind: "address"; readonly address: Address }
  | { readonly kind: "block"; readonly number: number }
  /** A tx hash or a block hash: only the API knows which. */
  | { readonly kind: "hash"; readonly hash: string }
  | { readonly kind: "text"; readonly text: string };

const MAX_BLOCK = Number.MAX_SAFE_INTEGER;

export function classifySearch(raw: string): SearchQuery {
  const text = raw.trim();

  if (text === "") return { kind: "empty" };
  if (/^0x[0-9a-fA-F]{40}$/.test(text))
    return { kind: "address", address: getAddress(text.toLowerCase()) };
  if (/^0x[0-9a-fA-F]{64}$/.test(text))
    return { kind: "hash", hash: text.toLowerCase() };
  if (/^\d{1,16}$/.test(text) && Number(text) <= MAX_BLOCK)
    return { kind: "block", number: Number(text) };

  return { kind: "text", text };
}

/** Where a direct hit goes without asking the API, or undefined when the API must answer. */
export function directHref(query: SearchQuery): string | undefined {
  switch (query.kind) {
    case "address":
      return explorerHref.address(query.address);
    case "block":
      return explorerHref.block(query.number);
    case "empty":
    case "hash":
    case "text":
      return undefined;
  }
}

/** The page a search result opens. An invoice opens the Invoice NFT contract, when this build knows it. */
export function resultHref(
  result: SearchResult,
  invoices: Address | undefined,
): string | undefined {
  switch (result.type) {
    case "address":
      return explorerHref.address(result.id);
    case "tx":
      return explorerHref.tx(result.id);
    case "block":
      return explorerHref.block(result.id);
    case "token":
      return explorerHref.token(result.id);
    case "invoice":
      return invoices === undefined ? undefined : explorerHref.token(invoices);
  }
}
