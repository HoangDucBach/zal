// A Viewer is read-only (canvas.tsx: "A viewer reads the canvas and changes nothing, its layout included"), and the
// API enforces the same table (lib/canvas/layout-access.ts).
import { expect, test } from "vitest";

import { call, freshMember, send, waitForIndexed } from "./chain";
import { signInReal } from "./session";

import { api } from "@/lib/api/client";
import { EMPTY_LAYOUT, setPositions } from "@/lib/canvas/layout";

test("a Viewer cannot rewrite the shared canvas layout through the API", async () => {
  const club = await freshMember();
  const viewer = await freshMember();

  await waitForIndexed(
    await send(
      club,
      club.canvas,
      call("setMember", [viewer.account.address, 1]),
    ),
  );
  const admin = await signInReal(club);
  const adminLayout = setPositions(EMPTY_LAYOUT, {
    account: { x: 111, y: 222 },
  });
  const first = await api.putLayout(
    club.canvas,
    adminLayout,
    0,
    admin.session.token,
  );
  const v = await signInReal(viewer);
  let outcome: string;

  try {
    const r = await api.putLayout(
      club.canvas,
      setPositions(EMPTY_LAYOUT, { account: { x: -9999, y: -9999 } }),
      first.layout.revision,
      v.session.token,
    );

    outcome = `200 revision ${r.layout.revision} updatedBy ${r.layout.updatedBy}`;
  } catch (e) {
    outcome = `refused: ${(e as Error).message}`;
  }
  const after = await api.canvas(club.canvas, club.account.address);

  expect(outcome).toMatch(/^refused: .*approver or admin/);
  expect(after.layout?.revision).toBe(first.layout.revision);
  expect(after.layout?.layout).toMatchObject({
    positions: { account: { x: 111, y: 222 } },
  });
});
