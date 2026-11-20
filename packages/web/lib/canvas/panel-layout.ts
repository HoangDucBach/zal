// How the floating canvas panels fit the space the canvas has. The panels sit in one flex layout, so they never
// overlap; this decides only what shrinks, what turns to icons and what hides as the canvas gets smaller.

export type MinimapSize = "hidden" | "small" | "large";

export interface PanelLayout {
  /** The palette as one column of icons, titles in tooltips. */
  readonly compactPalette: boolean;
  /** The right column (Inbox, Inspector) at full width; narrower below it. */
  readonly wideColumn: boolean;
  readonly minimap: MinimapSize;
}

/** Below these the canvas has no room for the minimap beside the tool bar and timeline. */
const MINIMAP_MIN = { width: 840, height: 680 } as const;
/** From these the minimap grows to its large size. */
const MINIMAP_LARGE = { width: 1400, height: 860 } as const;
const PALETTE_COMPACT_BELOW = 1000;
const COLUMN_WIDE_FROM = 1200;

/** `width` and `height` are the canvas area in CSS pixels; zero means not measured yet, laid out as wide. */
export function panelLayout(width: number, height: number): PanelLayout {
  if (width === 0 || height === 0)
    return { compactPalette: false, wideColumn: true, minimap: "large" };

  const minimap: MinimapSize =
    width < MINIMAP_MIN.width || height < MINIMAP_MIN.height
      ? "hidden"
      : width < MINIMAP_LARGE.width || height < MINIMAP_LARGE.height
        ? "small"
        : "large";

  return {
    compactPalette: width < PALETTE_COMPACT_BELOW,
    wideColumn: width >= COLUMN_WIDE_FROM,
    minimap,
  };
}

export interface FitPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The panels' footprint at full size: palette left, Inbox and Inspector right, clock top, tool bar and timeline below. */
const PANEL_INSETS: FitPadding = {
  top: 60,
  right: 350,
  bottom: 170,
  left: 250,
};
/** Inside a child canvas the breadcrumb bar sits above the clock. */
const CHILD_TOP = 110;
/** The panels never take more than this share of either axis from a fit, so a narrow canvas does not zoom to dust. */
const MAX_INSET_SHARE = 0.5;

/**
 * The fitView padding in pixels: the panels' footprint, scaled down on each axis once it would leave the nodes
 * less than half the canvas.
 */
export function fitPadding(
  width: number,
  height: number,
  child: boolean,
): FitPadding {
  const top = child ? CHILD_TOP : PANEL_INSETS.top;
  const scale = (insets: number, size: number) =>
    size === 0 ? 1 : Math.min(1, (size * MAX_INSET_SHARE) / insets);
  const x = scale(PANEL_INSETS.left + PANEL_INSETS.right, width);
  const y = scale(top + PANEL_INSETS.bottom, height);

  return {
    top: Math.round(top * y),
    right: Math.round(PANEL_INSETS.right * x),
    bottom: Math.round(PANEL_INSETS.bottom * y),
    left: Math.round(PANEL_INSETS.left * x),
  };
}
