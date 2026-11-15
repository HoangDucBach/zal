// F3: a 409 replays the edit, as canvas.tsx enqueues it, on the newer layout, keeping the other browser's change.
import "./env";
import { expect, test } from "vitest";

import { freshMember } from "./chain";
import { signInReal } from "./session";

import { api } from "@/lib/api/client";
import {
  addDraft,
  EMPTY_LAYOUT,
  newDraftId,
  parseLayout,
  ROOT,
  setPositions,
  type CanvasLayout,
} from "@/lib/canvas/layout";
import {
  canSave,
  INITIAL_SYNC,
  layoutSyncReducer,
  viewOf,
  type LayoutSync,
} from "@/lib/api/layout-sync";

/** One browser: load the API snapshot into the reducer, as useApiLayout's effect does. */
async function load(m: Awaited<ReturnType<typeof freshMember>>) {
  const snap = await api.canvas(m.canvas, m.account.address);

  return layoutSyncReducer(INITIAL_SYNC, {
    type: "server",
    layout:
      snap.layout === null ? EMPTY_LAYOUT : parseLayout(snap.layout.layout),
    revision: snap.layout?.revision ?? 0,
  });
}
/** useApiLayout's save effect for one attempt: returns the next state. */
async function save(
  m: Awaited<ReturnType<typeof freshMember>>,
  token: string,
  s: LayoutSync,
): Promise<LayoutSync> {
  expect(canSave(s)).toBe(true);
  const layout = viewOf(s);

  s = layoutSyncReducer(s, { type: "saveStarted" });
  try {
    const a = await api.putLayout(m.canvas, layout, s.revision, token);

    return layoutSyncReducer(s, { type: "saved", revision: a.layout.revision });
  } catch (e) {
    if ((e as { status?: number }).status === 409)
      return layoutSyncReducer(s, { type: "conflict" });
    throw e;
  }
}
const refetch = async (
  m: Awaited<ReturnType<typeof freshMember>>,
  s: LayoutSync,
) => {
  const snap = await api.canvas(m.canvas, m.account.address);

  return layoutSyncReducer(s, {
    type: "server",
    layout: parseLayout(snap.layout!.layout),
    revision: snap.layout!.revision,
  });
};

test("F3: a 409 replay of a draft placement discards the other browser's saved change", async () => {
  const m = await freshMember();
  const { session } = await signInReal(m);
  const t = session.token;

  // Seed: node n1 at (0,0), saved at revision 1.
  await api.putLayout(
    m.canvas,
    setPositions(EMPTY_LAYOUT, { n1: { x: 0, y: 0 } }),
    0,
    t,
  );

  let a = await load(m);
  let b = await load(m);

  // Browser A drags n1 and saves (revision 1 -> 2).
  a = layoutSyncReducer(a, {
    type: "edit",
    change: (l) => setPositions(l, { n1: { x: 500, y: 500 } }),
  });
  a = await save(m, t, a);
  expect(a.revision).toBe(2);

  // Browser B places a draft, as canvas.tsx `place` does: the edit is a function of whatever layout it lands on.
  const id = newDraftId();

  b = layoutSyncReducer(b, {
    type: "edit",
    change: (current) =>
      addDraft(current, "invoice", { x: 10, y: 10 }, ROOT, id).layout,
  });
  b = await save(m, t, b);
  expect(b.conflict).toBe(true);
  b = await refetch(m, b);
  b = await save(m, t, b);

  const stored = parseLayout(
    (await api.canvas(m.canvas, m.account.address)).layout!.layout,
  ) as CanvasLayout;

  // Intent: A's move of n1 and B's draft both survive.
  expect(stored.positions.n1).toEqual({ x: 500, y: 500 });
  expect(stored.drafts).toEqual([{ id, component: "invoice" }]);
});
