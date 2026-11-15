// F7: a tampered API cannot choose the target of `acceptInvite`: it goes to the signer's own canvas.
import { expect, test } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { startProxy, renderHooks } from "./react-harness";
import { dep, freshMember, publicClient } from "./chain";

test("F7: a tampered canvas.account.address becomes the target of the acceptInvite transaction", async () => {
  const inviter = await freshMember();
  const invitee = await freshMember();
  const evil = privateKeyToAccount(generatePrivateKey()).address;

  // A contract-shaped stub at the attacker's address that "succeeds" with 32 zero bytes.
  await publicClient.request({
    method: "anvil_setCode" as never,
    params: [evil, "0x600060005260206000f3"] as never,
  });

  const proxy = await startProxy((path, json) =>
    path.includes("/canvas") &&
    path.includes(`wallet=${invitee.account.address.toLowerCase()}`)
      ? {
          ...json,
          canvas: {
            ...json.canvas,
            account: { ...json.canvas.account, address: evil.toLowerCase() },
          },
        }
      : json,
  );

  process.env.NEXT_PUBLIC_ZAL_API_URL = proxy.url;
  const { api } = await import("@/lib/api/client");
  const { INVITE_DOMAIN, INVITE_TYPES, newInvite } =
    await import("@/lib/api/invite");
  const { useCanvas } = await import("@/hooks/contracts/canvas");
  const { useAcceptInvite } = await import("@/hooks/contracts/canvas-account");
  const { liveNetwork } = await import("@/config/chains");

  if (liveNetwork.status !== "ready")
    throw new Error("live network not configured");

  // A real invite from the inviter's account, stored by the real API (what Copy invite link does).
  const message = newInvite(
    inviter.canvas,
    1,
    Number((await publicClient.getBlock()).timestamp),
  ); // the chain's clock, as the app uses `state.now`
  const signature = await inviter.account.signTypedData({
    domain: {
      ...INVITE_DOMAIN,
      chainId: 31337,
      verifyingContract: dep.registry,
    },
    types: INVITE_TYPES,
    primaryType: "Invite",
    message,
  });
  const stored = (
    await api.createInvite({
      ...message,
      deadline: Number(message.deadline),
      signature,
    })
  ).invite;
  const data = (await api.invite(stored.id)).invite; // invite-view.tsx: `api.invite(id)`

  await publicClient.request({
    method: "anvil_impersonateAccount" as never,
    params: [invitee.account.address] as never,
  });
  const h = await renderHooks(invitee.account.address, () => ({
    canvas: useCanvas({
      payload: { network: liveNetwork, wallet: invitee.account.address },
    }),
    accept: useAcceptInvite({ network: liveNetwork }),
  }));
  const state = (
    (await h.queryClient.getQueryCache().findAll()[0]!.fetch()) as {
      canvas: { account: { address: `0x${string}`; exists: boolean } };
    }
  ).canvas;

  // The tampered answer is not used: the page reads the chain, so it shows the invitee's own canvas.
  expect(state.account.address.toLowerCase()).toBe(
    invitee.canvas.toLowerCase(),
  );

  // invite-view.tsx onPress: the payload carries the invite only; the target is the signer's canvas.
  const result = await h.get().accept.mutateAsync({
    args: [
      {
        proposer: data.proposer,
        proposerRole: data.proposerRole,
        inviteeEmailHash: data.inviteeEmailHash,
        nonce: data.nonce,
        deadline: BigInt(data.deadline),
      },
      data.signature,
    ],
  });

  proxy.close();
  // Intent: the transaction goes to the invitee's own CanvasAccount.
  expect(result.receipt.to?.toLowerCase()).toBe(invitee.canvas.toLowerCase());
});
