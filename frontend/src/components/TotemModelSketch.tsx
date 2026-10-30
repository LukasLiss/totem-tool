/**
 * TotemModelSketch — a draft of the TOTeM model for the widget's edit tile,
 * modelled on the miner's graph without any names: object types as colored
 * boxes, their relations as straight links with an ellipse label halfway,
 * cardinalities near both ends and the end markers (a block at one end;
 * double bars at both ends of a parallel relation). The model depends on the
 * log, so the draft is a fixed example; every label is a placeholder.
 */

import React from "react";
import { cn } from "@/lib/utils";
import { mapTypesToColors } from "@/utils/objectColors";

const WIDTH = 310;
const HEIGHT = 232;
const INK = "var(--muted-foreground)";
const LINK = "#1e293b";
const BOX_W = 36;
const BOX_H = 12;

// The first colors of the object type palette, as the miner hands them out.
const TYPE_COLORS = Object.values(mapTypesToColors(["a", "b", "c", "d", "e", "f"]));

type Point = [number, number];
// Object types: position (box center), color and placeholder name length.
const NODES: { at: Point; color: string; label: number }[] = [
  { at: [122, 16], color: TYPE_COLORS[3], label: 16 },
  { at: [278, 58], color: TYPE_COLORS[5], label: 20 },
  { at: [22, 113], color: TYPE_COLORS[2], label: 14 },
  { at: [161, 117], color: TYPE_COLORS[1], label: 22 },
  { at: [272, 186], color: TYPE_COLORS[4], label: 20 },
  { at: [112, 216], color: TYPE_COLORS[0], label: 22 },
];
// Relations as [from, to, where the ellipse sits (0..1), end marker]: "to"
// puts a block at the target; "parallel" double bars at both ends.
const EDGES: [number, number, number, "to" | "parallel"][] = [
  [0, 2, 0.45, "to"],
  [0, 3, 0.55, "to"],
  [0, 1, 0.6, "to"],
  [0, 5, 0.3, "to"],
  [2, 1, 0.68, "to"],
  [2, 3, 0.45, "to"],
  [4, 2, 0.4, "to"],
  [2, 5, 0.6, "to"],
  [3, 1, 0.6, "parallel"],
  [4, 3, 0.45, "to"],
  [5, 3, 0.55, "parallel"],
  [5, 1, 0.62, "to"],
  [4, 1, 0.5, "to"],
];

/** Where the line from a box's center towards `toward` leaves the box. */
function boxExit([x, y]: Point, [tx, ty]: Point): Point {
  const dx = tx - x;
  const dy = ty - y;
  const s = Math.min((BOX_W / 2 + 1) / (Math.abs(dx) || 1e-6), (BOX_H / 2 + 1) / (Math.abs(dy) || 1e-6));
  return [x + dx * s, y + dy * s];
}

/** Double bars across the link, just outside the box. */
function ParallelBars({ at, ux, uy }: { at: Point; ux: number; uy: number }) {
  return (
    <g stroke={LINK} strokeWidth={1.1}>
      {[2, 4].map((d) => {
        const cx = at[0] + ux * d;
        const cy = at[1] + uy * d;
        return <line key={d} x1={cx - uy * 3} y1={cy + ux * 3} x2={cx + uy * 3} y2={cy - ux * 3} />;
      })}
    </g>
  );
}

const TotemModelSketch: React.FC<{
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}> = ({ className }) => (
  <svg
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    className={cn("mx-auto block", className ?? "w-full max-w-sm")}
    role="img"
    aria-label="Layout sketch of the TOTeM model"
  >
    {EDGES.map(([a, b, t, marker], i) => {
      const from = boxExit(NODES[a].at, NODES[b].at);
      const to = boxExit(NODES[b].at, NODES[a].at);
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const mx = from[0] + dx * t;
      const my = from[1] + dy * t;
      // Keep the ellipse's text direction readable: never upside down.
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      // Cardinality placeholders near both ends, beside the link.
      const cardinality = (p: Point, dir: number) => {
        const cx = p[0] + ux * 12 * dir - uy * 4;
        const cy = p[1] + uy * 12 * dir + ux * 4;
        return <rect x={cx - 2.5} y={cy - 1} width={5} height={2} rx={1} fill={INK} opacity={0.45} />;
      };
      return (
        <g key={i}>
          <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={LINK} strokeWidth={0.7} />
          <g transform={`translate(${mx} ${my}) rotate(${angle})`}>
            <ellipse rx={11} ry={3.8} fill="var(--background, #fff)" stroke={LINK} strokeWidth={0.6} />
            <rect x={-6} y={-0.9} width={12} height={1.8} rx={0.9} fill={INK} opacity={0.5} />
          </g>
          {cardinality(from, 1)}
          {cardinality(to, -1)}
          {marker === "to" ? (
            <rect x={to[0] - ux * 1.5 - 1.5} y={to[1] - uy * 1.5 - 1.5} width={3} height={3} fill={LINK} />
          ) : (
            <>
              <ParallelBars at={from} ux={ux} uy={uy} />
              <ParallelBars at={to} ux={-ux} uy={-uy} />
            </>
          )}
        </g>
      );
    })}

    {/* Object types: colored boxes with a placeholder name. */}
    {NODES.map(({ at: [x, y], color, label }, i) => (
      <g key={i}>
        <rect x={x - BOX_W / 2} y={y - BOX_H / 2} width={BOX_W} height={BOX_H} rx={2.5} fill={color} />
        <rect x={x - label / 2} y={y - 1.25} width={label} height={2.5} rx={1.25} fill="#ffffff" opacity={0.75} />
      </g>
    ))}
  </svg>
);

export default TotemModelSketch;
