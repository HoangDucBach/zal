import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  defineChain,
  parseAbi,
  type Hex,
  type Address,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { API } from "./env";

import { canvasAccountAbi, zalFactoryAbi } from "@/contracts/abis";
import { deployments } from "@/contracts/deployments";

export const dep = deployments["31337"];
export const chain = defineChain({
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://localhost:8546"] } },
});
export const publicClient = createPublicClient({ chain, transport: http() });

/** A fresh wallet with gas and its own canvas account on the running anvil. */
export async function freshMember() {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);

  await publicClient.request({
    method: "anvil_setBalance" as never,
    params: [account.address, "0x56bc75e2d63100000"] as never,
  });
  const wallet = createWalletClient({ account, chain, transport: http() });
  const hash = await wallet.writeContract({
    address: dep.factory,
    abi: zalFactoryAbi,
    functionName: "createAccount",
    args: [
      account.address,
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  const canvas = (await publicClient.readContract({
    address: dep.factory,
    abi: zalFactoryAbi,
    functionName: "predictAccount",
    args: [
      account.address,
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ],
  })) as Address;

  return { key: key as Hex, account, wallet, canvas };
}

export type Member = Awaited<ReturnType<typeof freshMember>>;

export const usdcAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
]);

export const call = (functionName: string, args: readonly unknown[]) =>
  encodeFunctionData({
    abi: canvasAccountAbi,
    functionName: functionName as never,
    args: args as never,
  });

/** Sends `data` from the member's wallet and returns the receipt, so a test can wait for the API to index its block. */
export async function send(
  from: Member,
  to: Address,
  data: Hex,
): Promise<TransactionReceipt> {
  const hash = await from.wallet.sendTransaction({ to, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") throw new Error("setup reverted");

  return receipt;
}

export const mint = (from: Member, to: Address, amount: bigint) =>
  send(
    from,
    dep.usdc,
    encodeFunctionData({
      abi: usdcAbi,
      functionName: "mint",
      args: [to, amount],
    }),
  );

export const balance = (holder: Address) =>
  publicClient.readContract({
    address: dep.usdc,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [holder],
  });

/**
 * Waits until the API's `asOf` reaches the block that holds `receipt`. Not the chain head: viem caches
 * `eth_blockNumber` for its polling interval, so a head read right after a receipt can be older than the receipt's
 * block while other tests mine blocks.
 */
export async function waitForIndexed(receipt: {
  readonly blockNumber: bigint;
}): Promise<void> {
  for (let i = 0; i < 300; i++) {
    const pool = await fetch(`${API}/v1/pool`);
    const block = ((await pool.json()) as { asOf: { block: number } }).asOf
      .block;

    if (BigInt(block) >= receipt.blockNumber) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the API did not index block ${receipt.blockNumber}`);
}
