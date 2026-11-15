// Live check (docker stack): the API refuses an invite whose nonce the chain has already consumed, since
// acceptInvite would revert for whoever opens the link. Uses two fresh funded wallets.
// Run: node test/stack/invite-used-nonce.ts
import { createPublicClient, createWalletClient, http, toHex, zeroHash, type Abi, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { canvasAccountAbi, relationshipRegistryAbi, zalFactoryAbi } from "../../abis/index.ts";

const RPC = process.env.RPC ?? "http://localhost:8546";
const API = process.env.API ?? "http://localhost:42069";
const FACTORY: Address = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const REGISTRY: Address = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
const client = createPublicClient({ chain, transport: http(RPC) });

async function actor(): Promise<PrivateKeyAccount> {
  const a = privateKeyToAccount(generatePrivateKey());
  await client.request({ method: "anvil_setBalance" as never, params: [a.address, toHex(10n ** 20n)] as never });
  return a;
}
async function send(from: PrivateKeyAccount, address: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
  const hash = await createWalletClient({ account: from, chain, transport: http(RPC) }).writeContract({ address, abi, functionName, args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
}
const accountOf = (admin: Address) =>
  client.readContract({ address: FACTORY, abi: zalFactoryAbi, functionName: "predictAccount", args: [admin, zeroHash] });

const [inviter, invitee] = [await actor(), await actor()];
for (const w of [inviter, invitee]) await send(w, FACTORY, zalFactoryAbi, "createAccount", [w.address, zeroHash]);
const [proposer, other] = [await accountOf(inviter.address), await accountOf(invitee.address)];

const block = await client.getBlock();
const invite = {
  proposer,
  proposerRole: 1,
  inviteeEmailHash: `0x${"cd".repeat(32)}`,
  nonce: BigInt(Date.now()),
  deadline: block.timestamp + 86_400n,
} as const;
const signature = await inviter.signTypedData({
  domain: { name: "Zal RelationshipRegistry", version: "1", chainId: 31337, verifyingContract: REGISTRY },
  types: {
    Invite: [
      { name: "proposer", type: "address" },
      { name: "proposerRole", type: "uint8" },
      { name: "inviteeEmailHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
  },
  primaryType: "Invite",
  message: invite,
});

// The invitee redeems it on-chain first.
await send(invitee, other, canvasAccountAbi, "acceptInvite", [invite, signature]);
const used = await client.readContract({ address: REGISTRY, abi: relationshipRegistryAbi, functionName: "inviteNonceUsed", args: [proposer, invite.nonce] });
console.log("chain: inviteNonceUsed =", used);

const res = await fetch(`${API}/v1/invites`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...invite, nonce: invite.nonce.toString(), deadline: Number(invite.deadline), signature }),
});
const body = (await res.json()) as { invite?: { id: string; expired: boolean }; detail?: string };
console.log("api: POST /v1/invites ->", res.status, JSON.stringify(body.invite ?? body.detail));

const sim = await client
  .simulateContract({ account: invitee, address: other, abi: canvasAccountAbi, functionName: "acceptInvite", args: [invite, signature] })
  .then(() => "ok", (e: { shortMessage?: string; message?: string }) => e.shortMessage ?? e.message ?? "reverted");
console.log("chain: acceptInvite for that stored link ->", sim);
console.log(res.status >= 400 ? "PASS: the API refused an invite the chain will not accept" : "FAIL: the API stored an invite acceptInvite reverts on");
process.exit(res.status >= 400 ? 0 : 1);
