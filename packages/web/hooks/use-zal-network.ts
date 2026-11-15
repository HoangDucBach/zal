"use client";

import { liveNetwork, sandboxNetwork, type ZalNetwork } from "@/config/chains";
import { useSandboxMode } from "@/lib/sandbox/mode";

/** The network the canvas runs on: the sandbox while it is on, else the live L1 when configured. */
export function useZalNetwork(): ZalNetwork | undefined {
  const mode = useSandboxMode();

  if (mode.enabled) return sandboxNetwork;

  return liveNetwork.status === "ready" ? liveNetwork : undefined;
}
