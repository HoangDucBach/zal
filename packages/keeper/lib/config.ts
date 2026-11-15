// The keeper's environment, parsed once at start. The private key stays out of the returned config's printable
// fields: only `signer` holds it, and nothing logs `signer`.

import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { z } from "zod";

const envSchema = z.object({
  ZAL_CHAIN_ID: z.coerce.number().int().positive(),
  ZAL_RPC_URL: z.url(),
  /** The indexer's /v1 API, for example http://indexer:42069. */
  ZAL_API_URL: z.url(),
  ZAL_KEEPER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex private key"),
  /** Comma-separated web origins whose pages may read /health and /status, as the indexer's allow-list. */
  ZAL_WEB_ORIGIN: z.string().default(""),
  KEEPER_PORT: z.coerce.number().int().min(1).max(65_535).default(42070),
  KEEPER_TICK_MS: z.coerce.number().int().min(1_000).default(10_000),
  KEEPER_BACKOFF_BASE_MS: z.coerce.number().int().min(1_000).default(15_000),
  KEEPER_BACKOFF_MAX_MS: z.coerce.number().int().min(1_000).default(600_000),
  /** Most schedules one tick runs. The rest wait for the next tick, earliest first. */
  KEEPER_BATCH: z.coerce.number().int().min(1).max(500).default(100),
  /**
   * Gas limit of each run. Estimating at the latest block would refuse a run that is due only by the next block's
   * time, so the keeper simulates at that time and sends with a fixed limit instead.
   */
  KEEPER_GAS_LIMIT: z.coerce.bigint().positive().default(3_000_000n),
});

export interface KeeperConfig {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly apiUrl: string;
  readonly signer: PrivateKeyAccount;
  readonly webOrigins: readonly string[];
  readonly port: number;
  readonly tickMs: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  readonly batch: number;
  readonly gasLimit: bigint;
}

export function readConfig(env: NodeJS.ProcessEnv): KeeperConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // Names and messages only: a value echoed here could be the key.
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid keeper environment: ${issues}`);
  }
  const e = result.data;
  return {
    chainId: e.ZAL_CHAIN_ID,
    rpcUrl: e.ZAL_RPC_URL,
    apiUrl: e.ZAL_API_URL.replace(/\/+$/, ""),
    signer: privateKeyToAccount(e.ZAL_KEEPER_PRIVATE_KEY as `0x${string}`),
    webOrigins: e.ZAL_WEB_ORIGIN.split(",").map((o) => o.trim()).filter((o) => o !== ""),
    port: e.KEEPER_PORT,
    tickMs: e.KEEPER_TICK_MS,
    backoffBaseMs: e.KEEPER_BACKOFF_BASE_MS,
    backoffMaxMs: e.KEEPER_BACKOFF_MAX_MS,
    batch: e.KEEPER_BATCH,
    gasLimit: e.KEEPER_GAS_LIMIT,
  };
}
