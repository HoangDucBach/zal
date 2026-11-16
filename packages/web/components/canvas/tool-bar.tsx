"use client";

// The floating tool bar under the canvas: select or pan, zoom, fit, and the minimap, on xyflow's own viewport API.
// It is the strongest of the quiet bars: more opaque, outlined, and lifted, so it reads as the canvas's controls.

import {
  Button,
  Separator,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
} from "@heroui/react";
import {
  CursorIcon,
  HandIcon,
  MapIcon,
  MaximizeSquareMinimalisticIcon,
  RoundedMagnifierZoomInIcon,
  RoundedMagnifierZoomOutIcon,
} from "@solar-icons/react/linear";
import { useReactFlow, useViewport } from "@xyflow/react";

export type PointerMode = "select" | "pan";

const ICON = { size: 16, "aria-hidden": true } as const;

export function ToolBar({
  mode,
  onModeChange,
  onFit,
  minimap,
  minimapFits,
  onMinimapChange,
}: {
  readonly mode: PointerMode;
  readonly onModeChange: (mode: PointerMode) => void;
  readonly onFit: () => void;
  readonly minimap: boolean;
  /** False while the canvas is too small for the minimap. */
  readonly minimapFits: boolean;
  readonly onMinimapChange: (shown: boolean) => void;
}) {
  const { zoomIn, zoomOut } = useReactFlow();
  const { zoom } = useViewport();

  return (
    <Toolbar
      isAttached
      aria-label="Canvas tools"
      className="gap-1 rounded-2xl border border-border bg-surface/75 p-1.5 shadow-md backdrop-blur-2xl"
    >
      <ToggleButtonGroup
        disallowEmptySelection
        aria-label="Pointer"
        selectedKeys={[mode]}
        selectionMode="single"
        size="sm"
        onSelectionChange={(keys) =>
          onModeChange(keys.has("pan") ? "pan" : "select")
        }
      >
        <ToggleButton isIconOnly aria-label="Select" id="select">
          <CursorIcon {...ICON} />
        </ToggleButton>
        <ToggleButton isIconOnly aria-label="Pan" id="pan">
          <ToggleButtonGroup.Separator />
          <HandIcon {...ICON} />
        </ToggleButton>
      </ToggleButtonGroup>
      <Separator orientation="vertical" />
      <Button
        isIconOnly
        aria-label="Zoom out"
        size="sm"
        variant="ghost"
        onPress={() => void zoomOut({ duration: 200 })}
      >
        <RoundedMagnifierZoomOutIcon {...ICON} />
      </Button>
      <span className="w-12 text-center text-xs font-medium tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        isIconOnly
        aria-label="Zoom in"
        size="sm"
        variant="ghost"
        onPress={() => void zoomIn({ duration: 200 })}
      >
        <RoundedMagnifierZoomInIcon {...ICON} />
      </Button>
      <Separator orientation="vertical" />
      <Button
        isIconOnly
        aria-label="Fit view"
        size="sm"
        variant="ghost"
        onPress={onFit}
      >
        <MaximizeSquareMinimalisticIcon {...ICON} />
      </Button>
      <ToggleButton
        isIconOnly
        aria-label="Minimap"
        isDisabled={!minimapFits}
        isSelected={minimap && minimapFits}
        size="sm"
        onChange={onMinimapChange}
      >
        <MapIcon {...ICON} />
      </ToggleButton>
    </Toolbar>
  );
}
