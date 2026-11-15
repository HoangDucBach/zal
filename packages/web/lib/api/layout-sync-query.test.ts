// useApiLayout feeds the reducer from an effect on the query's result. This drives the real reducer from the real
// TanStack QueryObserver (same select, same structural sharing) with the stream/409 ordering of a slow save, and
// feeds it only when `data` changes identity: the reducer must recover even when the post-409 refetch is equal.
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, test } from "vitest";

import {
  canSave,
  INITIAL_SYNC,
  layoutSyncReducer,
  type LayoutSync,
} from "@/lib/api/layout-sync";
import { parseLayout, setPositions } from "@/lib/canvas/layout";

const snapshotAt = (revision: number) => ({
  canvas: { any: "state" },
  saved: {
    layout: {
      version: 1,
      positions: { n1: { x: revision, y: 0 } },
      children: [],
      drafts: [],
      links: [],
    },
    revision,
    updatedAt: "t",
    updatedBy: "0x0",
  },
  source: "api",
});

test("F5: a snapshot that arrives while a save is in flight is dropped, and the post-409 refetch is deep-equal, so the client never leaves 'conflict'", async () => {
  let serverRevision = 4;
  const client = new QueryClient();
  const observer = new QueryObserver(client, {
    queryKey: ["zal", 31337, "canvas", "0xw"],
    queryFn: async () => snapshotAt(serverRevision), // fresh object each fetch, like a JSON response
    select: (s: ReturnType<typeof snapshotAt>) => s.saved, // selectSaved in hooks/use-canvas-layout.ts
  });
  let sync: LayoutSync = INITIAL_SYNC;
  let lastData: unknown;
  let effectRuns = 0;

  observer.subscribe((result) => {
    // useEffect(..., [scope, data, dispatch]): runs only when `data` changes identity.
    if (result.data === undefined || result.data === lastData) return;
    lastData = result.data;
    effectRuns++;
    sync = layoutSyncReducer(sync, {
      type: "server",
      layout: parseLayout(result.data.layout),
      revision: result.data.revision,
    });
  });
  await client.fetchQuery({
    queryKey: ["zal", 31337, "canvas", "0xw"],
    queryFn: async () => snapshotAt(serverRevision),
  });
  await observer.refetch();
  expect(sync.revision).toBe(4);

  // The user edits and a save starts (PUT carries revision 4).
  sync = layoutSyncReducer(sync, {
    type: "edit",
    change: (l) => setPositions(l, { n1: { x: 99, y: 9 } }),
  });
  sync = layoutSyncReducer(sync, { type: "saveStarted" });

  // Meanwhile browser B saved revision 5; the stream's `layout` event refetches the canvas: the snapshot arrives now.
  serverRevision = 5;
  await observer.refetch();

  // The save answers 409 -> useApiLayout dispatches `conflict`, then invalidates the canvas query.
  sync = layoutSyncReducer(sync, { type: "conflict" });
  await client.invalidateQueries({ queryKey: ["zal", 31337, "canvas"] });
  await new Promise((r) => setTimeout(r, 50));

  // Intent: the client takes revision 5, replays its edit and can save again.
  // The post-409 refetch was deep-equal, so no new `data` reached the reducer: it rebased on the snapshot it set aside.
  expect(effectRuns).toBe(2);
  expect(sync.revision).toBe(5);
  expect(canSave(sync)).toBe(true);
});
