// Live-mode layout sync (ADR 0011, ADR 0012). The server holds a base layout at a revision; the client keeps the
// edits it has not had acknowledged, as functions, and shows them applied over the base. A save sends the result
// with the base's revision. On 409 the client takes the newer base and replays its edits on it, which is "reload
// and apply your change again" without losing the user's change. Each edit is a function of the layout it applies to
// (a move, a placed draft, a link), never a snapshot of a whole layout, so a replay keeps the other browser's
// change too. Pure, so every transition is tested.

import type { CanvasLayout } from "@/lib/canvas/layout";

import { EMPTY_LAYOUT, layoutProblem } from "@/lib/canvas/layout";

export type LayoutChange = (layout: CanvasLayout) => CanvasLayout;

interface ServerLayout {
  readonly layout: CanvasLayout;
  readonly revision: number;
}

export interface LayoutSync {
  /** False until the first server snapshot arrives. */
  readonly loaded: boolean;
  readonly base: CanvasLayout;
  /** 0 when nothing is saved for the account yet. */
  readonly revision: number;
  /** User edits the server has not acknowledged, oldest first. */
  readonly edits: readonly LayoutChange[];
  /**
   * The latest change derived from chain state (new nodes get a position). Any client recomputes it, so it needs no
   * save or sign-in by itself; it is applied last, over every base, and sent along with the next user edit.
   */
  readonly derived: LayoutChange | undefined;
  /** The edits the request in flight carries, and the layout it sent. */
  readonly saving:
    { readonly count: number; readonly layout: CanvasLayout } | undefined;
  /**
   * The newest snapshot that arrived while a save was in flight. It may or may not hold that save, so it waits for
   * the answer: a 409 rebases on it at once, a success keeps it only if it is newer than the saved revision.
   */
  readonly incoming: ServerLayout | undefined;
  /** A save was refused as stale: waiting for the newer base before saving again. */
  readonly conflict: boolean;
  /** Failed saves in a row that are worth retrying (network, 5xx, 429). */
  readonly failures: number;
  /** The API refused the layout for good: no retry until the user edits again. */
  readonly refused: string | undefined;
  /** The last edit was not applied: it would break a limit the API enforces. Cleared by the next edit. */
  readonly rejected: string | undefined;
}

export type LayoutSyncEvent =
  | ({ readonly type: "server" } & ServerLayout)
  | { readonly type: "edit"; readonly change: LayoutChange }
  | { readonly type: "derive"; readonly change: LayoutChange }
  | { readonly type: "saveStarted" }
  | { readonly type: "saved"; readonly revision: number }
  /** The save answered 409: another browser saved first. */
  | { readonly type: "conflict" }
  /** Any other failed save. `status` 0 means no answer (offline, timeout). */
  | {
      readonly type: "saveFailed";
      readonly status: number;
      readonly reason: string;
    };

export const INITIAL_SYNC: LayoutSync = {
  loaded: false,
  base: EMPTY_LAYOUT,
  revision: 0,
  edits: [],
  derived: undefined,
  saving: undefined,
  incoming: undefined,
  conflict: false,
  failures: 0,
  refused: undefined,
  rejected: undefined,
};

/** What the canvas shows: the base, then every unacknowledged edit, then the derived change. */
export function viewOf(sync: LayoutSync): CanvasLayout {
  const edited = sync.edits.reduce(
    (layout, change) => change(layout),
    sync.base,
  );

  return sync.derived === undefined ? edited : sync.derived(edited);
}

/** There is a user edit the server has not stored. */
export const isDirty = (sync: LayoutSync): boolean => sync.edits.length > 0;

/** A save may start now: loaded, dirty, nothing in flight, not waiting out a conflict, not refused for good. */
export const canSave = (sync: LayoutSync): boolean =>
  sync.loaded &&
  isDirty(sync) &&
  sync.saving === undefined &&
  !sync.conflict &&
  sync.refused === undefined;

/**
 * A failed save the API will refuse again however often it is sent: the request itself is wrong (400, 413, 422) or
 * the wallet may not write (403). 401 is not: the hook signs in again. 408, 429 and 5xx are worth a retry.
 */
export const isPermanentFailure = (status: number): boolean =>
  status >= 400 && status < 500 && ![401, 408, 409, 429].includes(status);

const rebase = (sync: LayoutSync, server: ServerLayout): LayoutSync => ({
  ...sync,
  loaded: true,
  base: server.layout,
  revision: server.revision,
  incoming: undefined,
  conflict: false,
});

export function layoutSyncReducer(
  sync: LayoutSync,
  event: LayoutSyncEvent,
): LayoutSync {
  switch (event.type) {
    case "server": {
      const server = { layout: event.layout, revision: event.revision };

      if (sync.saving !== undefined)
        return event.revision > (sync.incoming?.revision ?? sync.revision)
          ? { ...sync, incoming: server }
          : sync;
      if (sync.loaded && event.revision <= sync.revision) return sync;

      return rebase(sync, server);
    }
    case "edit": {
      const next = { ...sync, edits: [...sync.edits, event.change] };
      const problem = layoutProblem(viewOf(next));

      return problem === undefined
        ? { ...next, refused: undefined, rejected: undefined }
        : { ...sync, rejected: problem };
    }
    case "derive":
      return { ...sync, derived: event.change };
    case "saveStarted":
      return {
        ...sync,
        saving: { count: sync.edits.length, layout: viewOf(sync) },
      };
    case "saved": {
      if (sync.saving === undefined) return sync;
      const saved: LayoutSync = {
        ...sync,
        base: sync.saving.layout,
        revision: event.revision,
        edits: sync.edits.slice(sync.saving.count),
        saving: undefined,
        incoming: undefined,
        failures: 0,
      };

      // A snapshot newer than this save already holds it, and another browser's change after it.
      return sync.incoming !== undefined &&
        sync.incoming.revision > event.revision
        ? rebase(saved, sync.incoming)
        : saved;
    }
    case "conflict": {
      const stale = { ...sync, saving: undefined };

      return sync.incoming === undefined
        ? { ...stale, conflict: true }
        : rebase(stale, sync.incoming);
    }
    case "saveFailed":
      return isPermanentFailure(event.status)
        ? { ...sync, saving: undefined, refused: event.reason }
        : { ...sync, saving: undefined, failures: sync.failures + 1 };
  }
}
