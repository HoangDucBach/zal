// GET /v1/wallets/:wallet/accounts and the switcher list built from it. Anyone can add any wallet as a member of as
// many canvases as they like, so the route pages and the switcher verifies only the page it shows.
import { expect, test } from "vitest";
import { createWalletClient, http, keccak256, toHex, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { API } from "./env";
import {
  call,
  chain,
  dep,
  freshMember,
  publicClient,
  send,
  waitForIndexed,
} from "./chain";
import { renderHooks } from "./react-harness";

import { zalFactoryAbi } from "@/contracts/abis";

const get = async (path: string) => {
  const r = await fetch(`${API}${path}`);

  return { status: r.status, body: (await r.json()) as any };
};

test("route basics: role changes, removal, address case", async () => {
  const club = await freshMember();
  const w = privateKeyToAccount(generatePrivateKey()).address;

  await waitForIndexed(
    await send(club, club.canvas, call("setMember", [w, 1])),
  );
  const a = await get(`/v1/wallets/${w}/accounts`);
  const upper = await get(`/v1/wallets/0x${w.slice(2).toUpperCase()}/accounts`);

  await waitForIndexed(
    await send(club, club.canvas, call("setMember", [w, 2])),
  );
  const approver = await get(`/v1/wallets/${w}/accounts`);

  await waitForIndexed(
    await send(club, club.canvas, call("setMember", [w, 0])),
  );
  const gone = await get(`/v1/wallets/${w}/accounts`);

  // `w` never sent a transaction, so the club only added it.
  expect(a.body.accounts).toEqual([
    { address: club.canvas.toLowerCase(), role: "viewer", acted: false },
  ]);
  expect(upper.body.accounts).toEqual(a.body.accounts);
  expect(approver.body.accounts).toEqual([
    { address: club.canvas.toLowerCase(), role: "approver", acted: false },
  ]);
  expect(gone.body.accounts).toEqual([]);
  expect((await get(`/v1/wallets/0x123/accounts`)).status).toBe(400);
});

test("anyone can fill a wallet's switcher: the route pages and the chain checks only the page on screen", async () => {
  const N = 150;
  const victim = await freshMember();
  const attacker = await freshMember();
  const wallet = createWalletClient({
    account: attacker.account,
    chain,
    transport: http(),
  });
  let nonce = await publicClient.getTransactionCount({
    address: attacker.account.address,
  });
  const hashes: `0x${string}`[] = [];

  for (let i = 1; i <= N; i++) {
    const salt = keccak256(toHex(`spam-${i}-${victim.account.address}`));
    const account = await publicClient.readContract({
      address: dep.factory,
      abi: zalFactoryAbi,
      functionName: "predictAccount",
      args: [attacker.account.address, salt],
    });

    hashes.push(
      await wallet.writeContract({
        address: dep.factory,
        abi: zalFactoryAbi,
        functionName: "createAccount",
        args: [attacker.account.address, salt],
        nonce: nonce++,
        gas: 1_000_000n,
      }),
    );
    hashes.push(
      await wallet.sendTransaction({
        to: account,
        data: call("setMember", [victim.account.address, 3]),
        nonce: nonce++,
        gas: 300_000n,
      }),
    );
  }
  let last;

  for (const hash of hashes.slice(-2)) {
    last = await publicClient.waitForTransactionReceipt({ hash });
    if (last.status !== "success") throw new Error("spam setup reverted");
  }
  await waitForIndexed(last!);
  const served = await get(`/v1/wallets/${victim.account.address}/accounts`);

  // One page of 50: the victim's own canvas (it created it) first, then 49 the attacker added it to.
  expect(served.body.accounts).toHaveLength(50);
  expect(
    served.body.accounts
      .filter((a: { acted: boolean }) => a.acted)
      .map((a: { address: string }) => a.address),
  ).toEqual([victim.canvas.toLowerCase()]);
  expect(served.body.nextCursor).toEqual(expect.any(String));
  expect(
    (await get(`/v1/wallets/${victim.account.address}/accounts?limit=101`))
      .status,
  ).toBe(400);

  const { useMemberships, useOwnCanvas } =
    await import("@/hooks/contracts/memberships");
  const { liveNetwork } = await import("@/config/chains");

  if (liveNetwork.status !== "ready") throw new Error("no live network");
  let rpc = 0;
  const realFetch = globalThis.fetch;

  globalThis.fetch = ((input: any, init: any) => {
    if (String(typeof input === "string" ? input : input.url).includes(":8546"))
      rpc++;

    return realFetch(input, init);
  }) as typeof fetch;
  const victimWallet = victim.account.address;
  const loadAll = async <T>(probe: () => T) => {
    const h = await renderHooks(victimWallet, probe);

    return Promise.all(
      h.queryClient
        .getQueryCache()
        .findAll()
        .map((q) => q.fetch()),
    );
  };
  // What the open switcher reads: "My canvas" and the first page of canvases the victim acted on.
  const [own, acted] = (await loadAll(() => ({
    own: useOwnCanvas({
      payload: { network: liveNetwork, wallet: victimWallet },
    }),
    acted: useMemberships({
      payload: {
        network: liveNetwork,
        wallet: victimWallet,
        group: "acted",
        enabled: true,
      },
    }),
  }))) as [any, { pages: { entries: any[] }[] }];
  const list = [own, ...acted.pages.flatMap((p) => p.entries)];
  const rpcForVisible = rpc;
  // Expanding "Added by others" reads its first page only.
  const [others] = (await loadAll(() =>
    useMemberships({
      payload: {
        network: liveNetwork,
        wallet: victimWallet,
        group: "addedByOthers",
        enabled: true,
      },
    }),
  )) as [{ pages: { entries: any[]; next: string | undefined }[] }];

  globalThis.fetch = realFetch;
  expect(getAddress(list[0].account)).toBe(getAddress(victim.canvas));
  // What a bounded list looks like: the victim's own canvas, then only canvases it acted on (none).
  expect(list.length).toBeLessThanOrEqual(51);
  expect(list).toHaveLength(1);
  expect(rpcForVisible).toBeLessThan(10);
  expect(others.pages[0]!.entries).toHaveLength(50);
  expect(others.pages[0]!.next).toEqual(expect.any(String));
  expect(rpc).toBeLessThan(10 + 50 * 4);
});
