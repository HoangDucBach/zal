// The sandbox chain's transport: every JSON-RPC request is answered by the in-browser engine.

import { custom, type Transport } from "viem";

import { loadRuntime } from "./runtime-loader";

export function sandboxTransport(): Transport {
  return custom(
    {
      async request({ method, params }: { method: string; params?: unknown }) {
        const runtime = await loadRuntime();

        return runtime.request(method, params);
      },
    },
    { key: "sandbox", name: "Zal Sandbox", retryCount: 0 },
  );
}
