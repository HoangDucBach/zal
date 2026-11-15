// F6: a tampered API cannot choose who receives the pool shares of a deposit the connected wallet pays for.
import { expect, test } from "vitest";
import { parseAbi, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { startProxy, renderHooks } from "./react-harness";
import { dep, freshMember, publicClient } from "./chain";

test("F6: a tampered canvas.wallet redirects the pool shares of a deposit", async () => {
  const user = await freshMember();
  const attacker = privateKeyToAccount(generatePrivateKey()).address;
  const proxy = await startProxy((path, json) =>
    path.includes("/canvas")
      ? { ...json, canvas: { ...json.canvas, wallet: attacker.toLowerCase() } }
      : json,
  );

  process.env.NEXT_PUBLIC_ZAL_API_URL = proxy.url;
  const { useCanvas } = await import("@/hooks/contracts/canvas");
  const { useLpDeposit } = await import("@/hooks/contracts/pool");
  const { liveNetwork } = await import("@/config/chains");

  if (liveNetwork.status !== "ready")
    throw new Error("live network not configured");

  // The user holds 1,000 test USDC (the open faucet), as in the app.
  const erc = parseAbi([
    "function mint(address,uint256)",
    "function balanceOf(address) view returns (uint256)",
  ]);

  await publicClient.waitForTransactionReceipt({
    hash: await user.wallet.writeContract({
      address: dep.usdc,
      abi: erc,
      functionName: "mint",
      args: [user.account.address, 1_000_000_000n],
    }),
  });
  await publicClient.request({
    method: "anvil_impersonateAccount" as never,
    params: [user.account.address] as never,
  });

  const h = await renderHooks(user.account.address, () => ({
    canvas: useCanvas({
      payload: { network: liveNetwork, wallet: user.account.address },
    }),
    deposit: useLpDeposit({ network: liveNetwork }),
  }));
  const query = h.queryClient.getQueryCache().findAll()[0]!;
  const snapshot = (await query.fetch()) as { canvas: { wallet: Address } };

  // The tampered answer is not used: the page reads the chain, so "your wallet" is the connected one.
  expect(snapshot.canvas.wallet).toBe(user.account.address);

  // LiquidityForm: `deposit.mutate({ amount, allowance: lp.allowance })`; the shares go to the signer.
  const shares = (who: Address) =>
    publicClient.readContract({
      address: dep.pool,
      abi: erc,
      functionName: "balanceOf",
      args: [who],
    });
  const [userBefore, attackerBefore] = [
    await shares(user.account.address),
    await shares(attacker),
  ];

  await h.get().deposit.mutateAsync({ amount: 100_000_000n, allowance: 0n });
  const [userAfter, attackerAfter] = [
    await shares(user.account.address),
    await shares(attacker),
  ];

  proxy.close();
  // Intent: the shares go to the wallet that signed (and paid), whatever the API says.
  expect(attackerAfter).toBe(attackerBefore);
  expect(userAfter).toBeGreaterThan(userBefore);
});
