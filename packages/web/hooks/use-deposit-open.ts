// Whether the Deposit popover is open. Shared so the onboarding tour on the canvas can open the popover that lives
// in the sidebar, without a provider between them.

import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function setDepositOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

export function useDepositOpen(): readonly [boolean, (next: boolean) => void] {
  const isOpen = useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );

  return [isOpen, setDepositOpen];
}
