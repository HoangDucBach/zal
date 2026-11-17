"use client";

// What a schedule card needs beyond chain state: a clock that keeps moving between reads, so "Run now"
// appears when a schedule falls due, and whether a keeper is running it.

import type { ZalNetwork } from "@/config/chains";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { env } from "@/config/env";

const TICK_MS = 5_000;
const KEEPER_POLL_MS = 30_000;
const KEEPER_TIMEOUT_MS = 5_000;

/**
 * Chain time now, at least: `chainNow` was the head's time when it was read at `readAtMs` (wall clock), and blocks
 * come only with transactions, so time since the read is added. A chain clock never runs behind the wall clock
 * (the sandbox only jumps forward), so the wall clock is a floor.
 */
export function chainClock(
  chainNow: number,
  readAtMs: number,
  wallMs: number,
): number {
  const elapsed = Math.max(0, Math.floor((wallMs - readAtMs) / 1000));

  return Math.max(chainNow + elapsed, Math.floor(wallMs / 1000));
}

export function useChainClock(chainNow: number, readAtMs: number): number {
  const [wallMs, setWallMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setWallMs(Date.now()), TICK_MS);

    return () => window.clearInterval(timer);
  }, []);

  return chainClock(chainNow, readAtMs, Math.max(wallMs, readAtMs));
}

export type KeeperStatus = "online" | "offline";

/** The sandbox runs its own keeper bot. Live, the keeper's GET /health decides; no URL means none runs. */
export function useKeeperStatus(network: ZalNetwork | undefined): KeeperStatus {
  const url = env.keeperUrl;
  const health = useQuery({
    enabled: network?.kind === "live" && url !== undefined,
    queryKey: ["keeper", "health", url],
    refetchInterval: KEEPER_POLL_MS,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(KEEPER_TIMEOUT_MS),
        ]),
      });

      return response.ok;
    },
  });

  if (network?.kind === "sandbox") return "online";

  return health.data === true ? "online" : "offline";
}
