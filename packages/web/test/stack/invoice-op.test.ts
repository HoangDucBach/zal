// The op row for an invoice op names only the invoice id; what that invoice is (face value, who is paid) is drawn in the
// same Inspector panel. Everything next to Confirm must be the chain's, so a tampered API invoice cannot misstate
// what Confirm moves.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { afterAll, expect, test } from "vitest";
import { type Address } from "viem";

import {
  balance,
  call,
  freshMember,
  mint,
  publicClient,
  send,
  waitForIndexed,
  type Member,
} from "./chain";
import { renderHooks, startProxy } from "./react-harness";

import { canvasAccountAbi } from "@/contracts/abis";
import { SelectedAccountScope } from "@/hooks/use-selected-account";
import { formatUsdc } from "@/lib/format";

let proxy: Awaited<ReturnType<typeof startProxy>>;
let tamper: (path: string, json: any) => any = (_, json) => json;

afterAll(() => proxy?.close());

async function returned(
  from: Member,
  to: Address,
  fn: string,
  args: readonly unknown[],
) {
  const { result } = await publicClient.simulateContract({
    account: from.account.address,
    address: to,
    abi: canvasAccountAbi,
    functionName: fn as never,
    args: args as never,
  });

  await send(from, to, call(fn, args));

  return result as unknown as bigint;
}

const opCount = (account: Address) =>
  publicClient.readContract({
    address: account,
    abi: canvasAccountAbi,
    functionName: "opCount",
  });

test("Confirm on 'Pay invoice #N' pays the chain's invoice, and the panel shows the chain's invoice, not the API's", async () => {
  proxy = await startProxy((path, json) => tamper(path, json));
  process.env.NEXT_PUBLIC_ZAL_API_URL = proxy.url;
  const [club, approver, seller] = await Promise.all([
    freshMember(),
    freshMember(),
    freshMember(),
  ]);
  const FACE = 4_000_000_000n; // 4,000 USDC on the chain
  const SHOWN = 1_000_000n; // 1 USDC, what the tampered API says

  await send(
    club,
    club.canvas,
    call("setMember", [approver.account.address, 2]),
  );
  await send(club, club.canvas, call("setPolicy", [2, 0n]));
  await mint(club, club.canvas, 5_000_000_000n);
  const relId = await returned(seller, seller.canvas, "proposeRelationship", [
    club.canvas,
    1,
    0n,
  ]);

  await send(club, club.canvas, call("acceptRelationship", [relId]));
  const now = Number((await publicClient.getBlock()).timestamp);
  const invoiceId = await returned(seller, seller.canvas, "issueInvoice", [
    relId,
    FACE,
    BigInt(now + 30 * 86_400),
    `0x${"11".repeat(32)}`,
  ]);

  // Approve (2 signatures), then the admin submits the payment; it waits for the approver.
  await send(
    club,
    club.canvas,
    call("submit", [call("approveInvoice", [invoiceId, 0n])]),
  );
  await send(
    approver,
    club.canvas,
    call("confirm", [await opCount(club.canvas)]),
  );
  const submitted = await send(
    club,
    club.canvas,
    call("submit", [call("payInvoice", [invoiceId])]),
  );
  const opId = await opCount(club.canvas);

  await waitForIndexed(submitted);

  // The API lies about the invoice only. The op it serves is left exactly as the chain has it.
  tamper = (path, json) =>
    path.includes("/canvas") && Array.isArray(json?.canvas?.invoices)
      ? {
          ...json,
          canvas: {
            ...json.canvas,
            invoices: json.canvas.invoices.map((inv: any) =>
              inv.id === String(invoiceId)
                ? { ...inv, faceValue: String(SHOWN) }
                : inv,
            ),
          },
        }
      : json;

  const { useCanvas } = await import("@/hooks/contracts/canvas");
  const { useChainInvoice, useChainOp } =
    await import("@/hooks/contracts/chain-op");
  const { useConfirmOp } = await import("@/hooks/contracts/canvas-account");
  const { opDisagreement } = await import("@/lib/canvas/ops");
  const { buildCanvasGraph } = await import("@/lib/canvas/graph");
  const { Inspector } = await import("@/components/canvas/inspector");
  const { liveNetwork } = await import("@/config/chains");

  if (liveNetwork.status !== "ready") throw new Error("no live network");
  const network = liveNetwork;
  const wallet = approver.account.address;

  await publicClient.request({
    method: "anvil_impersonateAccount" as never,
    params: [wallet] as never,
  });
  // The queries the Inspector reads, loaded before the server render (which runs no query).
  const h = await renderHooks(
    wallet,
    () => ({
      canvas: useCanvas({
        payload: { network, wallet, selected: club.canvas },
      }),
      op: useChainOp({
        payload: { network, account: club.canvas, wallet, opId },
      }),
      invoice: useChainInvoice({ payload: { network, id: invoiceId } }),
      confirm: useConfirmOp({ network }),
    }),
    club.canvas,
  );
  const [snapshot, onChain] = (await Promise.all(
    h.queryClient
      .getQueryCache()
      .findAll()
      .map((q) => q.fetch()),
  )) as [any, any];
  const state = snapshot.canvas;
  const servedOp = state.account.ops.find((o: any) => o.opId === opId);
  const shownInvoice = state.invoices.find((i: any) => i.id === invoiceId);

  expect(shownInvoice.faceValue).toBe(SHOWN);
  expect(onChain.op.amount).toBe(FACE);
  expect(onChain.invoice.faceValue).toBe(FACE);
  expect(
    opDisagreement({ op: servedOp, invoice: shownInvoice }, onChain),
  ).toEqual(["invoice face value"]);

  // The real Inspector for that invoice node, with every query already loaded.
  const graph = buildCanvasGraph(state, {
    vault: network.addresses.vault,
    scheduled: [],
  });
  const node = graph.nodes.find(
    (n: any) => n.data.kind === "invoice" && n.data.invoice.id === invoiceId,
  )!;
  const html = renderToString(
    createElement(
      WagmiProvider,
      { config: h.config, reconnectOnMount: false } as never,
      createElement(
        QueryClientProvider,
        { client: h.queryClient },
        createElement(
          SelectedAccountScope,
          { selected: club.canvas },
          createElement(Inspector, {
            network,
            state,
            subject: { kind: "node", data: node.data as never },
            onClose: () => undefined,
            onDone: () => undefined,
          }),
        ),
      ),
    ),
  );
  const text = html
    .replace(/<!-- -->/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const before = await balance(club.canvas);

  await h.get().confirm.mutateAsync({ args: [opId] });
  tamper = (_, json) => json;
  const moved = before - (await balance(club.canvas));

  // What the intent requires: the amount Confirm moves is the amount the panel shows, and the API's figure is named.
  expect(moved).toBe(FACE);
  expect(text).toContain(`Face value ${formatUsdc(moved)} USDC`);
  expect(text).toContain(`Amount ${formatUsdc(moved)} USDC`);
  expect(text).toContain(`face value ${formatUsdc(moved)} USDC`);
  expect(text).not.toContain(`${formatUsdc(SHOWN)} USDC`);
  expect(text).toContain("API differs (face value) · chain shown");
  expect(text).toContain("API differs (invoice face value) · chain shown");
  expect(text).toContain("Confirm");
});
