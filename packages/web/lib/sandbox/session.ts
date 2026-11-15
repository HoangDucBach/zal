// Entering, leaving and driving the sandbox from the page, and its status as a React store.

import type { Address } from "viem";
import type { Config } from "wagmi";
import type { PartnerRole } from "./partners";
import type { SandboxRuntime } from "./runtime";

import { useSyncExternalStore } from "react";
import { connect, disconnect } from "wagmi/actions";

import { SANDBOX_CONNECTOR_ID } from "./connector";
import { getSandboxMode, setSandboxMode, subscribeSandboxMode } from "./mode";
import {
  closeRuntime,
  loadedRuntime,
  loadRuntime,
  subscribeRuntimeLoaded,
} from "./runtime-loader";

export type SandboxSession =
  | { readonly phase: "off" }
  | { readonly phase: "loading" }
  | {
      readonly phase: "ready";
      readonly now: number;
      readonly botsBusy: boolean;
      readonly user: Address;
      readonly scheduled: readonly bigint[];
    };

const OFF: SandboxSession = { phase: "off" };
const LOADING: SandboxSession = { phase: "loading" };

let snapshot: SandboxSession = OFF;
let ready: SandboxRuntime | undefined;
let unsubscribeRuntime: (() => void) | undefined;
const listeners = new Set<() => void>();

function emit(next: SandboxSession): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function fromRuntime(runtime: SandboxRuntime): SandboxSession {
  const { now, botsBusy, scheduled } = runtime.getStatus();

  return { phase: "ready", now, botsBusy, scheduled, user: runtime.user };
}

function sync(): void {
  if (!getSandboxMode().enabled) {
    unsubscribeRuntime?.();
    unsubscribeRuntime = undefined;
    ready = undefined;
    emit(OFF);

    return;
  }
  const pending = loadedRuntime();

  if (pending === undefined) {
    emit(LOADING);
    void loadRuntime().catch(() => emit(OFF));

    return;
  }
  if (ready === undefined) emit(LOADING);
  void pending.then((runtime) => {
    if (ready === runtime) return;
    unsubscribeRuntime?.();
    ready = runtime;
    unsubscribeRuntime = runtime.subscribe(() => emit(fromRuntime(runtime)));
    emit(fromRuntime(runtime));
  });
}

let wired = false;

function subscribe(listener: () => void): () => void {
  if (!wired && typeof window !== "undefined") {
    wired = true;
    subscribeSandboxMode(sync);
    subscribeRuntimeLoaded(sync);
    sync();
  }
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useSandboxSession(): SandboxSession {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => OFF,
  );
}

/** Turns the sandbox on for `account`, the address of the wallet the visitor connected. */
export async function enterSandbox(
  config: Config,
  account: Address,
): Promise<void> {
  setSandboxMode({ enabled: true, account });
  const connector = config.connectors.find(
    (c) => c.id === SANDBOX_CONNECTOR_ID,
  );

  if (connector === undefined)
    throw new Error("The sandbox connector is not configured.");
  await loadRuntime();
  await connect(config, { connector });
}

export async function exitSandbox(config: Config): Promise<void> {
  const connector = config.connectors.find(
    (c) => c.id === SANDBOX_CONNECTOR_ID,
  );

  if (connector !== undefined)
    await disconnect(config, { connector }).catch(() => undefined);
  setSandboxMode({ enabled: false });
  closeRuntime();
}

export async function resetSandbox(): Promise<void> {
  await (await loadRuntime()).reset();
}

export async function advanceSandboxTo(timestamp: number): Promise<void> {
  await (await loadRuntime()).advanceTo(timestamp);
}

export async function askSandboxToPay(invoiceId: bigint): Promise<void> {
  await (await loadRuntime()).askToPay(invoiceId);
}

export async function scheduleSandboxSettlement(
  invoiceId: bigint,
): Promise<void> {
  (await loadRuntime()).schedule(invoiceId);
}

export async function cosignSandbox(opId: bigint): Promise<void> {
  await (await loadRuntime()).cosign(opId);
}

/** Creates "Demo partner N", a bot canvas that buys from or sells to the visitor, and returns its account. */
export async function createDemoCounterparty(
  role: PartnerRole,
): Promise<Address> {
  return (await (await loadRuntime()).createDemoPartner(role)).account;
}
