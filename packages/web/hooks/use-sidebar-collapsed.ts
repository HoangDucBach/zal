// Whether the app sidebar shows as an icon rail. The visitor's choice wins and is remembered in localStorage;
// without one, the rail is the default below the `xl` breakpoint, where the canvas needs the width.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "zal.sidebar";
const NARROW = "(max-width: 1279px)";

type Choice = "collapsed" | "expanded";

/** Holds the choice for this page when storage is blocked. */
let memoryChoice: Choice | undefined;
const listeners = new Set<() => void>();

function readChoice(): Choice | undefined {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (stored === "collapsed" || stored === "expanded") return stored;
  } catch {
    // Storage may be blocked; fall back to this page's choice.
  }

  return memoryChoice;
}

function isCollapsed(): boolean {
  const choice = readChoice();

  return choice === undefined
    ? window.matchMedia(NARROW).matches
    : choice === "collapsed";
}

function subscribe(listener: () => void): () => void {
  const media = window.matchMedia(NARROW);

  listeners.add(listener);
  media.addEventListener("change", listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
    window.removeEventListener("storage", listener);
  };
}

function setCollapsed(collapsed: boolean): void {
  memoryChoice = collapsed ? "collapsed" : "expanded";
  try {
    window.localStorage.setItem(STORAGE_KEY, memoryChoice);
  } catch {
    // Storage may be blocked; the choice still holds for this page.
  }
  for (const listener of listeners) listener();
}

/** On the server, and before hydration, the sidebar is expanded. */
export function useSidebarCollapsed(): readonly [
  boolean,
  (collapsed: boolean) => void,
] {
  const collapsed = useSyncExternalStore(subscribe, isCollapsed, () => false);

  return [collapsed, setCollapsed];
}
