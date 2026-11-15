// Pure geometry for the landing globe: the dot grid, great-circle arcs and the transfer schedule. No WebGL here,
// so the shapes are tested in node.

import { LAND_MASK } from "./land-mask";

export type Vec3 = readonly [number, number, number];

export interface City {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

export interface Route {
  readonly from: City;
  readonly to: City;
}

const CITY = {
  newYork: { name: "New York", lat: 40.71, lon: -74.01 },
  london: { name: "London", lat: 51.51, lon: -0.13 },
  frankfurt: { name: "Frankfurt", lat: 50.11, lon: 8.68 },
  lagos: { name: "Lagos", lat: 6.52, lon: 3.38 },
  nairobi: { name: "Nairobi", lat: -1.29, lon: 36.82 },
  dubai: { name: "Dubai", lat: 25.2, lon: 55.27 },
  mumbai: { name: "Mumbai", lat: 19.08, lon: 72.88 },
  singapore: { name: "Singapore", lat: 1.35, lon: 103.82 },
  hanoi: { name: "Hanoi", lat: 21.03, lon: 105.85 },
  seoul: { name: "Seoul", lat: 37.57, lon: 126.98 },
  tokyo: { name: "Tokyo", lat: 35.68, lon: 139.69 },
  sydney: { name: "Sydney", lat: -33.87, lon: 151.21 },
  saoPaulo: { name: "São Paulo", lat: -23.55, lon: -46.63 },
  mexicoCity: { name: "Mexico City", lat: 19.43, lon: -99.13 },
  sanFrancisco: { name: "San Francisco", lat: 37.77, lon: -122.42 },
} as const satisfies Record<string, City>;

/** Illustrative transfers between cities. Decoration only: no number on the landing claims real volume. */
export const ROUTES: readonly Route[] = [
  { from: CITY.london, to: CITY.newYork },
  { from: CITY.singapore, to: CITY.hanoi },
  { from: CITY.newYork, to: CITY.saoPaulo },
  { from: CITY.dubai, to: CITY.mumbai },
  { from: CITY.sanFrancisco, to: CITY.tokyo },
  { from: CITY.lagos, to: CITY.london },
  { from: CITY.frankfurt, to: CITY.singapore },
  { from: CITY.nairobi, to: CITY.dubai },
  { from: CITY.seoul, to: CITY.sanFrancisco },
  { from: CITY.mexicoCity, to: CITY.newYork },
  { from: CITY.mumbai, to: CITY.singapore },
  { from: CITY.singapore, to: CITY.sydney },
  { from: CITY.tokyo, to: CITY.hanoi },
  { from: CITY.saoPaulo, to: CITY.lagos },
];

const RAD = Math.PI / 180;

/** Unit vector for a latitude and longitude, y up, longitude 0 facing +z. */
export function toVector(lat: number, lon: number): Vec3 {
  const phi = lat * RAD;
  const lambda = lon * RAD;

  return [
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
    Math.cos(phi) * Math.cos(lambda),
  ];
}

const maskBytes = (() => {
  let cache: Uint8Array | undefined;

  return (): Uint8Array => {
    cache ??= Uint8Array.from(atob(LAND_MASK.base64), (c) => c.charCodeAt(0));

    return cache;
  };
})();

export function isLand(lat: number, lon: number): boolean {
  const { width, height } = LAND_MASK;
  const row = Math.min(
    height - 1,
    Math.max(0, Math.floor(((90 - lat) / 180) * height)),
  );
  const col = Math.min(
    width - 1,
    Math.max(0, Math.floor(((lon + 180) / 360) * width)),
  );
  const index = row * width + col;

  return ((maskBytes()[index >> 3] ?? 0) >> (index & 7)) % 2 === 1;
}

export interface DotGrid {
  /** xyz per dot, on the unit sphere. */
  readonly positions: Float32Array;
  /** 1 for land, 0 for sea, per dot. */
  readonly land: Float32Array;
  readonly count: number;
}

/**
 * A halftone grid: rows of equal latitude, each with as many dots as its circumference fits, so the spacing stays
 * even from the equator to the poles.
 */
export function dotGrid(stepDegrees: number): DotGrid {
  const positions: number[] = [];
  const land: number[] = [];

  for (let lat = -90 + stepDegrees / 2; lat < 90; lat += stepDegrees) {
    const around = Math.max(
      1,
      Math.round((360 * Math.cos(lat * RAD)) / stepDegrees),
    );

    for (let i = 0; i < around; i++) {
      const lon = -180 + (i + 0.5) * (360 / around);

      positions.push(...toVector(lat, lon));
      land.push(isLand(lat, lon) ? 1 : 0);
    }
  }

  return {
    positions: Float32Array.from(positions),
    land: Float32Array.from(land),
    count: land.length,
  };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Angle between two unit vectors, radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
}

/** The point at `t` along the great-circle arc from `a` to `b`, lifted off the surface in a smooth hump. */
export function arcPoint(a: Vec3, b: Vec3, t: number, lift: number): Vec3 {
  const omega = angleBetween(a, b);
  const s = Math.sin(omega);
  const wa = s < 1e-6 ? 1 - t : Math.sin((1 - t) * omega) / s;
  const wb = s < 1e-6 ? t : Math.sin(t * omega) / s;
  // A hair above the dots at the endpoints, so the arc never z-fights the sphere it leaves.
  const r = 1.006 + lift * Math.sin(Math.PI * t);

  return [
    (wa * a[0] + wb * b[0]) * r,
    (wa * a[1] + wb * b[1]) * r,
    (wa * a[2] + wb * b[2]) * r,
  ];
}

/** How high an arc rises: longer hops rise higher, so arcs do not hug the surface or tower over it. */
export function liftFor(a: Vec3, b: Vec3): number {
  return 0.04 + 0.22 * (angleBetween(a, b) / Math.PI);
}

export interface Ribbon {
  /** Per vertex: position xyz, next position xyz, t along the arc, side (-1 or 1). */
  readonly vertices: Float32Array;
  readonly count: number;
}

export const RIBBON_STRIDE = 8;

/** A triangle strip along an arc. The vertex shader widens it in screen space, so it stays the same pixel width. */
export function arcRibbon(route: Route, segments: number): Ribbon {
  const a = toVector(route.from.lat, route.from.lon);
  const b = toVector(route.to.lat, route.to.lon);
  const lift = liftFor(a, b);
  const at = (t: number) => arcPoint(a, b, t, lift);
  const out: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = at(t);
    // The last point has no successor, so it extends the previous direction instead.
    const n =
      i < segments
        ? at((i + 1) / segments)
        : ((prev: Vec3) =>
            [
              2 * p[0] - prev[0],
              2 * p[1] - prev[1],
              2 * p[2] - prev[2],
            ] as const)(at((i - 1) / segments));

    for (const side of [-1, 1]) out.push(...p, ...n, t, side);
  }

  return { vertices: Float32Array.from(out), count: (segments + 1) * 2 };
}

/** Seconds one transfer takes to cross its arc. */
export function travelSeconds(route: Route): number {
  const a = toVector(route.from.lat, route.from.lon);
  const b = toVector(route.to.lat, route.to.lon);

  return 1.4 + 1.6 * (angleBetween(a, b) / Math.PI);
}

export const TRAIL = 0.45;
export const PULSE_SECONDS = 1.4;
const CYCLE_SECONDS = 7;

export interface ArcFrame {
  /** Where the travelling head is, 0 to 1 + TRAIL (the trail drains after the head lands). */
  readonly head: number;
  /** Fade of the faint full path, 0 to 1. */
  readonly path: number;
  /** Seconds since the head landed, or undefined before it lands. */
  readonly landedFor: number | undefined;
  /** Seconds since the transfer left, or undefined while idle. */
  readonly leftFor: number | undefined;
}

/**
 * Where transfer `index` is at `seconds`. Each route repeats every cycle, staggered so a few are in flight at once
 * and never all together.
 */
export function arcFrame(
  route: Route,
  index: number,
  seconds: number,
): ArcFrame {
  const travel = travelSeconds(route);
  const offset = (index * CYCLE_SECONDS * 0.618) % CYCLE_SECONDS;
  const local =
    (((seconds - offset) % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
  const active = travel * (1 + TRAIL);

  if (local > active + PULSE_SECONDS)
    return { head: 0, path: 0, landedFor: undefined, leftFor: undefined };
  const head = Math.min(local / travel, 1 + TRAIL);
  const fadeIn = Math.min(1, local / 0.4);
  const fadeOut =
    local < active ? 1 : Math.max(0, 1 - (local - active) / PULSE_SECONDS);

  return {
    head,
    path: fadeIn * fadeOut,
    landedFor: local >= travel ? local - travel : undefined,
    leftFor: local,
  };
}
