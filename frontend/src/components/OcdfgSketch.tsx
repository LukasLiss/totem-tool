/**
 * OcdfgSketch — a draft of the object-centric directly-follows graph for the
 * OCDFG widgets' edit tiles and settings popups, modelled on the visualizer
 * without any names: per object type a colored start and end node, white
 * activity boxes with a dot per object type they belong to, and one colored
 * arc per object type. It follows the layout
 * direction, and with "Show controls panel" the visualizer's title, legend
 * and toolbar appear top left (the lock button highlighted while interactions
 * start locked). The graph depends on the log, so it is a fixed example.
 */

import React, { useRef } from "react";
import { cn } from "@/lib/utils";
import { mapTypesToColors } from "@/utils/objectColors";
import SketchLockBadge from "./SketchLockBadge";
import { useSvgUnitsPerPixel } from "./sketchScale";

// Top to bottom: as wide as the graph (three columns of nodes), plus room
// on the right for the lock badge.
const TB_GRAPH_WIDTH = 186;
// Room on the left for the controls panel (title, legend, toolbar).
const CONTROLS_WIDTH = 72;
const LOCK_ROOM = 24;
// Top to bottom: room above and below, so the nearly square graph doesn't
// draw larger than the wide ones when a tile's height is what limits it.
const TB_PAD_Y = 24;
// Left to right: wide enough for the five layers to keep their spacing.
const WIDTH_LR = 360;
const HEIGHT = 220;
const INK = "var(--muted-foreground)";
const LINE = "#0f172a";
const TYPE_COLORS = Object.values(mapTypesToColors(["a", "b", "c"]));
const TYPES = [0, 1, 2];

const TERMINAL = { w: 22, h: 13 };
const ACTIVITY = { w: 46, h: 21 };
const ARROW = 4;

// Nodes on layers along the flow, with a position across it (-1..1).
type SketchNode = { layer: number; slot: number; kind: "terminal" | "activity"; types: number[]; label: number };
const NODES: Record<string, SketchNode> = {
  s0: { layer: 0, slot: -1, kind: "terminal", types: [0], label: 12 },
  s1: { layer: 0, slot: 0, kind: "terminal", types: [1], label: 12 },
  s2: { layer: 0, slot: 1, kind: "terminal", types: [2], label: 12 },
  a: { layer: 1, slot: -0.5, kind: "activity", types: [0, 1], label: 26 },
  b: { layer: 1, slot: 1, kind: "activity", types: [2], label: 20 },
  c: { layer: 2, slot: 0, kind: "activity", types: [0, 1, 2], label: 30 },
  d: { layer: 3, slot: -0.8, kind: "activity", types: [0], label: 22 },
  e: { layer: 3, slot: 0.5, kind: "activity", types: [1, 2], label: 28 },
  e0: { layer: 4, slot: -1, kind: "terminal", types: [0], label: 12 },
  e1: { layer: 4, slot: 0, kind: "terminal", types: [1], label: 12 },
  e2: { layer: 4, slot: 1, kind: "terminal", types: [2], label: 12 },
};
// Arcs as [from, to, object type].
const ARCS: [string, string, number][] = [
  ["s0", "a", 0], ["s1", "a", 1], ["s2", "b", 2],
  ["a", "c", 0], ["a", "c", 1], ["b", "c", 2],
  ["c", "d", 0], ["c", "e", 1], ["c", "e", 2],
  ["d", "e0", 0], ["e", "e1", 1], ["e", "e2", 2],
];

const OcdfgSketch: React.FC<{
  layoutDirection: "TB" | "LR";
  showControls: boolean;
  interactionLocked: boolean;
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}> = ({ layoutDirection, showControls, interactionLocked, className }) => {
  const lr = layoutDirection === "LR";
  // The controls panel takes the left edge. The graph's room is the same
  // either way, so it keeps its size: without the panel it just moves to the middle.
  const left = showControls ? CONTROLS_WIDTH : CONTROLS_WIDTH / 2;
  const width = lr ? WIDTH_LR : CONTROLS_WIDTH + TB_GRAPH_WIDTH + LOCK_ROOM;
  const svgRef = useRef<SVGSVGElement>(null);
  const padY = lr ? 0 : TB_PAD_Y;
  const viewHeight = HEIGHT + 2 * padY;
  const unitsPerPixel = useSvgUnitsPerPixel(svgRef, width, viewHeight);
  const place = ({ layer, slot }: SketchNode): [number, number] =>
    lr
      ? [left + 16 + layer * ((width - CONTROLS_WIDTH - 40) / 4), HEIGHT / 2 + slot * 62]
      : [left + TB_GRAPH_WIDTH / 2 + slot * 62, 16 + layer * 47];
  const size = (node: SketchNode) => (node.kind === "terminal" ? TERMINAL : ACTIVITY);

  const arcs = ARCS.map(([from, to, type], i) => {
    const a = NODES[from];
    const b = NODES[to];
    const [x1, y1] = place(a);
    const [x2, y2] = place(b);
    // Arcs of different types between the same nodes run side by side.
    const lane = (type - 1) * 4;
    let d: string;
    let head: string;
    if (lr) {
      const sx = x1 + size(a).w / 2;
      const ex = x2 - size(b).w / 2;
      const sy = y1 + lane;
      const ey = y2 + lane;
      const mx = (sx + ex) / 2;
      d = `M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex - ARROW},${ey}`;
      head = `${ex},${ey} ${ex - ARROW},${ey - 2.2} ${ex - ARROW},${ey + 2.2}`;
    } else {
      const sy = y1 + size(a).h / 2;
      const ey = y2 - size(b).h / 2;
      const sx = x1 + lane;
      const ex = x2 + lane;
      const my = (sy + ey) / 2;
      d = `M${sx},${sy} C${sx},${my} ${ex},${my} ${ex},${ey - ARROW}`;
      head = `${ex},${ey} ${ex - 2.2},${ey - ARROW} ${ex + 2.2},${ey - ARROW}`;
    }
    return (
      <g key={i}>
        <path d={d} fill="none" stroke={TYPE_COLORS[type]} strokeWidth={1.4} />
        <polygon points={head} fill={TYPE_COLORS[type]} />
      </g>
    );
  });

  return (
    <svg
      ref={svgRef}
      viewBox={`0 ${-padY} ${width} ${viewHeight}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the object-centric directly-follows graph"
    >
      {arcs}

      {Object.entries(NODES).map(([id, node]) => {
        const [x, y] = place(node);
        const { w, h } = size(node);
        if (node.kind === "terminal") {
          return (
            <g key={id}>
              <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={3} fill={TYPE_COLORS[node.types[0]]} />
              <rect x={x - node.label / 2} y={y - 1.2} width={node.label} height={2.4} rx={1.2} fill="#ffffff" opacity={0.8} />
            </g>
          );
        }
        // An activity: its name and a dot per object type, filled where it belongs.
        return (
          <g key={id}>
            <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={4} fill="#ffffff" stroke={LINE} strokeWidth={0.7} />
            <rect x={x - node.label / 2} y={y - 5.5} width={node.label} height={2.6} rx={1.3} fill={INK} opacity={0.55} />
            {node.types.map((t, i) => (
              <circle key={t} cx={x + (i - (node.types.length - 1) / 2) * 6} cy={y + 4} r={2} fill={TYPE_COLORS[t]} />
            ))}
          </g>
        );
      })}

      {/* The visualizer's controls: title, legend and toolbar. */}
      {showControls && (
        <g>
          <rect x={8} y={8} width={44} height={3.6} rx={1.8} fill="var(--foreground)" opacity={0.7} />
          <rect x={6} y={18} width={58} height={38} rx={4} fill="#ffffff" stroke="#e5e7eb" strokeWidth={0.7} />
          <rect x={11} y={23.5} width={26} height={2.6} rx={1.3} fill={INK} opacity={0.55} />
          {TYPES.map((t) => (
            <g key={t}>
              <circle cx={13} cy={33 + t * 8} r={2.2} fill={TYPE_COLORS[t]} />
              <rect x={18} y={31.8 + t * 8} width={[28, 22, 32][t]} height={2.4} rx={1.2} fill={INK} opacity={0.35} />
            </g>
          ))}
          <rect x={6} y={61} width={58} height={13} rx={6.5} fill="#ffffff" stroke="#e2e8f0" strokeWidth={0.7} />
          {[0, 1, 2, 3].map((i) => (
            <circle
              key={i}
              cx={15 + i * 13.3}
              cy={67.5}
              r={3.6}
              fill={i === 3 && interactionLocked ? "#e2e8f0" : "#ffffff"}
              stroke="#cbd5e1"
              strokeWidth={0.6}
            />
          ))}
        </g>
      )}

      {/* Interactions start locked: a lock badge top right, with or without the controls. */}
      {interactionLocked && <SketchLockBadge right={width} top={-padY} unitsPerPixel={unitsPerPixel} />}
    </svg>
  );
};

export default OcdfgSketch;
