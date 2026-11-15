"use client";

import { useMemo } from "react";
import { useConnection } from "wagmi";

import { useCanvas } from "@/hooks/contracts/canvas";
import { useSelectedAccount } from "@/hooks/use-selected-account";
import { useZalNetwork } from "@/hooks/use-zal-network";
import { buildCanvasGraph } from "@/lib/canvas/graph";
import { useSandboxSession } from "@/lib/sandbox/session";

const NONE: readonly bigint[] = [];

/**
 * The selected canvas (`?account=`, else the wallet's own), read and mapped to nodes and edges. The Canvas and the Overview
 * read the same thing, so a row in the Overview always names a node the Canvas draws.
 */
export function useCanvasView() {
  const connection = useConnection();
  const network = useZalNetwork();
  const session = useSandboxSession();
  const wallet =
    connection.status === "connected" ? connection.address : undefined;
  const selected = useSelectedAccount();
  const canvas = useCanvas({ payload: { network, wallet, selected } });
  const scheduled = session.phase === "ready" ? session.scheduled : NONE;
  const graph = useMemo(
    () =>
      canvas.data === undefined || network === undefined
        ? undefined
        : buildCanvasGraph(canvas.data, {
            vault: network.addresses.vault,
            scheduled,
          }),
    [canvas.data, network, scheduled],
  );

  return { wallet, network, selected, canvas, graph, scheduled, session };
}
