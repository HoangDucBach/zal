// With the API unreachable, a confirmed write should not wait on it.
import { createServer } from "node:net";

import { afterEach, expect, test, vi } from "vitest";

/** The client reads its API URL when its module loads. */
async function clientAt(url: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_ZAL_API_URL", url);

  return import("@/lib/api/client");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

test("G1: waitForIndexed blocks a confirmed write for 8s when the API is down", async () => {
  const { waitForIndexed, api } = await clientAt("http://127.0.0.1:9"); // refused at once

  await expect(api.pool()).rejects.toMatchObject({ status: 0 });
  const t0 = Date.now();

  await waitForIndexed(1n);
  expect(Date.now() - t0).toBeLessThan(1_000);
}, 30_000);

test("G1b: an API that accepts the connection and never answers holds a write for one probe at most", async () => {
  const sockets: import("node:net").Socket[] = [];
  const server = createServer((socket) => void sockets.push(socket));

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as import("node:net").AddressInfo;
  const { waitForIndexed } = await clientAt(`http://127.0.0.1:${port}`);
  const t0 = Date.now();

  await waitForIndexed(1n);
  const waited = Date.now() - t0;

  for (const socket of sockets) socket.destroy();
  server.close();
  expect(waited).toBeLessThan(1_000);
}, 30_000);
