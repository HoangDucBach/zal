// F8 to F11: a wallet opens a canvas it is a member of (open question 5). Membership, the transaction target and
// the pending op it confirms all come from the chain; a tampered API changes none of them.
import { afterAll, beforeAll, expect, test } from "vitest";
import { type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  call,
  dep,
  freshMember,
  mint,
  publicClient,
  send,
  usdcAbi,
  waitForIndexed,
} from "./chain";
import { renderHooks, startProxy } from "./react-harness";

import { canvasAccountAbi } from "@/contracts/abis";

let club: Awaited<ReturnType<typeof freshMember>>;
let approver: Awaited<ReturnType<typeof freshMember>>;
let viewer: Awaited<ReturnType<typeof freshMember>>;
let stranger: Awaited<ReturnType<typeof freshMember>>;
/** Where the op pays out on the chain, and the recipient a tampered API claims instead. */
const payee = privateKeyToAccount(generatePrivateKey()).address;
const claimed = privateKeyToAccount(generatePrivateKey()).address;
let opId: bigint;
/** One proxy for the file: the client reads its API URL once, when its module first loads. */
let tamper: (path: string, json: any) => any = (_, json) => json;
let proxy: Awaited<ReturnType<typeof startProxy>>;

afterAll(() => proxy.close());

beforeAll(async () => {
  proxy = await startProxy((path, json) => tamper(path, json));
  process.env.NEXT_PUBLIC_ZAL_API_URL = proxy.url;
  [club, approver, viewer, stranger] = await Promise.all([
    freshMember(),
    freshMember(),
    freshMember(),
    freshMember(),
  ]);
  await send(
    club,
    club.canvas,
    call("setMember", [approver.account.address, 2]),
  );
  await send(club, club.canvas, call("setMember", [viewer.account.address, 1]));
  await send(club, club.canvas, call("setPolicy", [2, 0n]));
  await mint(club, club.canvas, 5_000_000n);
  opId =
    (await publicClient.readContract({
      address: club.canvas,
      abi: canvasAccountAbi,
      functionName: "opCount",
    })) + 1n;
  await waitForIndexed(
    await send(
      club,
      club.canvas,
      call("submit", [call("withdraw", [payee, 2_000_000n])]),
    ),
  );
}, 120_000);

test("F8: the switcher lists the canvases the chain confirms, with the chain's role, and drops one a tampered API adds", async () => {
  tamper = (path, json) =>
    path.includes("/accounts") && path.startsWith("/v1/wallets/")
      ? {
          ...json,
          accounts: [
            ...json.accounts,
            {
              address: stranger.canvas.toLowerCase(),
              role: "admin",
              acted: true,
            },
          ],
        }
      : json;

  const { api } = await import("@/lib/api/client");
  const { useMemberships, useOwnCanvas } =
    await import("@/hooks/contracts/memberships");
  const { liveNetwork } = await import("@/config/chains");

  if (liveNetwork.status !== "ready") throw new Error("no live network");
  const wallet = approver.account.address;
  const served = await api.walletAccounts(wallet);

  // The API's answer includes the injected canvas...
  expect(served.accounts.map((a) => a.address)).toContain(stranger.canvas);
  const h = await renderHooks(wallet, () => ({
    own: useOwnCanvas({ payload: { network: liveNetwork, wallet } }),
    acted: useMemberships({
      payload: { network: liveNetwork, wallet, group: "acted", enabled: true },
    }),
    others: useMemberships({
      payload: {
        network: liveNetwork,
        wallet,
        group: "addedByOthers",
        enabled: true,
      },
    }),
  }));
  const [own, acted, others] = (await Promise.all(
    h.queryClient
      .getQueryCache()
      .findAll()
      .map((q) => q.fetch()),
  )) as [
    { account: Address; role: string; own: boolean },
    {
      pages: { entries: { account: Address; role: string; own: boolean }[] }[];
    },
    {
      pages: { entries: { account: Address; role: string; own: boolean }[] }[];
    },
  ];
  const row = (m: { account: Address; role: string; own: boolean }) => [
    m.account,
    m.role,
    m.own,
  ];

  tamper = (_, json) => json;
  // ...the list keeps only what roleOf confirms: the wallet's own canvas first, then the club as approver, which the
  // approver never acted on, so it sits under "added by others".
  expect(row(own)).toEqual([approver.canvas, "admin", true]);
  expect(acted.pages.flatMap((p) => p.entries.map(row))).toEqual([]);
  expect(others.pages.flatMap((p) => p.entries.map(row))).toEqual([
    [club.canvas, "approver", false],
  ]);
});

test("F9: a selected canvas is read only after the chain confirms the wallet's role there", async () => {
  const { useCanvasSnapshot } = await import("@/hooks/contracts/canvas");
  const { liveNetwork } = await import("@/config/chains");

  if (liveNetwork.status !== "ready") throw new Error("no live network");
  const snapshotFor = async (wallet: Address, selected: Address) => {
    const h = await renderHooks(wallet, () =>
      useCanvasSnapshot({
        payload: { network: liveNetwork, wallet, selected },
      }),
    );

    return h.queryClient.getQueryCache().findAll()[0]!.fetch() as Promise<{
      access: { account: Address; role: string };
      canvas: { account: { address: Address; myRole: string } };
    }>;
  };
  const opened = await snapshotFor(approver.account.address, club.canvas);

  expect(opened.access).toMatchObject({
    account: club.canvas,
    role: "approver",
  });
  expect(opened.canvas.account).toMatchObject({
    address: club.canvas,
    myRole: "approver",
  });
  await expect(
    snapshotFor(stranger.account.address, club.canvas),
  ).rejects.toThrow("Not a member of this canvas");
});

test("F10: Confirm signs the op the chain stores, not the one a tampered API describes, on the selected canvas", async () => {
  tamper = (path, json) =>
    path.includes("/canvas") && json?.canvas?.account?.ops !== undefined
      ? {
          ...json,
          canvas: {
            ...json.canvas,
            account: {
              ...json.canvas.account,
              ops: json.canvas.account.ops.map(
                (op: { call: Record<string, unknown> }) => ({
                  ...op,
                  amount: "1",
                  call: { ...op.call, to: claimed.toLowerCase(), amount: "1" },
                }),
              ),
            },
          },
        }
      : json;

  const { useCanvas } = await import("@/hooks/contracts/canvas");
  const { useChainOp } = await import("@/hooks/contracts/chain-op");
  const { useConfirmOp } = await import("@/hooks/contracts/canvas-account");
  const { opDisagreement } = await import("@/lib/canvas/ops");
  const { liveNetwork } = await import("@/config/chains");

  if (liveNetwork.status !== "ready") throw new Error("no live network");
  await publicClient.request({
    method: "anvil_impersonateAccount" as never,
    params: [approver.account.address] as never,
  });
  const wallet = approver.account.address;
  const h = await renderHooks(
    wallet,
    () => ({
      canvas: useCanvas({
        payload: { network: liveNetwork, wallet, selected: club.canvas },
      }),
      op: useChainOp({
        payload: { network: liveNetwork, account: club.canvas, wallet, opId },
      }),
      confirm: useConfirmOp({ network: liveNetwork }),
    }),
    club.canvas,
  );
  const [snapshot, onChain] = (await Promise.all(
    h.queryClient
      .getQueryCache()
      .findAll()
      .map((q) => q.fetch()),
  )) as [
    { canvas: { account: { ops: { opId: bigint; call: unknown }[] } } },
    {
      op: { call: { fn: string; to: Address; amount: bigint }; amount: bigint };
      invoice: undefined;
    },
  ];
  const served = snapshot.canvas.account.ops.find((o) => o.opId === opId);

  // The API claims the op pays 0.000001 USDC to `claimed`; the chain stores 2 USDC to `payee`.
  expect(served?.call).toMatchObject({ to: claimed, amount: 1n });
  expect(onChain.op.call).toEqual({
    fn: "withdraw",
    to: payee,
    amount: 2_000_000n,
  });
  expect(
    opDisagreement(
      { op: served as never, invoice: undefined },
      onChain as never,
    ),
  ).toEqual(["call", "amount"]);

  const before = await publicClient.readContract({
    address: dep.usdc,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [payee],
  });
  const result = await h.get().confirm.mutateAsync({ args: [opId] });

  tamper = (_, json) => json;
  // The confirmation went to the selected canvas, which the chain confirmed, and ran the chain's op.
  expect(result.receipt.to?.toLowerCase()).toBe(club.canvas.toLowerCase());
  expect(
    (await publicClient.readContract({
      address: dep.usdc,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [payee],
    })) - before,
  ).toBe(2_000_000n);
});

test("F11: a viewer's confirmation stops before the wallet prompt, with the rule", async () => {
  const { useConfirmOp } = await import("@/hooks/contracts/canvas-account");
  const { liveNetwork } = await import("@/config/chains");

  if (liveNetwork.status !== "ready") throw new Error("no live network");
  const h = await renderHooks(
    viewer.account.address,
    () => useConfirmOp({ network: liveNetwork }),
    club.canvas,
  );
  const sent = await publicClient.getTransactionCount({
    address: viewer.account.address,
  });

  await expect(h.get().mutateAsync({ args: [opId] })).rejects.toThrow(
    "Approvers and admins only",
  );
  expect(
    await publicClient.getTransactionCount({ address: viewer.account.address }),
  ).toBe(sent);
});
