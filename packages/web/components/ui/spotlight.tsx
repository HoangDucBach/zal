"use client";

// Dims the page around one control and pings a dot on its corner, so a tour step or a prompt reads as the one
// thing to do next. Presentation only: the page underneath stays clickable, including the control itself.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

/** Room between the control and the edge of the lit hole. */
const HOLE_PADDING = 6;
const HOLE_RADIUS = 12;
const DOT_RADIUS = 5;
const EASE = [0.22, 1, 0.36, 1] as const;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const sameBox = (a: Box | undefined, b: Box) =>
  a !== undefined &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height;

/** The control's box in the viewport, followed every frame: it moves with the canvas, the sidebar and layout. */
function useBox(target: Element): Box | undefined {
  const [box, setBox] = useState<Box | undefined>(undefined);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      const rect = target.getBoundingClientRect();
      const next = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      setBox((current) => (sameBox(current, next) ? current : next));
      frame = window.requestAnimationFrame(read);
    };

    read();

    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  return box;
}

function Ping({ box }: { readonly box: Box }) {
  const reduce = useReducedMotion();
  const cx = box.x + box.width;
  const cy = box.y;

  return (
    <g className="fill-accent">
      {reduce ? null : (
        <motion.circle
          animate={{ r: DOT_RADIUS * 3.2, opacity: 0 }}
          cx={cx}
          cy={cy}
          initial={{ r: DOT_RADIUS, opacity: 0.6 }}
          transition={{ duration: 1.4, ease: "easeOut", repeat: Infinity }}
        />
      )}
      <circle cx={cx} cy={cy} r={DOT_RADIUS} />
    </g>
  );
}

/**
 * Lights `target` and dims the rest of the page while `shown`. Render the step's popover as usual: it sits above
 * the dimmed layer.
 */
export function Spotlight({
  target,
  shown,
}: {
  readonly target: Element;
  readonly shown: boolean;
}) {
  const box = useBox(target);
  const reduce = useReducedMotion();
  const mask = useId();

  if (box === undefined) return null;
  const hole = {
    x: box.x - HOLE_PADDING,
    y: box.y - HOLE_PADDING,
    width: box.width + HOLE_PADDING * 2,
    height: box.height + HOLE_PADDING * 2,
  };

  return createPortal(
    <AnimatePresence>
      {shown ? (
        <motion.svg
          key="spotlight"
          aria-hidden
          animate={{ opacity: 1 }}
          className="pointer-events-none fixed inset-0 z-40 size-full"
          exit={{ opacity: 0 }}
          initial={reduce ? false : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.25, ease: EASE }}
        >
          <defs>
            <mask id={mask}>
              <rect fill="white" height="100%" width="100%" />
              <rect fill="black" rx={HOLE_RADIUS} {...hole} />
            </mask>
          </defs>
          <rect
            className="fill-backdrop/70"
            height="100%"
            mask={`url(#${mask})`}
            width="100%"
          />
          <Ping box={box} />
        </motion.svg>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
