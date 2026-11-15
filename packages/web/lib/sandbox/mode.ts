// Whether the app runs on the sandbox, and which wallet address the sandbox impersonates. A store the transport
// and the connector consult on every request, persisted so a reload keeps the mode.

import { useSyncExternalStore } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

import { STORAGE_KEY_MODE } from "./config";

export type SandboxMode =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly account: Address };

const OFF: SandboxMode = { enabled: false };

const storedSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal(1), enabled: z.literal(false) }),
  z.object({
    version: z.literal(1),
    enabled: z.literal(true),
    account: z.string().refine((value) => isAddress(value, { strict: false })),
  }),
]);

let current: SandboxMode | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readStored(): SandboxMode {
  const text = storage()?.getItem(STORAGE_KEY_MODE);

  if (text === null || text === undefined) return OFF;
  try {
    const parsed = storedSchema.safeParse(JSON.parse(text));

    if (!parsed.success) return OFF;

    return parsed.data.enabled
      ? { enabled: true, account: getAddress(parsed.data.account) }
      : OFF;
  } catch {
    return OFF;
  }
}

export function getSandboxMode(): SandboxMode {
  return (current ??= readStored());
}

export function setSandboxMode(mode: SandboxMode): void {
  current = mode;
  try {
    storage()?.setItem(
      STORAGE_KEY_MODE,
      JSON.stringify({ version: 1, ...mode }),
    );
  } catch {
    // Storage may be blocked; the mode still holds for this page.
  }
  for (const listener of listeners) listener();
}

export function subscribeSandboxMode(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** On the server, and before hydration, the sandbox is off. */
export function useSandboxMode(): SandboxMode {
  return useSyncExternalStore(subscribeSandboxMode, getSandboxMode, () => OFF);
}
