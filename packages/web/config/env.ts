import { z } from "zod";

// Next inlines NEXT_PUBLIC_* only when each variable is read by its literal name, so they are listed one by one.
// The live L1 is optional: until its chain id and RPC are set, the app runs in the sandbox only.
const schema = z.object({
  l1ChainId: z.coerce.number().int().positive().optional(),
  l1Rpc: z.url().optional(),
  l1Name: z.string().min(1).default("Zal L1"),
  l1NativeSymbol: z.string().min(1).default("ZAL"),
  l1Explorer: z.url().optional(),
  /** The indexer's /v1 API (ADR 0012). Without it, live mode reads the chain directly. */
  apiUrl: z
    .url()
    .transform((url) => url.replace(/\/+$/, ""))
    .optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse({
  l1ChainId: process.env.NEXT_PUBLIC_ZAL_CHAIN_ID || undefined,
  l1Rpc: process.env.NEXT_PUBLIC_ZAL_RPC_URL || undefined,
  l1Name: process.env.NEXT_PUBLIC_ZAL_CHAIN_NAME || undefined,
  l1NativeSymbol: process.env.NEXT_PUBLIC_ZAL_NATIVE_SYMBOL || undefined,
  l1Explorer: process.env.NEXT_PUBLIC_ZAL_EXPLORER_URL || undefined,
  apiUrl: process.env.NEXT_PUBLIC_ZAL_API_URL || undefined,
});
