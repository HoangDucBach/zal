// The sandbox keeper in real time (ADR 0015): a schedule falls due while no block is mined, because blocks come
// only with transactions. The run must be checked at the time its own block gets, not the latest block's.

import { encodeFunctionData, type Address } from "viem";
import { afterEach, expect, test, vi } from "vitest";

import { sandboxDeployment as d } from "../config";

import { runBots } from "./bots";
import { openSandboxChain } from "./chain";
import { read, seedSandbox, write } from "./seed";

import { canvasAccountAbi, zusdcAbi } from "@/contracts/abis";

const USER: Address = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  vi.useRealTimers();
});

test("a schedule that falls due on the clock alone is run by the keeper (ZR-SCH-05)", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
  const chain = await openSandboxChain();
  const { userAccount, club } = await seedSandbox(chain, USER);
  const start = chain.now() + 61;
  const clubBalance = async () =>
    (await read(chain, d.usdc, zusdcAbi, "balanceOf", [club])) as bigint;

  await write(chain, USER, userAccount, canvasAccountAbi, "submit", [
    encodeFunctionData({
      abi: canvasAccountAbi,
      functionName: "createSchedule",
      args: [0, club, 0n, 1_000_000n, BigInt(start), 0, 1],
    }),
  ]);
  const before = await clubBalance();

  expect(await runBots(chain)).toBe(0);
  vi.setSystemTime((start + 5) * 1000);
  expect(chain.now()).toBeGreaterThanOrEqual(start);

  await runBots(chain);
  expect((await clubBalance()) - before).toBe(1_000_000n);
});
