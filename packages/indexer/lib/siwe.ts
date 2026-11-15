// Sign-in with Ethereum (EIP-4361) checks that need no chain or database: the message must be for one of the web
// origins and this chain, recent, and inside its own validity window. Nonce consumption and the signature check are
// done by the route.

import { createHash, randomBytes } from "node:crypto";

import { getAddress, type Address } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";

import { ApiError } from "./errors.ts";

/**
 * `ZAL_WEB_ORIGIN`: a comma-separated allow-list of web origins, for example
 * `http://localhost:3100,http://localhost:3001`. Each entry must be a full URL; only its origin is kept.
 */
export const webOrigins = z
  .string()
  .transform((list) => list.split(",").map((entry) => entry.trim()).filter((entry) => entry !== ""))
  .pipe(z.array(z.url({ protocol: /^https?$/ }).transform((u) => new URL(u).origin)).min(1));

export interface SiweExpectations {
  /** The allowed web origins, for example `http://localhost:3100`. A message's URI must name one, and its `domain` must be that origin's host. */
  readonly origins: readonly string[];
  readonly chainId: number;
  readonly now: Date;
  /** How old `issuedAt` may be. */
  readonly maxAgeSeconds: number;
}

export interface CheckedSiwe {
  readonly address: Address;
  readonly nonce: string;
  readonly expirationTime?: Date;
}

const CLOCK_SKEW_MS = 60_000;

export function checkSiweMessage(text: string, expect: SiweExpectations): CheckedSiwe {
  const fail = (message: string): never => {
    throw new ApiError("unauthorized", message);
  };
  const msg = parseSiweMessage(text);
  if (msg.address === undefined || msg.nonce === undefined || msg.issuedAt === undefined || msg.uri === undefined) {
    return fail("The message is not a complete SIWE message");
  }
  if (msg.version !== "1") fail("Unsupported SIWE version");
  if (msg.chainId !== expect.chainId) fail(`The message is for chain ${String(msg.chainId)}, not ${expect.chainId}`);
  const uri = URL.parse(msg.uri);
  if (uri === null || !expect.origins.includes(uri.origin)) return fail("The message URI is not an allowed web origin");
  // The domain must be the host of the origin the URI names, not of any allowed origin.
  if (msg.domain !== uri.host) fail(`The message is for ${String(msg.domain)}, not ${uri.host}`);
  // viem parses a time that is not RFC 3339 as an Invalid Date, whose NaN would pass every comparison below.
  for (const time of [msg.issuedAt, msg.expirationTime, msg.notBefore]) {
    if (time !== undefined && Number.isNaN(time.getTime())) fail("A time in the message is not an RFC 3339 date-time");
  }
  const now = expect.now.getTime();
  const issued = msg.issuedAt.getTime();
  if (issued > now + CLOCK_SKEW_MS || now - issued > expect.maxAgeSeconds * 1000) fail("The message was not issued just now");
  if (msg.expirationTime !== undefined && msg.expirationTime.getTime() <= now) fail("The message has expired");
  if (msg.notBefore !== undefined && msg.notBefore.getTime() > now + CLOCK_SKEW_MS) fail("The message is not valid yet");
  return {
    address: getAddress(msg.address),
    nonce: msg.nonce,
    ...(msg.expirationTime === undefined ? {} : { expirationTime: msg.expirationTime }),
  };
}

/** A bearer token and the hash stored for it. The token itself is never stored. */
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
