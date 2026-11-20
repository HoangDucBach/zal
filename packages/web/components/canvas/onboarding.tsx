"use client";

// First-run tour on a live chain, on the wallet's own canvas: one popover pointing at the control the next step
// needs (Deposit, the Account's Create button, the palette's Counterparty), with that control lit and pinged and
// the rest of the page dimmed. Steps tick from chain state
// (lib/canvas/onboarding.ts), never from clicks. The tour hides itself once every step is done, or when the
// wallet skips it.

import type { Address } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type {
  OnboardingAnchor,
  OnboardingTrack,
} from "@/lib/canvas/onboarding";
import type { CanvasState } from "@/lib/canvas/types";

import { Chip, CloseButton, Popover, ProgressBar } from "@heroui/react";
import { useOnViewportChange } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

import { Spotlight } from "@/components/ui/spotlight";
import { useNativeBalance } from "@/hooks/contracts/gas";
import { useDepositOpen } from "@/hooks/use-deposit-open";
import { useOnboardingSkipped } from "@/hooks/use-onboarding-skipped";
import { onboardingTrack } from "@/lib/canvas/onboarding";

const SELECTORS: Record<OnboardingAnchor, string> = {
  deposit: '[data-tour="deposit"]',
  "create-canvas": '[data-tour="create-canvas"]',
  counterparty: '[data-component="counterparty"]',
};

const PLACEMENT = {
  deposit: "right",
  "create-canvas": "bottom",
  counterparty: "right",
} as const satisfies Record<OnboardingAnchor, string>;

/** How often to look for the anchor: it can mount late (a node is measured, the palette loads) or move. */
const ANCHOR_POLL_MS = 400;

const visible = (element: Element) => {
  const box = element.getBoundingClientRect();

  return box.width > 0 && box.height > 0;
};

/** The first rendered element for the anchor, or undefined while none is on the page. */
function useAnchor(anchor: OnboardingAnchor): Element | undefined {
  const [element, setElement] = useState<Element | undefined>(undefined);

  useEffect(() => {
    const find = () => {
      const found = [...document.querySelectorAll(SELECTORS[anchor])].find(
        visible,
      );

      setElement((current) => (current === found ? current : found));
    };

    find();
    const timer = window.setInterval(find, ANCHOR_POLL_MS);

    return () => window.clearInterval(timer);
  }, [anchor]);

  return element;
}

function Step({
  track,
  anchor,
  isOpen,
  onSkip,
}: {
  readonly track: OnboardingTrack;
  readonly anchor: Element;
  readonly isOpen: boolean;
  readonly onSkip: () => void;
}) {
  const triggerRef = useMemo(() => ({ current: anchor }), [anchor]);
  const { next } = track;

  if (next === undefined) return null;

  return (
    <Popover isOpen={isOpen}>
      <Popover.Content
        isNonModal
        aria-label="Get started"
        className="w-64"
        placement={PLACEMENT[next.anchor]}
        triggerRef={triggerRef}
      >
        <Popover.Arrow />
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Chip color="accent" size="sm" variant="soft">
                {track.done + 1}/{track.steps.length}
              </Chip>
              <span className="text-sm font-semibold">{next.title}</span>
            </div>
            <CloseButton aria-label="Skip the tour" onPress={onSkip} />
          </div>
          <ProgressBar
            aria-label="Steps done"
            maxValue={track.steps.length}
            size="sm"
            value={track.done}
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        </div>
      </Popover.Content>
    </Popover>
  );
}

/** The tour for the wallet's own canvas on a live chain. Renders nothing once complete or skipped. */
export function Onboarding({
  network,
  wallet,
  state,
}: {
  readonly network: ZalNetwork;
  readonly wallet: Address;
  readonly state: CanvasState;
}) {
  // Poll until the wallet holds gas: it can arrive from outside the app, where nothing invalidates the read.
  const gas = useNativeBalance({
    payload: { network, holder: wallet },
    options: {
      refetchInterval: (query) =>
        state.account.exists || (query.state.data ?? 0n) > 0n ? false : 4_000,
    },
  });
  const [skipped, skip] = useOnboardingSkipped(wallet);
  const [depositOpen] = useDepositOpen();
  // A popover does not follow its anchor through a pan or zoom, so it hides while the viewport moves.
  const [moving, setMoving] = useState(false);

  useOnViewportChange({
    onStart: () => setMoving(true),
    onEnd: () => setMoving(false),
  });

  const track = onboardingTrack(state, gas.data);
  const anchor = useAnchor(track.next?.anchor ?? "deposit");

  if (skipped || track.next === undefined || anchor === undefined) return null;
  const shown = !moving && !depositOpen;

  return (
    <>
      <Spotlight shown={shown} target={anchor} />
      <Step anchor={anchor} isOpen={shown} track={track} onSkip={skip} />
    </>
  );
}
