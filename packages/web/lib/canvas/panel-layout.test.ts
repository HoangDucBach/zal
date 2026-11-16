import { describe, expect, test } from "vitest";

import { panelLayout } from "./panel-layout";

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
