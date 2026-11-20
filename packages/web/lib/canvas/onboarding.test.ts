import { describe, expect, test } from "vitest";

import { onboardingTrack } from "./onboarding";
import { account, rel, state } from "./test-fixtures";

const fresh = state({ account: account({ exists: false }) });
const nextTitle = (gas: bigint | undefined, s = fresh) =>
  onboardingTrack(s, gas).next?.title;

describe("onboardingTrack", () => {
  test("a new wallet with no gas starts at Get gas, pointing at Deposit", () => {
    const track = onboardingTrack(fresh, 0n);

    expect(track.done).toBe(0);
    expect(track.next?.title).toBe("Get gas");
    expect(track.next?.target).toBe("deposit");
  });

  test("gas still loading does not tick Get gas", () => {
    expect(nextTitle(undefined)).toBe("Get gas");
  });

  test("gas in the wallet moves to Create your canvas", () => {
    expect(nextTitle(1n)).toBe("Create your canvas");
  });

  test("a created canvas counts gas as done even after it is spent", () => {
    expect(nextTitle(0n, state())).toBe("Mint zUSDC");
  });

  test("zUSDC in the wallet or the canvas ticks Mint", () => {
    const inWallet = state({
      lp: { ...state().lp, walletUsdc: 1n },
    });
    const inCanvas = state({ account: account({ balance: 1n }) });

    expect(nextTitle(0n, inWallet)).toBe("Add your first counterparty");
    expect(nextTitle(0n, inCanvas)).toBe("Add your first counterparty");
  });

  test("a proposed counterparty completes onboarding, even with zero balances", () => {
    const track = onboardingTrack(state({ relationships: [rel()] }), 0n);

    expect(track.next).toBeUndefined();
    expect(track.done).toBe(track.steps.length);
  });
});
