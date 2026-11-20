// First-run onboarding on a live chain: gas, canvas, zUSDC, first counterparty. Pure, like the guided demo: a step
// ticks only from what the chain shows, never from a click. Once every step is done the track is complete and the
// tour never shows again for that wallet.

import type { CanvasState } from "./types";

import { nodeId } from "./graph";

/** Where a step's action lives outside the canvas. */
export type OnboardingTarget = "deposit";

export interface OnboardingStep {
  readonly title: string;
  readonly done: boolean;
  /** What to do for this step, shown while it is the next one. */
  readonly hint: string;
  /** The node the step is about; the canvas flies there. */
  readonly focus?: string;
  /** The shell control the step needs, opened instead of flying the canvas. */
  readonly target?: OnboardingTarget;
}

export interface OnboardingTrack {
  readonly steps: readonly OnboardingStep[];
  /** The first step not done yet; undefined once onboarding is complete. */
  readonly next: OnboardingStep | undefined;
  readonly done: number;
}

/**
 * The onboarding steps for the wallet's own canvas.
 * @param gasWei the wallet's native balance, undefined while it loads.
 */
export function onboardingTrack(
  state: CanvasState,
  gasWei: bigint | undefined,
): OnboardingTrack {
  const { account } = state;
  // A later step implies the earlier ones, so spending gas or zUSDC never reopens a step.
  const hasCounterparty = state.relationships.length > 0;
  const hasUsdc =
    hasCounterparty ||
    account.balance > 0n ||
    state.lp.walletUsdc > 0n ||
    state.cash.length > 0;
  const hasCanvas = account.exists;
  const hasGas = hasCanvas || (gasWei !== undefined && gasWei > 0n);

  const steps: readonly OnboardingStep[] = [
    {
      title: "Get gas",
      done: hasGas,
      hint: "Deposit → Get gas · pays for every transaction",
      target: "deposit",
    },
    {
      title: "Create your canvas",
      done: hasCanvas,
      hint: "Account → Create canvas · one transaction",
      focus: nodeId.account,
    },
    {
      title: "Mint zUSDC",
      done: hasUsdc,
      hint: "Deposit → Mint 1,000 zUSDC",
      target: "deposit",
    },
    {
      title: "Add your first counterparty",
      done: hasCounterparty,
      hint: "Account → Counterparty · by address or invite link",
      focus: nodeId.account,
    },
  ];

  return {
    steps,
    next: steps.find((step) => !step.done),
    done: steps.filter((step) => step.done).length,
  };
}
