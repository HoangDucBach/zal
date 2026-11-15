// Runs the web's real hooks without a DOM: render once on the server to get the hook results, then drive the
// query/mutation by hand. Used with a proxy that sits between the web client and the real API.
import "./env";
import type { AddressInfo } from "node:net";
import type { Address } from "viem";

import http from "node:http";

import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, WagmiProvider, http as wagmiHttp } from "wagmi";
import { connect } from "wagmi/actions";
import { mock } from "wagmi/connectors";

import { chain } from "./chain";

import { SelectedAccountScope } from "@/hooks/use-selected-account";

/** Forwards to the real API; `tamper` may rewrite a JSON response (a malicious or buggy API). */
export async function startProxy(tamper: (path: string, json: any) => any) {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];

    for await (const c of req) chunks.push(c as Buffer);
    const upstream = await fetch(`http://localhost:42069${req.url}`, {
      method: req.method,
      headers: {
        accept: "application/json",
        ...(chunks.length ? { "content-type": "application/json" } : {}),
        ...(req.headers.authorization
          ? { authorization: req.headers.authorization }
          : {}),
      },
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const text = await upstream.text();
    let body = text;

    try {
      body = JSON.stringify(tamper(req.url ?? "", JSON.parse(text)));
    } catch {
      /* not json */
    }
    res.writeHead(upstream.status, {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(body);
  });

  await new Promise<void>((r) => server.listen(0, r));

  return {
    url: `http://localhost:${(server.address() as AddressInfo).port}`,
    close: () => server.close(),
  };
}

/** `selected`: the canvas `?account=` would request, as the app shell sets it. */
export async function renderHooks<T>(
  user: Address,
  useProbe: () => T,
  selected?: Address,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const config = createConfig({
    chains: [chain],
    connectors: [mock({ accounts: [user] })],
    transports: { [chain.id]: wagmiHttp() },
    ssr: true,
  });

  await connect(config, { connector: config.connectors[0]! });
  let result!: T;
  const Probe = () => {
    result = useProbe();

    return null;
  };

  renderToString(
    createElement(
      WagmiProvider,
      { config, reconnectOnMount: false } as never,
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          SelectedAccountScope,
          { selected },
          createElement(Probe) as ReactNode,
        ),
      ),
    ),
  );

  return { queryClient, config, get: () => result };
}
