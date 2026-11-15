// The keeper's composition root (ADR 0015): config, chain, indexer client, the tick loop and the HTTP server.

import { serve } from "@hono/node-server";

import { createChain } from "../lib/chain.ts";
import { readConfig } from "../lib/config.ts";
import { createHttp } from "../lib/http.ts";
import { createDueFetcher } from "../lib/indexer.ts";
import { createKeeper } from "../lib/keeper.ts";

const config = readConfig(process.env);
const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ time: new Date().toISOString(), ...event }));

const chain = createChain(config);
const keeper = createKeeper(
  {
    fetchDue: createDueFetcher(config.apiUrl, config.chainId, config.batch),
    chainTime: chain.chainTime,
    simulateRun: chain.simulateRun,
    sendRun: chain.sendRun,
    now: Date.now,
    log,
  },
  { backoffBaseMs: config.backoffBaseMs, backoffMaxMs: config.backoffMaxMs, historySize: 100 },
);

const server = serve({
  fetch: createHttp({ keeper, address: chain.address, gasBalance: chain.gasBalance, tickMs: config.tickMs, webOrigins: config.webOrigins, now: Date.now }).fetch,
  port: config.port,
  hostname: "0.0.0.0",
});

let stopping = false;
async function loop() {
  while (!stopping) {
    await keeper.tick();
    await new Promise((resolve) => setTimeout(resolve, config.tickMs));
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
    server.close();
    log({ event: "stopping", signal });
  });
}

log({ event: "started", keeper: chain.address, chainId: config.chainId, api: config.apiUrl, tickMs: config.tickMs });
await loop();
