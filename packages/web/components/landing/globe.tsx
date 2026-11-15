"use client";

import type { GlobeLayout, GlobePalette, Rgb } from "@/lib/globe/renderer";

import { useEffect, useRef, useState } from "react";

import { createGlobe } from "@/lib/globe/renderer";

/** Device pixel ratio cap: past 2 the dots look the same and the fill rate doubles. */
const MAX_PIXEL_RATIO = 2;
/** The frame drawn when motion is reduced: several transfers mid-flight. */
const STILL_SECONDS = 5.2;

type GlobeState = "loading" | "animating" | "paused" | "still" | "fallback";

/** Resolves a CSS colour (the theme tokens are oklch) to sRGB in 0..1 through a 1px 2D canvas. */
function tokenRgb(name: string, probe: CanvasRenderingContext2D): Rgb {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();

  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value || "#888";
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;

  return [r / 255, g / 255, b / 255];
}

function readPalette(): GlobePalette {
  const probe = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });

  if (probe === null)
    return {
      accent: [1, 0.3, 0.5],
      foreground: [1, 1, 1],
      background: [0, 0, 0],
      glow: 1,
    };
  const background = tokenRgb("--background", probe);
  const luminance =
    0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2];

  return {
    accent: tokenRgb("--accent", probe),
    foreground: tokenRgb("--foreground", probe),
    background,
    glow: luminance > 0.5 ? 0.35 : 1,
  };
}

/** The sphere rises from the bottom edge, centred, wide enough to carry several arcs in view. */
function layoutFor(width: number, height: number): GlobeLayout {
  // Wide screens get 40% of the width; a phone gets most of it, so the globe still reads as a globe.
  const radius = Math.min(
    Math.max(width * 0.4, Math.min(width * 0.8, 320)),
    height * 0.56,
  );

  return {
    width,
    height,
    centerX: width / 2,
    centerY: height + radius * 0.12,
    radius,
  };
}

/**
 * The landing hero's globe. Draws only while on screen and the tab is visible, holds one still frame when the
 * visitor prefers reduced motion, and leaves the token gradient behind it when WebGL2 is missing.
 */
export function Globe() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GlobeState>("loading");

  useEffect(() => {
    const host = hostRef.current;

    if (host === null) return;
    // A canvas per mount: a remount (React StrictMode, fast refresh) must not reuse a context the last cleanup lost.
    const canvas = document.createElement("canvas");

    canvas.className = "size-full";
    host.append(canvas);
    let globe: ReturnType<typeof createGlobe>;

    try {
      globe = createGlobe(canvas, readPalette());
    } catch {
      globe = undefined;
    }
    if (globe === undefined) {
      canvas.remove();
      setState("fallback");

      return;
    }
    const scene = globe;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let onScreen = true;
    let frame = 0;
    let seconds = STILL_SECONDS;
    let last: number | undefined;

    const tick = (now: number) => {
      seconds += last === undefined ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      scene.draw(seconds);
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      last = undefined;
      if (motion.matches) {
        scene.draw(STILL_SECONDS);
        setState("still");
      } else if (onScreen && document.visibilityState === "visible") {
        frame = requestAnimationFrame(tick);
        setState("animating");
      } else {
        setState("paused");
      }
    };
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();

      scene.resize(
        layoutFor(width, height),
        Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
      );
      scene.draw(motion.matches ? STILL_SECONDS : seconds);
    };

    const resizeObserver = new ResizeObserver(resize);
    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      sync();
    });
    // next-themes swaps the class on <html>; the globe re-reads the tokens so it follows light and dark.
    const theme = new MutationObserver(() => {
      scene.setPalette(readPalette());
      if (motion.matches) scene.draw(STILL_SECONDS);
    });

    resizeObserver.observe(canvas);
    visibility.observe(canvas);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    resize();
    sync();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibility.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
      scene.destroy();
      canvas.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="absolute inset-0"
      data-globe={state}
    >
      {state === "fallback" ? (
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-radial from-accent/25 via-accent/5 to-transparent" />
      ) : null}
    </div>
  );
}
