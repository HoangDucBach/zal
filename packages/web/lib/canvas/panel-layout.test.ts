import { describe, expect, test } from "vitest";

import { fitPadding, panelLayout } from "./panel-layout";

describe("panelLayout", () => {
  test("lays out wide before the canvas is measured", () => {
    expect(panelLayout(0, 0)).toEqual({
      compactPalette: false,
      wideColumn: true,
      minimap: "large",
    });
  });

  test("a large canvas keeps every panel at full size", () => {
    expect(panelLayout(1680, 1080)).toEqual({
      compactPalette: false,
      wideColumn: true,
      minimap: "large",
    });
  });

  test("a half-screen canvas shrinks the minimap and turns the palette to icons", () => {
    expect(panelLayout(910, 1300)).toEqual({
      compactPalette: true,
      wideColumn: false,
      minimap: "small",
    });
  });

  test("hides the minimap when the canvas is too narrow or too short", () => {
    expect(panelLayout(839, 1000).minimap).toBe("hidden");
    expect(panelLayout(1600, 679).minimap).toBe("hidden");
    expect(panelLayout(840, 680).minimap).toBe("small");
  });

  test("a short but wide canvas keeps the small minimap", () => {
    expect(panelLayout(1600, 800).minimap).toBe("small");
  });
});

describe("fitPadding", () => {
  test("a large canvas keeps the panels' full footprint", () => {
    expect(fitPadding(1680, 1080, false)).toEqual({
      top: 60,
      right: 350,
      bottom: 170,
      left: 250,
    });
  });

  test("a narrow canvas leaves the nodes at least half its width", () => {
    const padding = fitPadding(700, 900, false);

    expect(padding.left + padding.right).toBe(350);
    expect(padding.right).toBeGreaterThan(padding.left);
  });

  test("a child canvas makes room for the breadcrumb bar", () => {
    expect(fitPadding(1680, 1080, true).top).toBe(110);
  });
});
