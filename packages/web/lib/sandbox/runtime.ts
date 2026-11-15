// The sandbox as the page uses it: one visitor's chain, its bots and its persistence. This module and everything
// it imports (tevm, the bytecode) load only through the dynamic import in runtime-loader.ts.

import type { DemoPartner, PartnerRole } from "./partners";

import { concat, keccak256, type Address, type Hash, type Hex } from "viem";

import { BOT_DELAY_MS, sandboxDeployment } from "./config";
import { cosign, nextScheduleDue, runBots } from "./engine/bots";
import { openSandboxChain, type SandboxChain } from "./engine/chain";
import { accountOf, createDemoPartner, read, seedSandbox } from "./engine/seed";
import { clearSandbox, loadSandbox, saveSandbox } from "./persistence";

import { zalInvoiceAbi } from "@/contracts/abis";
import * as bytecode from "@/contracts/bytecode";

const CODE_HASH: string = keccak256(concat(Object.values(bytecode) as Hex[]));

export interface SandboxStatus {
  /** Seconds since the epoch on the sandbox clock. */
  readonly now: number;
  /** A demo counterparty is about to act or is acting. */
  readonly botsBusy: boolean;
}

/** The keeper wakes at most this long after a schedule falls due, and at least this often while one waits. */
const KEEPER_WAKE_MAX_MS = 60_000;
const KEEPER_WAKE_MIN_MS = 1_000;

export class SandboxRuntime {
  private botTimer: ReturnType<typeof setTimeout> | undefined;
  /** Wakes the bots when the next schedule falls due on the sandbox clock. */
  private keeperTimer: ReturnType<typeof setTimeout> | undefined;
  private botsBusy = false;
  private readonly listeners = new Set<() => void>();
  private status: SandboxStatus;

  private constructor(
    readonly user: Address,
    private chain: SandboxChain,
  ) {
    this.status = { now: chain.now(), botsBusy: false };
  }

  /** Resumes the visitor's saved sandbox, or seeds a new one. */
  static async open(user: Address): Promise<SandboxRuntime> {
    const saved = loadSandbox(user);
    let chain: SandboxChain | undefined;

    if (saved !== undefined && saved.codeHash === CODE_HASH) {
      try {
        chain = await openSandboxChain(saved.journal, saved.offsetSeconds);
      } catch {
        chain = undefined;
      }
    }
    const runtime =
      chain === undefined
        ? new SandboxRuntime(user, await SandboxRuntime.seed(user))
        : new SandboxRuntime(user, chain);

    runtime.persist();
    runtime.scheduleBots(0);

    return runtime;
  }

  private static async seed(user: Address): Promise<SandboxChain> {
    const chain = await openSandboxChain();

    await seedSandbox(chain, user);

    return chain;
  }

  request(method: string, params?: unknown): Promise<unknown> {
    return this.chain.request(method, params);
  }

  /** A transaction from the visitor's wallet: impersonated, so no signature. */
  async sendTransaction(tx: {
    from: Address;
    to?: Address;
    data: Hex;
  }): Promise<Hash> {
    if (tx.from.toLowerCase() !== this.user.toLowerCase()) {
      throw new Error("The sandbox only sends from the connected wallet.");
    }
    const hash = await this.chain.send(tx);

    this.changed();
    this.scheduleBots(BOT_DELAY_MS);

    return hash;
  }

  async advanceTo(timestamp: number): Promise<void> {
    await this.chain.advanceTo(timestamp);
    this.changed();
    this.scheduleBots(BOT_DELAY_MS);
  }

  /** Asks the demo club to pay an invoice now, before its due date. */
  async askToPay(invoiceId: bigint): Promise<void> {
    await this.runBotsOnce({ payNow: invoiceId });
  }

  /** Seeds one more counterparty. Its transactions join the journal, so a reload replays it and Reset drops it. */
  async createDemoPartner(role: PartnerRole): Promise<DemoPartner> {
    const partner = await createDemoPartner(this.chain, role);

    this.changed();

    return partner;
  }

  /** The sandbox co-signer confirms an operation waiting on the visitor's account. */
  async cosign(opId: bigint): Promise<void> {
    await cosign(this.chain, await accountOf(this.chain, this.user), opId);
    this.changed();
    this.scheduleBots(BOT_DELAY_MS);
  }

  async reset(): Promise<void> {
    if (this.botTimer !== undefined) clearTimeout(this.botTimer);
    clearTimeout(this.keeperTimer);
    clearSandbox(this.user);
    this.chain = await SandboxRuntime.seed(this.user);
    this.changed();
  }

  /** The due date of an invoice, read from the chain. */
  async dueDate(invoiceId: bigint): Promise<number> {
    const inv = (await read(
      this.chain,
      sandboxDeployment.invoices,
      zalInvoiceAbi,
      "getInvoice",
      [invoiceId],
    )) as {
      dueDate: bigint;
    };

    return Number(inv.dueDate);
  }

  getStatus = (): SandboxStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  close(): void {
    if (this.botTimer !== undefined) clearTimeout(this.botTimer);
    clearTimeout(this.keeperTimer);
    this.listeners.clear();
  }

  private changed(): void {
    this.persist();
    this.status = { now: this.chain.now(), botsBusy: this.botsBusy };
    for (const listener of this.listeners) listener();
  }

  private persist(): void {
    saveSandbox(this.user, {
      codeHash: CODE_HASH,
      offsetSeconds: this.chain.offset(),
      journal: this.chain.journal(),
    });
  }

  /** Sleeps until the next schedule falls due in real time, then runs the bots, which run it. */
  private async wakeKeeper(): Promise<void> {
    clearTimeout(this.keeperTimer);
    const due = await nextScheduleDue(this.chain).catch(() => undefined);

    if (due === undefined || this.botTimer !== undefined) return;
    const ahead = due - this.chain.now();
    // Already due after a pass means its run reverted (no balance, say): retry slowly, as the real keeper backs off.
    const waitMs =
      ahead < 0
        ? KEEPER_WAKE_MAX_MS
        : Math.min(
            KEEPER_WAKE_MAX_MS,
            Math.max(KEEPER_WAKE_MIN_MS, ahead * 1000),
          );

    this.keeperTimer = setTimeout(() => this.scheduleBots(0), waitMs);
  }

  /** One bot step per tick, so each reaction lands visibly on the canvas before the next. */
  private scheduleBots(delayMs: number): void {
    if (this.botTimer !== undefined) clearTimeout(this.botTimer);
    this.botsBusy = true;
    this.changed();
    this.botTimer = setTimeout(() => {
      this.botTimer = undefined;
      void this.runBotsOnce().then((actions) =>
        actions > 0 ? this.scheduleBots(BOT_DELAY_MS) : this.wakeKeeper(),
      );
    }, delayMs);
  }

  private async runBotsOnce(
    options: { readonly payNow?: bigint } = {},
  ): Promise<number> {
    let actions = 0;

    try {
      actions = await runBots(this.chain, options);
    } catch {
      // A bot action that reverts (for example a budget that is full) leaves the invoice for the visitor to see.
      actions = 0;
    }
    this.botsBusy = actions > 0;
    this.changed();

    return actions;
  }
}
