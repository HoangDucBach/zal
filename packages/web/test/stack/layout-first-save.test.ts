// F1: two browsers of the same account both start with no saved layout, and each saves one edit.
import "./env";
import { expect, test } from "vitest";

import { freshMember } from "./chain";
import { signInReal } from "./session";

import { api } from "@/lib/api/client";
import { EMPTY_LAYOUT } from "@/lib/canvas/layout";
import { INITIAL_SYNC, layoutSyncReducer, viewOf } from "@/lib/api/layout-sync";
import { setPositions } from "@/lib/canvas/layout";

test("F1: second first-save overwrites the first instead of 409", async () => {
  const m = await freshMember();
  const { session } = await signInReal(m);
  const seen = await api.canvas(m.canvas, m.account.address);

  expect(seen.layout).toBeNull(); // both browsers load this

  // Drive the real reducer the way useApiLayout does, for each browser.
  const browser = (name: string) => {
    let s = layoutSyncReducer(INITIAL_SYNC, {
      type: "server",
      layout: EMPTY_LAYOUT,
      revision: 0,
    });

    s = layoutSyncReducer(s, {
      type: "edit",
      change: (l) => setPositions(l, { [name]: { x: 1, y: 1 } }),
    });
    s = layoutSyncReducer(s, { type: "saveStarted" });

    return s;
  };
  const a = browser("from-browser-A");
  const b = browser("from-browser-B");

  const ra = await api.putLayout(
    m.canvas,
    viewOf(a),
    a.revision,
    session.token,
  );

  expect(ra.layout.revision).toBe(1);
  let rb: unknown;

  try {
    rb = await api.putLayout(m.canvas, viewOf(b), b.revision, session.token);
  } catch (e) {
    rb = e;
  }
  const after = await api.canvas(m.canvas, m.account.address);

  // Intent: B must get 409 (and replay on A's layout); A's edit must survive.
  expect(rb).toMatchObject({ status: 409 });
  expect(
    Object.keys((after.layout!.layout as { positions: object }).positions),
  ).toContain("from-browser-A");
});

test("F1b: the server does enforce revision 0 when it is sent", async () => {
  const { apiRequest } = await import("@/lib/api/client");
  const { layoutPutResponseSchema } = await import("@/lib/api/wire");
  const m = await freshMember();
  const { session } = await signInReal(m);
  const put = (revision?: number) =>
    apiRequest(`/v1/accounts/${m.canvas.toLowerCase()}/layout`, {
      method: "PUT",
      token: session.token,
      body: {
        layout: {
          version: 1,
          positions: {},
          children: [],
          drafts: [],
          links: [],
        },
        ...(revision === undefined ? {} : { revision }),
      },
      schema: layoutPutResponseSchema,
    });

  await put(0);
  await expect(put(0)).rejects.toMatchObject({ status: 409 });
});
