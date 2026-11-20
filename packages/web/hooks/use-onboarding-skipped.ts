// Whether a wallet skipped the onboarding tour. Presentation only, so it lives in localStorage, per wallet.

import type { Address } from "viem";

import { useSyncExternalStore } from "react";

const PREFIX = "zal.onboarding.skipped.";

/** Holds skips for this page when storage is blocked. */
const memorySkips = new Set<string>();
const listeners = new Set<() => void>();

const keyOf = (wallet: Address) => `${PREFIX}${wallet.toLowerCase()}`;

function isSkipped(wallet: Address): boolean {
  const key = keyOf(wallet);

  try {
    if (window.localStorage.getItem(key) === "1") return true;
  } catch {
    // Storage may be blocked; fall back to this page's skips.
  }

  return memorySkips.has(key);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function skip(wallet: Address): void {
  const key = keyOf(wallet);

  memorySkips.add(key);
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Storage may be blocked; the skip still holds for this page.
  }
  for (const listener of listeners) listener();
}

/** On the server, and before hydration, the tour counts as skipped so it never flashes. */
export function useOnboardingSkipped(
  wallet: Address,
): readonly [boolean, () => void] {
  const skipped = useSyncExternalStore(
    subscribe,
    () => isSkipped(wallet),
    () => true,
  );

  return [skipped, () => skip(wallet)];
}
