// The engine enters the bundle only through this dynamic import, and only once sandbox mode is on.

import type { Address } from "viem";
import type { SandboxRuntime } from "./runtime";

import { getSandboxMode } from "./mode";

let loading:
  | { readonly user: Address; readonly runtime: Promise<SandboxRuntime> }
  | undefined;
const loadListeners = new Set<() => void>();

/** The runtime for the address the sandbox impersonates. Opening another address closes the previous one. */
export async function loadRuntime(): Promise<SandboxRuntime> {
  const mode = getSandboxMode();

  if (!mode.enabled) throw new Error("Sandbox mode is off.");
  if (
    loading === undefined ||
    loading.user.toLowerCase() !== mode.account.toLowerCase()
  ) {
    const previous = loading?.runtime;

    void previous?.then((runtime) => runtime.close()).catch(() => undefined);
    const runtime = import("./runtime").then(({ SandboxRuntime }) =>
      SandboxRuntime.open(mode.account),
    );

    loading = { user: mode.account, runtime };
    void runtime.then(() => {
      for (const listener of loadListeners) listener();
    });
  }

  return loading.runtime;
}

/** The runtime if it was already loaded, for callers that must not trigger a load. */
export function loadedRuntime(): Promise<SandboxRuntime> | undefined {
  return loading?.runtime;
}

export function closeRuntime(): void {
  void loading?.runtime
    .then((runtime) => runtime.close())
    .catch(() => undefined);
  loading = undefined;
  for (const listener of loadListeners) listener();
}

export function subscribeRuntimeLoaded(listener: () => void): () => void {
  loadListeners.add(listener);

  return () => loadListeners.delete(listener);
}
