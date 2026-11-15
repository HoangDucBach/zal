// The keeper's chain adapter over viem: the next block's time, a simulated run at that time, and a run sent from the
// keeper wallet. The keeper calls `sendRun` one at a time, so the node's pending nonce is always the next one.

import type { DueSchedule } from "./keeper.ts";

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type PrivateKeyAccount,
} from "viem";

import { keeperAbi } from "../abis/index.ts";
import { RunRejected } from "./keeper.ts";

const RECEIPT_TIMEOUT_MS = 60_000;

export interface ChainOptions {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly signer: PrivateKeyAccount;
  readonly gasLimit: bigint;
  readonly now?: () => number;
}

/** The contract error's name, such as ScheduleNotDue or ERC20InsufficientBalance, else viem's short message. */
function revertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) return reverted.data?.errorName ?? reverted.reason ?? reverted.shortMessage;
    return err.shortMessage;
  }
  return String(err);
}

export function createChain({ chainId, rpcUrl, signer, gasLimit, now = Date.now }: ChainOptions) {
  const chain = defineChain({
    id: chainId,
    name: `zal-${chainId}`,
    nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const transport = http(rpcUrl, { timeout: 10_000 });
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account: signer, chain, transport });

  return {
    address: signer.address,
    gasBalance: () => publicClient.getBalance({ address: signer.address }),

    /**
     * The time the next block will carry. A node that builds a pending block (anvil) reports it, and its clock can
     * differ from the wall clock. A node whose pending block is the latest one (subnet-evm) stamps the next block
     * with its producer's wall clock, while an idle chain's latest block can be hours old.
     */
    chainTime: async (): Promise<number> => {
      const [latest, pending] = await Promise.all([
        publicClient.getBlock({ blockTag: "latest" }),
        publicClient.getBlock({ blockTag: "pending" }),
      ]);
      if (pending.timestamp > latest.timestamp) return Number(pending.timestamp);
      return Math.max(Math.floor(now() / 1000), Number(latest.timestamp));
    },

    simulateRun: async (schedule: DueSchedule, time: number): Promise<void> => {
      try {
        await publicClient.simulateContract({
          account: signer,
          address: schedule.account,
          abi: keeperAbi,
          functionName: "runSchedule",
          args: [schedule.id],
          gas: gasLimit,
          blockOverrides: { time: BigInt(time) },
        });
      } catch (err) {
        throw new RunRejected(revertReason(err));
      }
    },

    sendRun: async (schedule: DueSchedule) => {
      const hash = await wallet.writeContract({
        address: schedule.account,
        abi: keeperAbi,
        functionName: "runSchedule",
        args: [schedule.id],
        gas: gasLimit,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      return { hash, success: receipt.status === "success" };
    },
  };
}

export type Chain = ReturnType<typeof createChain>;
