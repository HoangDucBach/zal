// The sandbox chain: tevm's in-memory EVM running the compiled Zal bytecode. Every state change goes
// through `send` or `advanceTime`, which append to a journal with the block timestamp they used. Replaying the
// journal rebuilds the same chain, logs included, which is how the sandbox persists across reloads.

import { createCommon } from "@tevm/common";
import { createMemoryClient } from "@tevm/memory-client";
import { numberToHex, type Address, type Hash, type Hex } from "viem";

import { SANDBOX_CHAIN_ID } from "../config";

export type JournalEntry =
  | {
      readonly kind: "tx";
      readonly from: Address;
      readonly to?: Address;
      readonly data: Hex;
      readonly timestamp: number;
    }
  | { readonly kind: "mine"; readonly timestamp: number };

export interface TxRequest {
  readonly from: Address;
  readonly to?: Address;
  readonly data: Hex;
}

export interface SandboxChain {
  /** EIP-1193 entry for reads (`eth_call`, `eth_getLogs`, receipts, blocks). */
  readonly request: (method: string, params?: unknown) => Promise<unknown>;
  /** Mines `tx` alone in a block at the sandbox clock. Throws with the revert when it fails; nothing is journaled. */
  readonly send: (tx: TxRequest) => Promise<Hash>;
  /**
   * Moves the clock forward to `timestamp` (or not at all if it is already later) and mines an empty block there,
   * so `block.timestamp` reads the new time.
   */
  readonly advanceTo: (timestamp: number) => Promise<void>;
  /** Seconds since the epoch on the sandbox clock. */
  readonly now: () => number;
  /** Seconds the clock runs ahead of the wall clock. Persisted with the journal. */
  readonly offset: () => number;
  readonly journal: () => readonly JournalEntry[];
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Opens a chain and replays `journal` onto it. The clock runs with the wall clock, `offsetSeconds` ahead of it,
 * and never goes backwards: each block is at least one second after the last.
 */
export async function openSandboxChain(
  journal: readonly JournalEntry[] = [],
  offsetSeconds = 0,
): Promise<SandboxChain> {
  const client = createMemoryClient({
    common: createCommon({
      id: SANDBOX_CHAIN_ID,
      name: "Zal Sandbox",
      nativeCurrency: { name: "Sandbox gas", symbol: "SBX", decimals: 18 },
      rpcUrls: { default: { http: [] } },
      hardfork: "cancun",
      loggingLevel: "error",
    }),
    miningConfig: { type: "manual" },
    loggingLevel: "error",
  });

  await client.tevmReady();

  const request = (method: string, params?: unknown): Promise<unknown> =>
    // tevm types `request` per method; the sandbox forwards arbitrary JSON-RPC, as an EIP-1193 provider does.
    (
      client.request as (args: {
        method: string;
        params?: unknown;
      }) => Promise<unknown>
    )({ method, params });

  const entries: JournalEntry[] = [];
  let offset = offsetSeconds;
  let lastTimestamp = 0;

  const mineAt = async (timestamp: number): Promise<void> => {
    await request("evm_setNextBlockTimestamp", [numberToHex(timestamp)]);
    await request("evm_mine", []);
    lastTimestamp = timestamp;
  };

  const apply = async (entry: JournalEntry): Promise<Hash | undefined> => {
    if (entry.kind === "mine") {
      await mineAt(entry.timestamp);

      return undefined;
    }
    // `tevmCall` with `createTransaction` queues an unsigned transaction from any sender: the impersonation.
    const result = await client.tevmCall({
      from: entry.from,
      ...(entry.to === undefined ? {} : { to: entry.to }),
      data: entry.data,
      gas: 30_000_000n,
      createTransaction: true,
      skipBalance: true,
      throwOnFail: false,
    });

    // tevm runs the queued call once at the latest block's time, which can be older than the block it is mined in,
    // so its revert is not final: the receipt below decides, and `send` has already checked at the block's time.
    const hash = result.txHash;

    if (hash === undefined)
      throw (
        result.errors?.[0] ??
        new Error("The sandbox did not queue the transaction.")
      );
    await mineAt(entry.timestamp);
    const receipt = (await request("eth_getTransactionReceipt", [hash])) as {
      status: Hex;
    } | null;

    if (receipt?.status !== "0x1")
      throw new Error(`Sandbox transaction ${hash} reverted.`);

    return hash;
  };

  const nextTimestamp = (): number =>
    Math.max(lastTimestamp + 1, nowSeconds() + offset);

  for (const entry of journal) await apply(entry);
  if (journal.length > 0) entries.push(...journal);

  let queue: Promise<unknown> = Promise.resolve();
  /** One state change at a time: a bot reaction and a user click must not interleave on the mempool. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);

    queue = run.catch(() => undefined);

    return run;
  };

  return {
    request,
    send: (tx) =>
      serial(async () => {
        const entry: JournalEntry = {
          kind: "tx",
          ...tx,
          timestamp: nextTimestamp(),
        };

        // A failing call is checked first, so a revert neither mines a block nor enters the journal. It runs at
        // the block time the transaction will get: blocks come only with transactions, so the latest block can be
        // minutes older, and a time check (a schedule falling due) would pass there and fail here, or the reverse.
        await request("eth_call", [
          {
            from: tx.from,
            to: tx.to,
            data: tx.data,
            gas: numberToHex(30_000_000),
          },
          "latest",
          undefined,
          { time: numberToHex(entry.timestamp) },
        ]);
        const hash = await apply(entry);

        entries.push(entry);
        if (hash === undefined)
          throw new Error("unreachable: a tx entry returns a hash");

        return hash;
      }),
    advanceTo: (timestamp) =>
      serial(async () => {
        offset = Math.max(offset, timestamp - nowSeconds());
        const entry: JournalEntry = {
          kind: "mine",
          timestamp: nextTimestamp(),
        };

        await apply(entry);
        entries.push(entry);
      }),
    now: () => Math.max(lastTimestamp, nowSeconds() + offset),
    offset: () => offset,
    journal: () => entries,
  };
}
