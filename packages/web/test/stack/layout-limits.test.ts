// F2: a layout the API refuses for good is never retried: the client checks the API's limits first, and a
// permanent refusal stops saving and says why.
import "./env";
import { expect, test } from "vitest";

import { freshMember } from "./chain";
import { signInReal } from "./session";

import { api } from "@/lib/api/client";
import {
  canSave,
  INITIAL_SYNC,
  layoutSyncReducer,
  viewOf,
  type LayoutSync,
} from "@/lib/api/layout-sync";
import {
  CHILD_NAME_MAX,
  EMPTY_LAYOUT,
  layoutProblem,
  renameChild,
  type CanvasLayout,
  type ChildId,
} from "@/lib/canvas/layout";
import { ApiError } from "@/lib/query/errors";

const CHILD = "child-1" as ChildId;
const base: CanvasLayout = {
  ...EMPTY_LAYOUT,
  children: [{ id: CHILD, name: "Ops", nodeIds: [] }],
};
const named = (name: string): CanvasLayout => ({
  ...base,
  children: [{ id: CHILD, name, nodeIds: [] }],
});

/** useApiLayout's save effect for one attempt, failures reported the way the hook reports them. */
async function save(
  account: `0x${string}`,
  token: string,
  sync: LayoutSync,
): Promise<LayoutSync> {
  const layout = viewOf(sync);
  const started = layoutSyncReducer(sync, { type: "saveStarted" });

  try {
    const answer = await api.putLayout(
      account,
      layout,
      started.revision,
      token,
    );

    return layoutSyncReducer(started, {
      type: "saved",
      revision: answer.layout.revision,
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;

    return layoutSyncReducer(started, {
      type: "saveFailed",
      status: error.status,
      reason: error.message,
    });
  }
}

test("F2: a long child-canvas name is accepted by the UI logic and refused by the API, and the client retries it forever", async () => {
  const m = await freshMember();
  const { session } = await signInReal(m);
  const long = "x".repeat(CHILD_NAME_MAX + 1);

  // What GatePanel's Rename calls: the name is cut to the API's limit, and the edit saves.
  let s = layoutSyncReducer(INITIAL_SYNC, {
    type: "server",
    layout: base,
    revision: 0,
  });

  s = layoutSyncReducer(s, {
    type: "edit",
    change: (l) => renameChild(l, CHILD, long),
  });
  expect(canSave(s)).toBe(true);
  s = await save(m.canvas, session.token, s);
  expect(s.edits.length).toBe(0);
  const stored = (await api.canvas(m.canvas, m.account.address)).layout
    ?.layout as CanvasLayout;

  expect(stored.children[0]?.name).toBe("x".repeat(CHILD_NAME_MAX));

  // Any other edit past the API's limits is not applied, and the user is told why: no request is ever sent.
  const before = s;

  s = layoutSyncReducer(s, { type: "edit", change: () => named(long) });
  expect(s.edits.length).toBe(0);
  expect(viewOf(s)).toEqual(viewOf(before));
  expect(s.rejected).toMatch(/name/);

  // The client's limits are the API's: one past the limit is refused by both, the limit itself by neither.
  expect(layoutProblem(named(long))).toBeDefined();
  await expect(
    api.putLayout(m.canvas, named(long), s.revision, session.token),
  ).rejects.toMatchObject({ status: 400 });
  expect(layoutProblem(named("y".repeat(CHILD_NAME_MAX)))).toBeUndefined();

  // A permanent refusal the client could not foresee (here: not a member) stops saving and says why, once.
  const outsider = await freshMember();
  const signedOut = await signInReal(outsider);
  let o = layoutSyncReducer(INITIAL_SYNC, {
    type: "server",
    layout: EMPTY_LAYOUT,
    revision: 0,
  });

  o = layoutSyncReducer(o, { type: "edit", change: () => named("Ops") });
  o = await save(m.canvas, signedOut.session.token, o);
  expect(o.refused).toMatch(/approver or admin/);
  expect(canSave(o)).toBe(false);
});
