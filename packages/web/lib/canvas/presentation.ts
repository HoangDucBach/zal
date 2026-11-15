// The browser-side presentation of one chain: canvas layouts and notification read state, stored per chain and
// account. A sandbox Reset reseeds the chain under the same chain id and the same node ids, so its stored
// presentation would reapply to a chain it no longer describes. `clearPresentation` drops it and bumps an epoch
// that the hooks holding it in memory reload on, so the old state cannot be saved back.

import { useSyncExternalStore } from "react";

/** The stored keys that belong to `chainId`: every version of the canvas layout and of the notification state. */
export function presentationKeys(
  keys: readonly string[],
  chainId: number,
): string[] {
  const pattern = new RegExp(
    `^zal\\.(?:canvas-layout|notifications)\\.v\\d+:${chainId}:`,
  );

  return keys.filter((key) => pattern.test(key));
}

let epoch = 0;
const listeners = new Set<() => void>();

export function clearPresentation(chainId: number): void {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) =>
      storage.key(i),
    ).filter((key): key is string => key !== null);

    for (const key of presentationKeys(keys, chainId)) storage.removeItem(key);
  } catch {
    // Storage blocked: nothing was stored, and the epoch below still resets what is in memory.
  }
  epoch++;
  for (const listener of listeners) listener();
}

export const presentationEpoch = (): number => epoch;

export const subscribePresentation = (listener: () => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

/** Bumps on every `clearPresentation`: state loaded from storage under an older epoch is stale. */
export function usePresentationEpoch(): number {
  return useSyncExternalStore(
    subscribePresentation,
    presentationEpoch,
    () => 0,
  );
}
