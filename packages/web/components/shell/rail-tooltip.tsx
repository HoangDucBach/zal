"use client";

import { Tooltip } from "@heroui/react";

/** The label of an icon-only control in the collapsed sidebar, to its right. Renders the control alone when expanded. */
export function RailTooltip({
  label,
  shown,
  children,
}: {
  readonly label: string;
  /** Only the collapsed rail needs it; expanded controls carry their label. */
  readonly shown: boolean;
  readonly children: React.ReactNode;
}) {
  if (!shown) return children;

  return (
    <Tooltip delay={300}>
      {/* The control inside is the focus stop; the trigger only listens for hover and the focus that bubbles up. */}
      <Tooltip.Trigger className="flex" role="presentation" tabIndex={-1}>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content showArrow placement="right">
        <Tooltip.Arrow />
        <span className="text-xs">{label}</span>
      </Tooltip.Content>
    </Tooltip>
  );
}
