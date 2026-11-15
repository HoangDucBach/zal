// G3: an event indexed between the page's snapshot and the stream's `ready` is never sent, so `ready` catches up.
import "./env";
import { expect, test } from "vitest";
import { createWalletClient, http } from "viem";

import { freshMember, chain, publicClient } from "./chain";

import { canvasAccountAbi as canvasAbi } from "@/contracts/abis";
import { api } from "@/lib/api/client";
import { keysForStreamEvent, parseStreamEvent } from "@/lib/api/stream";

async function readStream(url: string, ms: number) {
  const events: { event: string; data: string; id: string }[] = [];
  const abort = new AbortController();

  setTimeout(() => abort.abort(), ms);
  const res = await fetch(url, {
    signal: abort.signal,
    headers: { Accept: "text/event-stream" },
  });
  let buf = "";

  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += new TextDecoder().decode(chunk);
      let i;

      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);

        buf = buf.slice(i + 2);
        const f = (k: string) =>
          raw
            .split("\n")
            .find((l) => l.startsWith(k + ":"))
            ?.slice(k.length + 1)
            .trim() ?? "";

        if (f("event"))
          events.push({ event: f("event"), data: f("data"), id: f("id") });
      }
    }
  } catch {
    /* aborted */
  }

  return events;
}

test("G3: first `ready` is not followed by any catch-up", async () => {
  const m = await freshMember();

  await new Promise((r) => setTimeout(r, 3000)); // let AccountCreated index
  const snap = await api.canvas(m.canvas, m.account.address); // the page's snapshot
  const asOf = snap.asOf.block;
  // A transaction on the account lands after the snapshot (the page has not opened its stream yet).
  const wallet = createWalletClient({
    account: m.account,
    chain,
    transport: http(),
  });
  const hash = await wallet.writeContract({
    address: m.canvas,
    abi: canvasAbi,
    functionName: "setBudget",
    args: [1n, 1000n, 86400n],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  await new Promise((r) => setTimeout(r, 3000)); // indexer catches up
  const later = await api.canvas(m.canvas, m.account.address);

  expect(receipt.blockNumber).toBeGreaterThan(BigInt(asOf));
  expect(later.canvas.account.budgets.length).toBeGreaterThan(
    snap.canvas.account.budgets.length,
  );

  // The client opens its stream now (use-live-updates.ts: first connect has no lastEventId).
  const events = await readStream(
    `http://localhost:42069/v1/stream?account=${m.canvas.toLowerCase()}`,
    3000,
  );

  const parsed = events
    .map((e) => parseStreamEvent(e.event, e.data, e.id))
    .filter(Boolean);
  // use-live-updates passes the oldest block the page's snapshots were read at: here, the page's snapshot.
  const keys = parsed.flatMap((e) => keysForStreamEvent(31337, e!, asOf));

  // Intent: the page ends up showing the budget (an invalidation of the canvas, or the feed event).
  expect(keys.length).toBeGreaterThan(0);
});

test("G3b: a page whose snapshot is already at the stream's head refetches nothing on `ready`", async () => {
  const m = await freshMember();

  await new Promise((r) => setTimeout(r, 3000)); // let AccountCreated index
  const events = await readStream(
    `http://localhost:42069/v1/stream?account=${m.canvas.toLowerCase()}`,
    1500,
  );
  const ready = events
    .map((e) => parseStreamEvent(e.event, e.data, e.id))
    .find((e) => e?.type === "ready");
  const snap = await api.canvas(m.canvas, m.account.address); // read after `ready`: at or past its head

  expect(ready).toBeDefined();
  expect(keysForStreamEvent(31337, ready!, snap.asOf.block)).toEqual([]);
});
