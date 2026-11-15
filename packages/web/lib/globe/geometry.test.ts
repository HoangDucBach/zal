import { describe, expect, test } from "vitest";

import {
  ROUTES,
  RIBBON_STRIDE,
  TRAIL,
  arcFrame,
  arcPoint,
  arcRibbon,
  dotGrid,
  isLand,
  toVector,
  travelSeconds,
} from "./geometry";

const length = (v: readonly number[]) => Math.hypot(...v);

describe("land mask", () => {
  test.each([
    ["London", 51.5, -0.1],
    ["Sahara", 23, 12],
    ["Siberia", 62, 100],
    ["Amazon", -5, -60],
    ["Australia", -25, 134],
  ])("%s is land", (_, lat, lon) => expect(isLand(lat, lon)).toBe(true));

  test.each([
    ["mid Atlantic", 30, -40],
    ["central Pacific", 0, -150],
    ["Indian Ocean", -30, 80],
  ])("%s is sea", (_, lat, lon) => expect(isLand(lat, lon)).toBe(false));

  test("the dot grid is about 30% land, like the Earth", () => {
    const grid = dotGrid(1);
    const land = grid.land.reduce((sum, v) => sum + v, 0) / grid.count;

    expect(land).toBeGreaterThan(0.24);
    expect(land).toBeLessThan(0.36);
    expect(grid.positions.length).toBe(grid.count * 3);
  });
});

describe("arcs", () => {
  test("an arc starts and ends at its cities and rises in between", () => {
    const a = toVector(51.5, -0.1);
    const b = toVector(40.7, -74);
    const start = arcPoint(a, b, 0, 0.1);
    const end = arcPoint(a, b, 1, 0.1);

    expect(
      start
        .map((v, i) => v / length(start) - (a[i] ?? 0))
        .every((d) => Math.abs(d) < 1e-9),
    ).toBe(true);
    expect(
      end
        .map((v, i) => v / length(end) - (b[i] ?? 0))
        .every((d) => Math.abs(d) < 1e-9),
    ).toBe(true);
    expect(length(arcPoint(a, b, 0.5, 0.1))).toBeGreaterThan(
      length(start) + 0.09,
    );
  });

  test("a ribbon has two vertices per point", () => {
    const route = ROUTES[0];

    if (route === undefined) throw new Error("no routes");
    const ribbon = arcRibbon(route, 16);

    expect(ribbon.count).toBe(34);
    expect(ribbon.vertices.length).toBe(34 * RIBBON_STRIDE);
  });

  test("a transfer leaves, lands, then rests until its next cycle", () => {
    const route = ROUTES[0];

    if (route === undefined) throw new Error("no routes");
    const travel = travelSeconds(route);
    const frames = Array.from({ length: 140 }, (_, i) =>
      arcFrame(route, 0, i * 0.05),
    );
    const flying = frames.filter((f) => f.path > 0 && f.head < 1);
    const landed = frames.find((f) => f.landedFor !== undefined);

    expect(flying.length).toBeGreaterThan(0);
    expect(landed?.head).toBeLessThanOrEqual(1 + TRAIL);
    expect(arcFrame(route, 0, travel * 0.5).head).toBeCloseTo(0.5, 5);
    expect(frames.some((f) => f.path === 0)).toBe(true);
  });

  test("transfers are staggered: several are in flight, never all", () => {
    for (const seconds of [0, 1.7, 3.3, 5.9, 8.2]) {
      const active = ROUTES.filter(
        (route, i) => arcFrame(route, i, seconds).path > 0,
      ).length;

      expect(active).toBeGreaterThan(2);
      expect(active).toBeLessThan(ROUTES.length);
    }
  });
});
