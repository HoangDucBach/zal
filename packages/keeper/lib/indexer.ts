// Reads the keeper's work list from the indexer: GET /v1/schedules/due (ADR 0015).

import type { DueSchedule } from "./keeper.ts";

import { z } from "zod";

const REQUEST_TIMEOUT_MS = 5_000;

const dueResponse = z.object({
  chainId: z.number(),
  schedules: z.array(
    z.object({
      account: z.string().regex(/^0x[0-9a-f]{40}$/).transform((a) => a as `0x${string}`),
      id: z.string().regex(/^\d+$/).transform(BigInt),
      nextAt: z.number().int(),
    }),
  ),
});

export function createDueFetcher(apiUrl: string, chainId: number, limit: number, fetchFn: typeof fetch = fetch) {
  return async (before: number): Promise<readonly DueSchedule[]> => {
    const url = `${apiUrl}/v1/schedules/due?chainId=${chainId}&before=${before}&limit=${limit}`;
    const res = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`GET /v1/schedules/due answered ${res.status}`);
    const body = dueResponse.parse(await res.json());
    if (body.chainId !== chainId) throw new Error(`The indexer serves chain ${body.chainId}, not ${chainId}`);
    return body.schedules;
  };
}
