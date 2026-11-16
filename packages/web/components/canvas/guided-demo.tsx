"use client";

// The guided demo panel (story S1). Steps tick from chain state (lib/canvas/guided-demo.ts), never from clicks.
// "Show me" flies the canvas to the node the next step is about.

import type { DemoTrack } from "@/lib/canvas/guided-demo";

import { Button, Card, Chip, ProgressBar, Tabs } from "@heroui/react";
import {
  AltArrowDownIcon,
  AltArrowUpIcon,
  CheckCircleIcon,
  ClockCircleIcon,
} from "@solar-icons/react/linear";
import { useState } from "react";

const ICON = { size: 14, "aria-hidden": true } as const;

function NextStep({
  track,
  onFocus,
}: {
  readonly track: DemoTrack;
  readonly onFocus: (id: string) => void;
}) {
  const { next } = track;

  if (next === undefined)
    return (
      <Chip color="success" size="sm" variant="soft">
        All done
      </Chip>
    );

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-secondary p-2">
      <span className="text-xs font-semibold">Do this next</span>
      <span className="text-xs">{next.hint}</span>
      {next.focus === undefined ? null : (
        <Button
          size="sm"
          variant="secondary"
          onPress={() => next.focus !== undefined && onFocus(next.focus)}
        >
          Show me
        </Button>
      )}
    </div>
  );
}

function TrackView({
  track,
  onFocus,
}: {
  readonly track: DemoTrack;
  readonly onFocus: (id: string) => void;
}) {
  const { next } = track;

  return (
    <div className="flex flex-col gap-2">
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
            <span className="pt-0.5">
              {step.done ? (
                <CheckCircleIcon {...ICON} className="text-success" />
              ) : (
                <ClockCircleIcon {...ICON} />
              )}
            </span>
            <span className={step === next ? "font-semibold" : ""}>
              {index + 1}. {step.title}
            </span>
          </li>
        ))}
      </ol>
      <NextStep track={track} onFocus={onFocus} />
    </div>
  );
}

export function GuidedDemo({
  seller,
  buyer,
  onFocus,
  compact,
}: {
  readonly seller: DemoTrack;
  readonly buyer: DemoTrack;
  readonly onFocus: (id: string) => void;
  /** The Inspector is open, so show only the next step. */
  readonly compact: boolean;
}) {
  const [open, setOpen] = useState(true);
  // Open on the track still in progress: the buyer and LP roles once the PRD script is done.
  const active =
    seller.next === undefined && buyer.next !== undefined ? buyer : seller;

  return (
    <Card className="w-full gap-2 border border-border/60 bg-surface/65 p-3 backdrop-blur-xl">
      <Card.Header className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Card.Title className="text-sm">Guided demo</Card.Title>
          <Chip
            color={seller.next === undefined ? "success" : "accent"}
            size="sm"
            variant="soft"
          >
            {seller.done}/{seller.steps.length}
          </Chip>
        </div>
        <Button
          isIconOnly
          aria-label={open ? "Collapse guided demo" : "Expand guided demo"}
          size="sm"
          variant="ghost"
          onPress={() => setOpen(!open)}
        >
          {open ? <AltArrowUpIcon {...ICON} /> : <AltArrowDownIcon {...ICON} />}
        </Button>
      </Card.Header>
      {open && compact ? (
        <Card.Content>
          <NextStep track={active} onFocus={onFocus} />
        </Card.Content>
      ) : null}
      {open && !compact ? (
        <Card.Content>
          <Tabs
            defaultSelectedKey={active === buyer ? "buyer" : "seller"}
            variant="secondary"
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="Demo tracks">
                <Tabs.Tab id="seller">
                  PRD demo
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="buyer">
                  Buyer and LP {buyer.done}/{buyer.steps.length}
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel className="pt-3" id="seller">
              <TrackView track={seller} onFocus={onFocus} />
            </Tabs.Panel>
            <Tabs.Panel className="pt-3" id="buyer">
              <TrackView track={buyer} onFocus={onFocus} />
            </Tabs.Panel>
          </Tabs>
        </Card.Content>
      ) : null}
    </Card>
  );
}
