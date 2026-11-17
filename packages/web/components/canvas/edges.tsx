"use client";

// The canvas edge. Unselected, it is xyflow's default bezier edge (dashed and moving while ghost). Selected,
// it is a solid accent line with a brighter segment running along it from source to target, so the eye can follow
// one flow through the graph. Under reduced motion the line stays a static accent highlight. A selected ghost edge
// keeps a fainter line, so ghost and solid stay apart.

import type { Edge, EdgeProps, EdgeTypes } from "@xyflow/react";

import { BaseEdge, EdgeText, getBezierPath } from "@xyflow/react";
import { motion, useReducedMotion } from "motion/react";

export interface FlowEdgeData extends Record<string, unknown> {
  readonly ghost: boolean;
}

export type FlowEdge = Edge<FlowEdgeData, "flow">;

/** One run of the light from source to target. */
const RUN_SECONDS = 1.6;
/** The light's length as a share of the edge. */
const LIGHT = 0.18;

function FlowEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  label,
  markerEnd,
  markerStart,
  interactionWidth,
  data,
}: EdgeProps<FlowEdge>) {
  const reduced = useReducedMotion();
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  if (selected !== true)
    return (
      <BaseEdge
        id={id}
        interactionWidth={interactionWidth}
        label={label}
        labelX={labelX}
        labelY={labelY}
        markerEnd={markerEnd}
        markerStart={markerStart}
        path={path}
      />
    );

  return (
    <>
      <path
        d={path}
        fill="none"
        stroke="var(--accent)"
        strokeOpacity={data?.ghost === true ? 0.35 : 0.55}
        strokeWidth={2.5}
      />
      {reduced === true ? null : (
        <motion.path
          animate={{ pathOffset: [-LIGHT, 1] }}
          d={path}
          fill="none"
          initial={{ pathLength: LIGHT, pathOffset: -LIGHT }}
          stroke="var(--accent)"
          strokeLinecap="round"
          strokeWidth={3.5}
          transition={{
            duration: RUN_SECONDS,
            ease: "linear",
            repeat: Infinity,
          }}
        />
      )}
      <path
        className="react-flow__edge-interaction"
        d={path}
        fill="none"
        strokeOpacity={0}
        strokeWidth={interactionWidth ?? 20}
      />
      {label === undefined || label === null ? null : (
        <EdgeText label={label} x={labelX} y={labelY} />
      )}
    </>
  );
}

export const edgeTypes = { flow: FlowEdgeView } satisfies EdgeTypes;
