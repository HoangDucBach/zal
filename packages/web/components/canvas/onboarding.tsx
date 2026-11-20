"use client";

// First-run tour on a live chain, on the wallet's own canvas. Steps tick from chain state (lib/canvas/onboarding.ts),
// never from clicks. A canvas step flies the canvas to its node; a Deposit step opens the Deposit popover in the
// sidebar. The tour hides itself once every step is done, or when the wallet skips it.

import type { Address } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type { OnboardingStep, OnboardingTrack } from "@/lib/canvas/onboarding";
import type { CanvasState } from "@/lib/canvas/types";

import { Button, Card, Chip, CloseButton, ProgressBar } from "@heroui/react";
import { CheckCircleIcon, ClockCircleIcon } from "@solar-icons/react/linear";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { useNativeBalance } from "@/hooks/contracts/gas";
import { setDepositOpen } from "@/hooks/use-deposit-open";
import { useOnboardingSkipped } from "@/hooks/use-onboarding-skipped";
import { onboardingTrack } from "@/lib/canvas/onboarding";

const ICON = { size: 14, "aria-hidden": true } as const;
const EASE = [0.22, 1, 0.36, 1] as const;

function StepIcon({ done }: { readonly done: boolean }) {
  const reduce = useReducedMotion();

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.span
        key={done ? "done" : "open"}
        animate={{ opacity: 1, scale: 1 }}
        className="flex pt-0.5"
        exit={{ opacity: 0, scale: 0.6 }}
        initial={reduce ? false : { opacity: 0, scale: 0.6 }}
        transition={{ duration: reduce ? 0 : 0.2, ease: EASE }}
      >
        {done ? (
          <CheckCircleIcon {...ICON} className="text-success" />
        ) : (
          <ClockCircleIcon {...ICON} />
        )}
      </motion.span>
    </AnimatePresence>
  );
}

function NextStep({
  step,
  onFocus,
}: {
  readonly step: OnboardingStep;
  readonly onFocus: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const action =
    step.target === "deposit" ? (
      <Button size="sm" variant="primary" onPress={() => setDepositOpen(true)}>
        Open Deposit
      </Button>
    ) : step.focus === undefined ? null : (
      <Button
        size="sm"
        variant="secondary"
        onPress={() => step.focus !== undefined && onFocus(step.focus)}
      >
        Show me
      </Button>
    );

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={step.title}
        animate={{ opacity: 1, x: 0 }}
        className="flex flex-col gap-2 rounded-lg bg-surface-secondary p-2"
        exit={{ opacity: 0, x: -12 }}
        initial={reduce ? false : { opacity: 0, x: 12 }}
        transition={{ duration: reduce ? 0 : 0.25, ease: EASE }}
      >
        <span className="text-xs font-semibold">{step.title}</span>
        <span className="text-xs text-muted">{step.hint}</span>
        {action}
      </motion.div>
    </AnimatePresence>
  );
}

function Tour({
  track,
  onFocus,
  onSkip,
}: {
  readonly track: OnboardingTrack;
  readonly onFocus: (id: string) => void;
  readonly onSkip: () => void;
}) {
  const { next } = track;

  return (
    <Card className="w-full gap-2 border border-accent/40 bg-surface/65 p-3 backdrop-blur-xl">
      <Card.Header className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Card.Title className="text-sm">Get started</Card.Title>
          <Chip color="accent" size="sm" variant="soft">
            {track.done}/{track.steps.length}
          </Chip>
        </div>
        <CloseButton aria-label="Skip the tour" onPress={onSkip} />
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">
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
        <ol className="flex flex-col gap-1">
          {track.steps.map((step, index) => (
            <li
              key={step.title}
              className={`flex items-start gap-2 text-xs ${step.done ? "text-muted" : ""}`}
            >
              <StepIcon done={step.done} />
              <span className={step === next ? "font-semibold" : ""}>
                {index + 1}. {step.title}
              </span>
            </li>
          ))}
        </ol>
        {next === undefined ? null : <NextStep step={next} onFocus={onFocus} />}
      </Card.Content>
    </Card>
  );
}

/** The tour for the wallet's own canvas on a live chain. Renders nothing once complete or skipped. */
export function Onboarding({
  network,
  wallet,
  state,
  onFocus,
}: {
  readonly network: ZalNetwork;
  readonly wallet: Address;
  readonly state: CanvasState;
  readonly onFocus: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  // Poll until the wallet holds gas: it can arrive from outside the app, where nothing invalidates the read.
  const gas = useNativeBalance({
    payload: { network, holder: wallet },
    options: {
      refetchInterval: (query) =>
        state.account.exists || (query.state.data ?? 0n) > 0n ? false : 4_000,
    },
  });
  const [skipped, skip] = useOnboardingSkipped(wallet);
  const track = onboardingTrack(state, gas.data);
  const shown = !skipped && track.next !== undefined;

  return (
    <AnimatePresence>
      {shown ? (
        <motion.div
          key="onboarding"
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
        >
          <Tour track={track} onFocus={onFocus} onSkip={skip} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
