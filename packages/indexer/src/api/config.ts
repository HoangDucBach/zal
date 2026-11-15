// The API's settings, parsed once at start. A missing or malformed value stops the process with the reason.

import { z } from "zod";

import { readDeployment } from "../../lib/deployment.ts";
import { webOrigins } from "../../lib/siwe.ts";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** The web app's origins, comma-separated. A SIWE message must name one of them. */
  ZAL_WEB_ORIGIN: webOrigins,
  ZAL_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
  /** Use X-Forwarded-For for rate limits. Only behind a proxy that sets it. */
  ZAL_TRUST_PROXY: z.enum(["0", "1"]).default("0"),
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
} as const;
