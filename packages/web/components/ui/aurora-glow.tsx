"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";

/**
 * One soft light. It tours the card through `cx`/`cy` while it stretches through `rx`/`ry`, and cross-fades between
 * its `hues`, so the lights trade places, bend and blend into new colours as they pass each other. Every array is a
 * loop: it ends where it starts.
 */
interface Blob {
  readonly key: string;
  /** Theme token the light takes its colour from, through `currentColor`. */
  readonly tone: "text-accent" | "text-danger" | "text-foreground";
  /** Hue turns in degrees it fades between, so purple and blue still follow the theme's primary. */
  readonly hues: readonly number[];
  readonly cx: readonly number[];
  readonly cy: readonly number[];
  readonly rx: readonly number[];
  readonly ry: readonly number[];
  readonly opacity: number;
  /** One tour. Tours differ per light, so the picture never quite repeats. */
  readonly seconds: number;
}

// A loop around the inside of the 320 × 200 viewBox, clockwise from the top-left. Each light runs it from its own
// starting point, so the lights chase each other around the card's edge and the middle stays dark.
const ORBIT: readonly (readonly [number, number])[] = [
  [40, 30],
  [160, 15],
  [285, 30],
  [305, 100],
  [285, 170],
  [160, 185],
  [35, 170],
  [15, 100],
];

/** The orbit from point `start`, closed back on itself. */
const orbitFrom = (start: number, axis: 0 | 1): number[] => {
  const points = [...ORBIT.slice(start), ...ORBIT.slice(0, start)];

  return [...points, points[0]].map((point) => point[axis]);
};

/** A stretch loop the same length as the orbit, so a light bends as it turns each corner. */
const stretch = (wide: number, narrow: number): number[] =>
  ORBIT.map((_, i) => (i % 2 === 0 ? wide : narrow)).concat(wide);

const BLOBS: readonly Blob[] = [
  {
    key: "pink",
    tone: "text-accent",
    hues: [0, -30],
    cx: orbitFrom(0, 0),
    cy: orbitFrom(0, 1),
    rx: stretch(80, 55),
    ry: stretch(45, 65),
    opacity: 1,
    seconds: 9,
  },
  {
    key: "purple",
    tone: "text-accent",
    hues: [-55, -25],
    cx: orbitFrom(2, 0),
    cy: orbitFrom(2, 1),
    rx: stretch(55, 80),
    ry: stretch(65, 42),
    opacity: 1,
    seconds: 9,
  },
  {
    key: "blue",
    tone: "text-accent",
    hues: [-110, -80],
    cx: orbitFrom(4, 0),
    cy: orbitFrom(4, 1),
    rx: stretch(75, 50),
    ry: stretch(42, 62),
    opacity: 0.95,
    seconds: 9,
  },
  {
    key: "white",
    tone: "text-foreground",
    hues: [0],
    cx: orbitFrom(6, 0),
    cy: orbitFrom(6, 1),
    rx: stretch(45, 32),
    ry: stretch(30, 42),
    opacity: 0.55,
    seconds: 9,
  },
];

/** The opacity loop of hue `index` among `count`: each hue peaks in its own share of the loop. */
function hueFade(index: number, count: number, peak: number): number[] {
  if (count === 1) return [peak, peak];

  return Array.from({ length: count + 1 }, (_, step) =>
    step % count === index ? peak : 0,
  );
}

/**
 * A dark card background with bright, soft lights in the theme's primary colour that chase each other around its edge,
 * bending at the corners and cross-fading between hues (ADR 0017), with film grain on top. Put it in a `relative isolate overflow-hidden` box
 * inside a `dark` theme scope, so the text on it is light. Still under reduced motion.
 */
export function AuroraGlow({
  orientation = "wide",
}: {
  /** `tall` turns the scene a quarter turn, so a tall card keeps the white glow near its top-right corner. */
  readonly orientation?: "wide" | "tall";
}) {
  const tall = orientation === "tall";
  const reduced = useReducedMotion() === true;
  const id = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const grain = `aurora-grain-${id}`;
  const soft = (blob: Blob, hue: number) => `aurora-${blob.key}-${hue}-${id}`;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 size-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox={tall ? "0 0 200 320" : "0 0 320 200"}
    >
      <defs>
        {BLOBS.flatMap((blob) =>
          blob.hues.map((hue) => (
            <filter
              key={soft(blob, hue)}
              height="300%"
              id={soft(blob, hue)}
              width="300%"
              x="-100%"
              y="-100%"
            >
              <feColorMatrix type="hueRotate" values={String(hue)} />
              <feGaussianBlur stdDeviation="16" />
            </filter>
          )),
        )}
        <filter id={grain}>
          <feTurbulence
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
            type="fractalNoise"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      <rect
        className="text-background"
        fill="currentColor"
        height="320"
        width="320"
      />
      {/* (x, y) → (y, 320 − x) when tall: the band then rises from the bottom toward the top-right. */}
      <g transform={tall ? "translate(0 320) rotate(-90)" : undefined}>
        {BLOBS.flatMap((blob) =>
          blob.hues.map((hue, index) => (
            <motion.ellipse
              key={soft(blob, hue)}
              className={blob.tone}
              fill="currentColor"
              filter={`url(#${soft(blob, hue)})`}
              initial={{
                cx: blob.cx[0],
                cy: blob.cy[0],
                rx: blob.rx[0],
                ry: blob.ry[0],
                opacity: hueFade(index, blob.hues.length, blob.opacity)[0],
              }}
              {...(reduced
                ? {}
                : {
                    animate: {
                      cx: [...blob.cx],
                      cy: [...blob.cy],
                      rx: [...blob.rx],
                      ry: [...blob.ry],
                      opacity: hueFade(index, blob.hues.length, blob.opacity),
                    },
                    transition: {
                      default: {
                        duration: blob.seconds,
                        ease: "linear" as const,
                        repeat: Infinity,
                      },
                      // Colours turn on their own, shorter beat, out of step with the tour.
                      opacity: {
                        duration: blob.seconds * 0.6,
                        ease: "easeInOut" as const,
                        repeat: Infinity,
                      },
                    },
                  })}
            />
          )),
        )}
      </g>
      <rect filter={`url(#${grain})`} height="320" opacity="0.14" width="320" />
    </svg>
  );
}
