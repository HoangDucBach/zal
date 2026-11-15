import type { CanvasLayout } from "@/lib/canvas/layout";

import { describe, expect, test } from "vitest";

import {
  canSave,
  INITIAL_SYNC,
  isDirty,
  layoutSyncReducer,
  viewOf,
  type LayoutChange,
  type LayoutSync,
  type LayoutSyncEvent,
} from "./layout-sync";

import {
  EMPTY_LAYOUT,
  moveToChild,
  newChildId,
  ROOT,
} from "@/lib/canvas/layout";

const at = (
  positions: Record<string, { x: number; y: number }>,
): CanvasLayout => ({
  ...EMPTY_LAYOUT,
  positions,
});
const move =
  (id: string, x: number): LayoutChange =>
  (layout) => ({
    ...layout,
    positions: { ...layout.positions, [id]: { x, y: 0 } },
  });
const run = (
  events: readonly LayoutSyncEvent[],
  from: LayoutSync = INITIAL_SYNC,
) => events.reduce(layoutSyncReducer, from);

describe("live layout sync", () => {
  test("shows the server layout, then user edits over it, and saves only once dirty", () => {
    const sync = run([
      { type: "server", layout: at({ account: { x: 0, y: 0 } }), revision: 3 },
    ]);

    expect(canSave(sync)).toBe(false);
    const edited = run([{ type: "edit", change: move("split", 300) }], sync);

    expect(viewOf(edited).positions).toEqual({
      account: { x: 0, y: 0 },
      split: { x: 300, y: 0 },
    });
    expect(canSave(edited)).toBe(true);
  });

  test("a derived change never asks for a save by itself, but rides along with the next edit", () => {
    const derived = run([
      { type: "server", layout: EMPTY_LAYOUT, revision: 0 },
      { type: "derive", change: move("invoice-3", 600) },
    ]);

    expect(isDirty(derived)).toBe(false);
    expect(viewOf(derived).positions["invoice-3"]).toEqual({ x: 600, y: 0 });
    const sent = run(
      [{ type: "edit", change: move("split", 300) }, { type: "saveStarted" }],
      derived,
    );

    expect(sent.saving?.layout.positions).toEqual({
      "invoice-3": { x: 600, y: 0 },
      split: { x: 300, y: 0 },
    });
  });

  test("a stale save (409) replays the user's edit on the newer layout instead of losing either", () => {
    const mine = run([
      { type: "server", layout: at({ account: { x: 0, y: 0 } }), revision: 1 },
      { type: "edit", change: move("split", 300) },
      { type: "saveStarted" },
      { type: "conflict" },
    ]);

    expect(mine.conflict).toBe(true);
    expect(canSave(mine)).toBe(false);
    // Another browser moved the account meanwhile and saved revision 2.
    const rebased = run(
      [
        {
          type: "server",
          layout: at({ account: { x: 50, y: 0 } }),
          revision: 2,
        },
      ],
      mine,
    );

    expect(rebased.conflict).toBe(false);
    expect(canSave(rebased)).toBe(true);
    expect(viewOf(rebased).positions).toEqual({
      account: { x: 50, y: 0 },
      split: { x: 300, y: 0 },
    });
    const saved = run(
      [{ type: "saveStarted" }, { type: "saved", revision: 3 }],
      rebased,
    );

    expect(saved.revision).toBe(3);
    expect(isDirty(saved)).toBe(false);
  });

  test("a snapshot that arrives while a save is in flight is set aside, so the edit is not applied twice", () => {
    const addChild: LayoutChange = (layout) => ({
      ...layout,
      children: [
        ...layout.children,
        {
          id: `child-${layout.children.length + 1}`,
          name: "Events",
          nodeIds: [],
        },
      ],
    });
    const flying = run([
      { type: "server", layout: EMPTY_LAYOUT, revision: 0 },
      { type: "edit", change: addChild },
      { type: "saveStarted" },
    ]);
    const echoed = run(
      [
        {
          type: "server",
          layout: {
            ...EMPTY_LAYOUT,
            children: [{ id: "child-1", name: "Events", nodeIds: [] }],
          },
          revision: 1,
        },
      ],
      flying,
    );

    expect(viewOf(echoed)).toEqual(viewOf(flying));
    const saved = run([{ type: "saved", revision: 1 }], echoed);

    expect(viewOf(saved).children).toHaveLength(1);
    // The same revision arriving later changes nothing.
    expect(
      run([{ type: "server", layout: EMPTY_LAYOUT, revision: 1 }], saved),
    ).toBe(saved);
  });

  test("a new child canvas replayed after a 409 keeps the id the selection points at", () => {
    const base = at({ a: { x: 0, y: 0 }, b: { x: 200, y: 0 } });
    // canvas.tsx `group`: the id is chosen once, then the same move is applied now and on every replay.
    const group = { kind: "new", id: newChildId(), name: "Mine" } as const;
    const change: LayoutChange = (layout) => {
      const moved = moveToChild(layout, ["a"], ROOT, group);

      return moved.ok ? moved.layout : layout;
    };
    const selected = group.id;
    const theirs = moveToChild(base, ["b"], ROOT, {
      kind: "new",
      id: newChildId(),
      name: "Theirs",
    });

    if (!theirs.ok) throw new Error(theirs.reason);
    const replayed = run([
      { type: "server", layout: base, revision: 1 },
      { type: "edit", change },
      { type: "saveStarted" },
      { type: "conflict" },
      { type: "server", layout: theirs.layout, revision: 2 },
    ]);
    const children = viewOf(replayed).children;

    expect(children.map((c) => c.name).sort()).toEqual(["Mine", "Theirs"]);
    expect(children.find((c) => c.id === selected)?.nodeIds).toEqual(["a"]);
    expect(canSave(replayed)).toBe(true);
  });

  test("edits made while a save is in flight stay for the next save", () => {
    const sync = run([
      { type: "server", layout: EMPTY_LAYOUT, revision: 0 },
      { type: "edit", change: move("a", 1) },
      { type: "saveStarted" },
      { type: "edit", change: move("b", 2) },
      { type: "saved", revision: 1 },
    ]);

    expect(sync.edits).toHaveLength(1);
    expect(canSave(sync)).toBe(true);
    expect(viewOf(sync).positions).toEqual({
      a: { x: 1, y: 0 },
      b: { x: 2, y: 0 },
    });
  });

  test("a failed save keeps the edits; edits before the first snapshot wait for it", () => {
    const failed = run([
      { type: "server", layout: EMPTY_LAYOUT, revision: 0 },
      { type: "edit", change: move("a", 1) },
      { type: "saveStarted" },
      { type: "saveFailed", status: 0, reason: "The Zal API is unreachable" },
    ]);

    expect(canSave(failed)).toBe(true);
    expect(failed.failures).toBe(1);
    expect(canSave(run([{ type: "edit", change: move("a", 1) }]))).toBe(false);
  });

  test("a 409 rebases at once on a newer snapshot that arrived during the save, even if the refetch is equal", () => {
    const flying = run([
      { type: "server", layout: at({ n1: { x: 4, y: 0 } }), revision: 4 },
      { type: "edit", change: move("n1", 99) },
      { type: "saveStarted" },
      // Browser B saved revision 5; the stream's refetch lands while this save is in flight.
      {
        type: "server",
        layout: at({ n1: { x: 5, y: 0 }, b: { x: 1, y: 0 } }),
        revision: 5,
      },
    ]);
    const rebased = run([{ type: "conflict" }], flying);

    expect(rebased.conflict).toBe(false);
    expect(rebased.revision).toBe(5);
    expect(canSave(rebased)).toBe(true);
    expect(viewOf(rebased).positions).toEqual({
      n1: { x: 99, y: 0 },
      b: { x: 1, y: 0 },
    });
  });

  test("a save answered after a newer snapshot keeps the newer one", () => {
    const sync = run([
      { type: "server", layout: EMPTY_LAYOUT, revision: 1 },
      { type: "edit", change: move("a", 1) },
      { type: "saveStarted" },
      {
        type: "server",
        layout: at({ a: { x: 1, y: 0 }, b: { x: 2, y: 0 } }),
        revision: 3,
      },
      { type: "saved", revision: 2 },
    ]);

    expect(sync.revision).toBe(3);
    expect(viewOf(sync).positions).toEqual({
      a: { x: 1, y: 0 },
      b: { x: 2, y: 0 },
    });
  });

  test("a permanent refusal stops saving and says why; a transient failure retries", () => {
    const loaded = run([
      { type: "server", layout: EMPTY_LAYOUT, revision: 0 },
      { type: "edit", change: move("a", 1) },
      { type: "saveStarted" },
    ]);

    for (const status of [400, 403, 413, 422]) {
      const refused = run(
        [{ type: "saveFailed", status, reason: "nope" }],
        loaded,
      );

      expect(canSave(refused)).toBe(false);
      expect(refused.refused).toBe("nope");
      expect(isDirty(refused)).toBe(true);
      // The next edit tries once more.
      expect(
        canSave(run([{ type: "edit", change: move("b", 2) }], refused)),
      ).toBe(true);
    }
    for (const status of [0, 401, 429, 500, 503]) {
      const retry = run(
        [{ type: "saveFailed", status, reason: "later" }],
        loaded,
      );

      expect(canSave(retry)).toBe(true);
      expect(retry.refused).toBeUndefined();
    }
  });

  test("an edit that breaks a limit the API enforces is not applied, and says why", () => {
    const loaded = run([{ type: "server", layout: EMPTY_LAYOUT, revision: 0 }]);
    const tooFar = run([{ type: "edit", change: move("a", 2e7) }], loaded);

    expect(isDirty(tooFar)).toBe(false);
    expect(viewOf(tooFar).positions).toEqual({});
    expect(tooFar.rejected).toMatch(/positions\.a\.x/);
    expect(
      run([{ type: "edit", change: move("a", 1) }], tooFar).rejected,
    ).toBeUndefined();
  });
});
