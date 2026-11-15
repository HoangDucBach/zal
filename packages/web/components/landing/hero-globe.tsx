"use client";

import dynamic from "next/dynamic";

/** The WebGL globe loads after the page paints, in its own chunk, so only the landing ever downloads it. */
export const HeroGlobe = dynamic(
  () => import("./globe").then((module) => module.Globe),
  { ssr: false },
);
