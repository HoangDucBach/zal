// Where the protocol lives: chain id, RPC and contract addresses. Read once, at Ponder build time and at API
// start, from env. The addresses come from a deployment file (what Deploy.s.sol writes) or from one env var each.

import { readFileSync } from "node:fs";

import { z } from "zod";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "not an address")
  .transform((a) => a.toLowerCase() as `0x${string}`);

const addressesSchema = z.object({
  usdc: address,
  factory: address,
  registry: address,
  invoices: address,
  pool: address,
  vault: address,
});

export type ZalAddresses = z.infer<typeof addressesSchema>;

export interface Deployment {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly startBlock: number;
  readonly addresses: ZalAddresses;
}

const envSchema = z.object({
  ZAL_CHAIN_ID: z.coerce.number().int().positive(),
  ZAL_RPC_URL: z.url(),
  ZAL_START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  ZAL_DEPLOYMENT: z.string().min(1).optional(),
});

type Env = Readonly<Record<string, string | undefined>>;

/** Throws with every problem listed, so a misconfigured container fails at start, not on the first request. */
export function readDeployment(env: Env, readFile = (p: string) => readFileSync(p, "utf8")): Deployment {
  const base = envSchema.parse(env);
  let addresses: ZalAddresses;

  if (base.ZAL_DEPLOYMENT !== undefined) {
    const file = z
      .object({ chainId: z.number().int() })
      .and(addressesSchema)
      .parse(JSON.parse(readFile(base.ZAL_DEPLOYMENT)));

    if (file.chainId !== base.ZAL_CHAIN_ID) {
      throw new Error(
        `${base.ZAL_DEPLOYMENT} is for chain ${file.chainId}, but ZAL_CHAIN_ID is ${base.ZAL_CHAIN_ID}`,
      );
    }
    addresses = addressesSchema.parse(file);
  } else {
    addresses = addressesSchema.parse({
      usdc: env.ZAL_USDC,
      factory: env.ZAL_FACTORY,
      registry: env.ZAL_REGISTRY,
      invoices: env.ZAL_INVOICES,
      pool: env.ZAL_POOL,
      vault: env.ZAL_VAULT,
    });
  }

  return {
    chainId: base.ZAL_CHAIN_ID,
    rpcUrl: base.ZAL_RPC_URL,
    startBlock: base.ZAL_START_BLOCK,
    addresses,
  };
}
