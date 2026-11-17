// The typed client of the indexer's /v1 API. Every response is zod-parsed at this boundary, and every
// failure becomes an ApiError, so callers see the web's own types and one error type.

import type { CanvasLayout } from "@/lib/canvas/layout";

import { type Address, type Hex } from "viem";
import { z } from "zod";

import {
  activityResponseSchema,
  canvasResponseSchema,
  faucetDripResponseSchema,
  faucetResponseSchema,
  inviteResponseSchema,
  layoutPutResponseSchema,
  nonceResponseSchema,
  notificationsResponseSchema,
  poolResponseSchema,
  walletAccountsResponseSchema,
  problemSchema,
  readResponseSchema,
  verifyResponseSchema,
} from "./wire";

import { env } from "@/config/env";
import { LAYOUT_VERSION } from "@/lib/canvas/layout";
import { ApiError } from "@/lib/query/errors";

/** The API base URL, or undefined when this build has none and live mode reads the chain directly. */
/** One page of GET /v1/wallets/:wallet/accounts. */
export interface WalletAccountsQuery {
  /** 1 to 100, 50 by default. */
  readonly limit?: number;
  /** The previous page's `nextCursor`. */
  readonly cursor?: string;
  /** Only the accounts the wallet acted on (true), or was only added to (false). */
  readonly acted?: boolean;
  /** Part of an account address (hex). */
  readonly q?: string;
}

const queryString = (
  params: Readonly<Record<string, string | number | boolean | undefined>>,
) => {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params))
    if (value !== undefined) search.set(key, String(value));
  const text = search.toString();

  return text === "" ? "" : `?${text}`;
};

export const apiUrl: string | undefined = env.apiUrl;

interface RequestOptions<TSchema extends z.ZodType> {
  readonly schema: TSchema;
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly token?: string;
  readonly signal?: AbortSignal;
  /** Overrides `apiUrl`, for tests. */
  readonly base?: string;
}

/** An RFC 9457 body to an ApiError. Anything else keeps the status and a generic message. */
export function problemToError(status: number, body: unknown): ApiError {
  const problem = problemSchema.safeParse(body);

  if (!problem.success)
    return new ApiError("http", status, `The API answered ${status}`);
  const { code, detail, errors } = problem.data;
  const first = errors?.[0];
  const message =
    detail === undefined || detail === ""
      ? code.replaceAll("_", " ")
      : first === undefined
        ? detail
        : `${detail}: ${first.path} ${first.message}`;

  return new ApiError(code, status, message);
}

export async function apiRequest<TSchema extends z.ZodType>(
  path: string,
  {
    schema,
    method = "GET",
    body,
    token,
    signal,
    base,
  }: RequestOptions<TSchema>,
): Promise<z.output<TSchema>> {
  const root = base ?? apiUrl;

  if (root === undefined)
    throw new ApiError("unconfigured", 0, "No Zal API is configured");
  const headers: Record<string, string> = { Accept: "application/json" };

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  let response: Response;

  try {
    response = await fetch(`${root}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    throw new ApiError("unreachable", 0, "The Zal API is unreachable", {
      cause: error,
    });
  }
  if (response.status === 204) return schema.parse(undefined);
  const json: unknown = await response.json().catch(() => undefined);

  if (!response.ok) throw problemToError(response.status, json);
  const parsed = schema.safeParse(json);

  if (!parsed.success) {
    throw new ApiError(
      "bad_response",
      response.status,
      `Unexpected API response for ${path}`,
      { cause: parsed.error },
    );
  }

  return parsed.data;
}

const lower = (address: Address) => address.toLowerCase();

export const api = {
  canvas: (account: Address, wallet: Address, signal?: AbortSignal) =>
    apiRequest(
      `/v1/accounts/${lower(account)}/canvas?wallet=${lower(wallet)}`,
      {
        schema: canvasResponseSchema,
        signal,
      },
    ),
  notifications: (account: Address, wallet: Address, signal?: AbortSignal) =>
    apiRequest(
      `/v1/accounts/${lower(account)}/notifications?wallet=${lower(wallet)}`,
      { schema: notificationsResponseSchema, signal },
    ),
  activity: (account: Address, before?: string, signal?: AbortSignal) =>
    apiRequest(
      `/v1/accounts/${lower(account)}/activity${before === undefined ? "" : `?before=${before}`}`,
      { schema: activityResponseSchema, signal },
    ),
  walletAccounts: (
    wallet: Address,
    page: WalletAccountsQuery = {},
    signal?: AbortSignal,
  ) =>
    apiRequest(
      `/v1/wallets/${lower(wallet)}/accounts${queryString({
        limit: page.limit,
        cursor: page.cursor,
        acted: page.acted,
        q: page.q,
      })}`,
      { schema: walletAccountsResponseSchema, signal },
    ),
  pool: (signal?: AbortSignal) =>
    apiRequest("/v1/pool", { schema: poolResponseSchema, signal }),
  nonce: () =>
    apiRequest("/v1/auth/nonce", {
      method: "POST",
      schema: nonceResponseSchema,
    }),
  verify: (message: string, signature: Hex) =>
    apiRequest("/v1/auth/verify", {
      method: "POST",
      body: { message, signature },
      schema: verifyResponseSchema,
    }),
  signOut: (token: string) =>
    apiRequest("/v1/auth/session", {
      method: "DELETE",
      token,
      schema: z.undefined(),
    }),
  putLayout: (
    account: Address,
    layout: CanvasLayout,
    /**
     * The revision the edit started from, always sent: 0 means none was saved, so the API creates the row only if
     * it still does not exist and answers 409 when another browser saved first. Omitting it would overwrite.
     */
    revision: number,
    token: string,
  ) =>
    apiRequest(`/v1/accounts/${lower(account)}/layout`, {
      method: "PUT",
      token,
      body: {
        layout: { version: LAYOUT_VERSION, ...layout },
        revision,
      },
      schema: layoutPutResponseSchema,
    }),
  markRead: (keys: readonly string[], token: string) =>
    apiRequest("/v1/notifications/read", {
      method: "POST",
      token,
      body: { keys },
      schema: readResponseSchema,
    }),
  createInvite: (invite: {
    readonly proposer: Address;
    readonly proposerRole: 0 | 1;
    readonly inviteeEmailHash: Hex;
    readonly nonce: bigint;
    readonly deadline: number;
    readonly signature: Hex;
  }) =>
    apiRequest("/v1/invites", {
      method: "POST",
      body: {
        ...invite,
        proposer: lower(invite.proposer),
        nonce: invite.nonce.toString(),
      },
      schema: inviteResponseSchema,
    }),
  invite: (id: string, signal?: AbortSignal) =>
    apiRequest(`/v1/invites/${encodeURIComponent(id)}`, {
      schema: inviteResponseSchema,
      signal,
    }),
  faucet: (signal?: AbortSignal) =>
    apiRequest("/v1/faucet", { schema: faucetResponseSchema, signal }),
  /** Sends the wallet native gas. 409 when it already has gas, 429 once per wallet per 24 h. */
  drip: (wallet: Address) =>
    apiRequest("/v1/faucet", {
      method: "POST",
      body: { wallet: lower(wallet) },
      schema: faucetDripResponseSchema,
    }),
} as const;

/** The stream URL for one account. EventSource resends `Last-Event-ID` itself on reconnect. */
export const streamUrl = (account: Address): string | undefined =>
  apiUrl === undefined
    ? undefined
    : `${apiUrl}/v1/stream?account=${lower(account)}`;

/** One probe of the API's indexed head may take this long; a slower answer counts as the API being down. */
const PROBE_TIMEOUT_MS = 500;

/**
 * Resolves once the API has indexed `block`, so reads after a confirmed transaction show it. Gives up quietly
 * after `timeoutMs`: the stream invalidates the reads again when the block lands. An API that does not answer
 * (unreachable, 5xx, or slower than one probe timeout) ends the wait at once: the reads fall back to the chain.
 */
export async function waitForIndexed(
  block: bigint,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const head = await api
      .pool(AbortSignal.timeout(PROBE_TIMEOUT_MS))
      .then((answer) => BigInt(answer.asOf.block))
      .catch(() => undefined);

    if (head === undefined || head >= block) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
