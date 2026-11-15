"use client";

// The left palette (story C2): components grouped as in the PRD catalogue, filtered by lib/canvas/palette.ts to
// what fits the selection. Drag one anywhere on the canvas to place a draft, or onto a node to connect it there;
// click one to add it next to the selection. The Structure group (ADR 0011) groups the selected nodes into a
// child canvas.

import type { PaletteComponent, PaletteEntry } from "@/lib/canvas/palette";

import { Button, Card, Chip, ScrollShadow, Tooltip } from "@heroui/react";
import {
  BillListIcon,
  CaseMinimalisticIcon,
  ClockCircleIcon,
  DatabaseIcon,
  GripVerticalIcon,
  HandMoneyIcon,
  LayersMinimalisticIcon,
  LockIcon,
  RefreshIcon,
  RoutingIcon,
  SafeSquareIcon,
  ShieldCheckIcon,
  TargetIcon,
  UserRoundedIcon,
  WalletIcon,
} from "@solar-icons/react/linear";

import { COMPONENT_HINTS, PALETTE_GROUPS } from "@/lib/canvas/palette";

export const DRAG_TYPE = "application/x-zal-component";
/** The drag payload of the Structure group's child canvas entry. */
export const CHILD_CANVAS = "child-canvas";

const ICON = { size: 16, "aria-hidden": true } as const;

export const COMPONENT_ICONS: Record<PaletteComponent, React.ReactNode> = {
  account: <WalletIcon {...ICON} />,
  counterparty: <UserRoundedIcon {...ICON} />,
  endpoint: <TargetIcon {...ICON} />,
  invoice: <BillListIcon {...ICON} />,
  budget: <CaseMinimalisticIcon {...ICON} />,
  approval: <ShieldCheckIcon {...ICON} />,
  schedule: <ClockCircleIcon {...ICON} />,
  stream: <RefreshIcon {...ICON} />,
  split: <RoutingIcon {...ICON} />,
  escrow: <LockIcon {...ICON} />,
  vault: <SafeSquareIcon {...ICON} />,
  pool: <DatabaseIcon {...ICON} />,
  liquidity: <HandMoneyIcon {...ICON} />,
};

function Item({
  id,
  icon,
  title,
  hint,
  disabledReason,
  onPick,
}: {
  readonly id: string;
  readonly icon: React.ReactNode;
  readonly title: string;
  /** One line on what it is, in a tooltip. */
  readonly hint: string;
  /** Shown disabled, with this reason under it. */
  readonly disabledReason?: string;
  readonly onPick: () => void;
}) {
  const disabled = disabledReason !== undefined;

  return (
    <div
      className="flex flex-col gap-0.5"
      data-component={id}
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, id);
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <Tooltip delay={500}>
        <Tooltip.Trigger className="flex">
          <Button
            fullWidth
            className="justify-start gap-2"
            isDisabled={disabled}
            size="sm"
            variant="ghost"
            onPress={onPick}
          >
            <span className="text-muted">{icon}</span>
            <span className="flex-1 text-start">{title}</span>
            <GripVerticalIcon aria-hidden className="text-muted" size={14} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content showArrow className="max-w-64" placement="right">
          <Tooltip.Arrow />
          <span className="text-xs break-normal">{hint}</span>
        </Tooltip.Content>
      </Tooltip>
      {disabled ? (
        <span className="px-2 pb-1 text-xs text-muted">{disabledReason}</span>
      ) : null}
    </div>
  );
}

export interface StructureEntry {
  /** `undefined` when the selection can move into a new child canvas. */
  readonly blockedBy: string | undefined;
  readonly onCreate: () => void;
}

export function Palette({
  entries,
  scope,
  structure,
  onPick,
}: {
  readonly entries: readonly PaletteEntry[];
  /** What the palette is filtered for: "Canvas" or the selected node. */
  readonly scope: string;
  readonly structure: StructureEntry;
  readonly onPick: (component: PaletteComponent) => void;
}) {
  const shown = entries.filter((e) => e.availability.status !== "blocked");

  return (
    <Card className="flex max-h-full w-56 flex-col gap-2 border border-border/60 bg-surface/65 p-2 backdrop-blur-xl">
      <Card.Header className="flex flex-row items-center justify-between gap-1 px-1">
        <Card.Title className="text-sm">Components</Card.Title>
        <Chip className="px-2 py-0.5" size="sm" variant="secondary">
          for {scope}
        </Chip>
      </Card.Header>
      <ScrollShadow className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        {PALETTE_GROUPS.map((group) => {
          const items = shown.filter((e) => e.group === group);

          if (items.length === 0) return null;

          return (
            <div key={group} className="flex flex-col gap-0.5">
              <span className="px-2 text-xs text-muted">{group}</span>
              {items.map((entry) => (
                <Item
                  key={entry.component}
                  disabledReason={
                    entry.availability.status === "unsupported"
                      ? entry.availability.reason
                      : undefined
                  }
                  hint={COMPONENT_HINTS[entry.component]}
                  icon={COMPONENT_ICONS[entry.component]}
                  id={entry.component}
                  title={entry.title}
                  onPick={() => onPick(entry.component)}
                />
              ))}
            </div>
          );
        })}
        <div className="flex flex-col gap-0.5">
          <span className="px-2 text-xs text-muted">Structure</span>
          <Item
            disabledReason={structure.blockedBy}
            hint="Selection → gate · layout only, nothing on-chain"
            icon={<LayersMinimalisticIcon {...ICON} />}
            id={CHILD_CANVAS}
            title="Child canvas"
            onPick={structure.onCreate}
          />
        </div>
      </ScrollShadow>
    </Card>
  );
}
