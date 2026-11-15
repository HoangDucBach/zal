// The API's settings, parsed once at start. A missing or malformed value stops the process with the reason.

import type { Hex } from "viem";

import { z } from "zod";

import { readDeployment } from "../../lib/deployment.ts";
import { webOrigins } from "../../lib/siwe.ts";

const wei = z
  .string()
  .regex(/^\d{1,30}$/, "not a wei amount")
  .transform((v) => BigInt(v));

/**
 * The faucet wallet's key, 0x and 64 hex digits, or unset (an empty value counts as unset). Parsed apart from the
 * other settings so a malformed key never reaches an error message or a log.
 */
function readFaucetKey(value: string | undefined): Hex | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("ZAL_FAUCET_PRIVATE_KEY must be 0x followed by 64 hex digits");
  return value as Hex;
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** The web app's origins, comma-separated. A SIWE message must name one of them. */
  ZAL_WEB_ORIGIN: webOrigins,
  ZAL_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
  /** Use X-Forwarded-For for rate limits. Only behind a proxy that sets it. */
  ZAL_TRUST_PROXY: z.enum(["0", "1"]).default("0"),
  /** Native token per drip, in wei (18 decimals). */
  ZAL_FAUCET_DRIP_WEI: wei.default(50_000_000_000_000_000n),
  /** A wallet at or above this native balance gets no drip. */
  ZAL_FAUCET_MIN_BALANCE_WEI: wei.default(10_000_000_000_000_000n),
});

const env = schema.parse(process.env);
const deployment = readDeployment(process.env);

export const config = {
  databaseUrl: env.DATABASE_URL,
  webOrigins: env.ZAL_WEB_ORIGIN,
  sessionTtlSeconds: env.ZAL_SESSION_TTL_SECONDS,
  trustProxy: env.ZAL_TRUST_PROXY === "1",
  chainId: deployment.chainId,
  addresses: deployment.addresses,
  nonceTtlSeconds: 600,
  rpcUrl: deployment.rpcUrl,
  faucet: {
    privateKey: readFaucetKey(process.env.ZAL_FAUCET_PRIVATE_KEY),
    dripWei: env.ZAL_FAUCET_DRIP_WEI,
    minBalanceWei: env.ZAL_FAUCET_MIN_BALANCE_WEI,
  },
} as const;
