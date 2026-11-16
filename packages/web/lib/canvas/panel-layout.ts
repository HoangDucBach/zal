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
