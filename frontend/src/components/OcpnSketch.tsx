/**
 * OcpnSketch — a draft of the object-centric Petri net for the OCPN widget's
 * edit tile and settings popup, modelled on the visualizer without any names:
 * places as circles in their object type's color (initial and final ones
 * filled, with a play or stop glyph), white transitions with their type dots,
 * a dark silent transition, and arcs in the place's color, variable arcs as a
 * double line, laid out left to right. The net depends on the log, so the
 * draft is a fixed example: three object types meeting in one transition.
 */

import React from "react";
import { cn } from "@/lib/utils";
import { mapTypesToColors } from "@/utils/objectColors";

const WIDTH = 310;
const HEIGHT = 152;
const INK = "var(--muted-foreground)";
// Blue, green and orange, as in the OCDFG draft.
const TYPE = Object.values(mapTypesToColors(["a", "b", "c"]));

const PLACE_R = 8;
const TRANSITION = { w: 30, h: 16 };
const SILENT = { w: 14, h: 10 };
const ARROW = 4;

type SketchNode =
  | { kind: "place"; x: number; y: number; type: number; marker?: "initial" | "final" }
  | { kind: "transition"; x: number; y: number; types: number[]; label: number }
  | { kind: "silent"; x: number; y: number };

// One row per object type; they meet in the middle transition.
const ROW_A = 30;
const ROW_G = 76;
const ROW_B = 122;
const NODES: Record<string, SketchNode> = {
  sA: { kind: "place", x: 20, y: ROW_A, type: 0, marker: "initial" },
  sG: { kind: "place", x: 20, y: ROW_G, type: 1, marker: "initial" },
  sB: { kind: "place", x: 20, y: ROW_B, type: 2, marker: "initial" },
  t1: { kind: "transition", x: 64, y: ROW_A, types: [0], label: 18 },
  tG1: { kind: "transition", x: 64, y: ROW_G, types: [1], label: 22 },
  t3: { kind: "transition", x: 64, y: ROW_B, types: [2], label: 20 },
  pA1: { kind: "place", x: 108, y: ROW_A, type: 0 },
  pG1: { kind: "place", x: 108, y: ROW_G, type: 1 },
  pB1: { kind: "place", x: 108, y: ROW_B, type: 2 },
  t2: { kind: "transition", x: 154, y: ROW_G, types: [0, 1, 2], label: 22 },
  pA2: { kind: "place", x: 200, y: ROW_A, type: 0 },
  pG2: { kind: "place", x: 200, y: ROW_G, type: 1 },
  pB2: { kind: "place", x: 200, y: ROW_B, type: 2 },
  t4: { kind: "transition", x: 244, y: ROW_A, types: [0], label: 16 },
  tG2: { kind: "transition", x: 244, y: ROW_G, types: [1], label: 20 },
  tau: { kind: "silent", x: 244, y: ROW_B },
  eA: { kind: "place", x: 288, y: ROW_A, type: 0, marker: "final" },
  eG: { kind: "place", x: 288, y: ROW_G, type: 1, marker: "final" },
  eB: { kind: "place", x: 288, y: ROW_B, type: 2, marker: "final" },
};
// Arcs as [from, to, object type, variable].
const ARCS: [string, string, number, boolean][] = [
  ["sA", "t1", 0, false], ["t1", "pA1", 0, false], ["pA1", "t2", 0, false],
  ["t2", "pA2", 0, false], ["pA2", "t4", 0, false], ["t4", "eA", 0, false],
  ["sG", "tG1", 1, false], ["tG1", "pG1", 1, false], ["pG1", "t2", 1, false],
  ["t2", "pG2", 1, false], ["pG2", "tG2", 1, false], ["tG2", "eG", 1, false],
  ["sB", "t3", 2, false], ["t3", "pB1", 2, false], ["pB1", "t2", 2, true],
  ["t2", "pB2", 2, true], ["pB2", "tau", 2, false], ["tau", "eB", 2, false],
];

/** Half the node's width, where arcs leave and arrive. */
const halfWidth = (node: SketchNode) =>
  node.kind === "place" ? PLACE_R : node.kind === "silent" ? SILENT.w / 2 : TRANSITION.w / 2;

const OcpnSketch: React.FC<{
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}> = ({ className }) => (
  <svg
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    className={cn("mx-auto block", className ?? "w-full max-w-sm")}
    role="img"
    aria-label="Layout sketch of the object-centric Petri net"
  >
    {ARCS.map(([from, to, type, variable], i) => {
      const a = NODES[from];
      const b = NODES[to];
      const sx = a.x + halfWidth(a);
      const ex = b.x - halfWidth(b) - 1;
      const mx = (sx + ex) / 2;
      // Arcs meeting a transition from above and below arrive (and leave) a
      // little apart, so their arrowheads don't overlap.
      const sy = a.kind === "transition" && a.y !== b.y ? a.y + Math.sign(b.y - a.y) * 5.5 : a.y;
      const ey = b.kind === "transition" && a.y !== b.y ? b.y + Math.sign(a.y - b.y) * 5.5 : b.y;
      const d = `M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex - ARROW},${ey}`;
      const color = TYPE[type];
      return (
        <g key={i}>
          <path d={d} fill="none" stroke={color} strokeWidth={variable ? 3.6 : 1.3} />
          {/* A variable arc is a double line: a white core in a wide stroke. */}
          {variable && <path d={d} fill="none" stroke="var(--background, #fff)" strokeWidth={1.3} />}
          <polygon points={`${ex},${ey} ${ex - ARROW},${ey - 2.4} ${ex - ARROW},${ey + 2.4}`} fill={color} />
        </g>
      );
    })}

    {Object.entries(NODES).map(([id, node]) => {
      if (node.kind === "place") {
        const color = TYPE[node.type];
        return (
          <g key={id}>
            <circle cx={node.x} cy={node.y} r={PLACE_R} fill={node.marker ? color : "#ffffff"} stroke={color} strokeWidth={1.4} />
            {node.marker === "initial" && (
              <polygon points={`${node.x - 2},${node.y - 3} ${node.x + 3.2},${node.y} ${node.x - 2},${node.y + 3}`} fill="#ffffff" />
            )}
            {node.marker === "final" && <rect x={node.x - 2.6} y={node.y - 2.6} width={5.2} height={5.2} rx={0.6} fill="#ffffff" />}
            {/* The place's name below it. */}
            <rect x={node.x - 6} y={node.y + PLACE_R + 3} width={12} height={2} rx={1} fill={INK} opacity={0.35} />
          </g>
        );
      }
      if (node.kind === "silent") {
        return (
          <rect key={id} x={node.x - SILENT.w / 2} y={node.y - SILENT.h / 2} width={SILENT.w} height={SILENT.h} rx={3} fill="#0f172a" />
        );
      }
      return (
        <g key={id}>
          <rect
            x={node.x - TRANSITION.w / 2}
            y={node.y - TRANSITION.h / 2}
            width={TRANSITION.w}
            height={TRANSITION.h}
            rx={3}
            fill="#ffffff"
            stroke="#cbd5e1"
            strokeWidth={0.8}
          />
          <rect x={node.x - node.label / 2} y={node.y - 4} width={node.label} height={2.4} rx={1.2} fill={INK} opacity={0.55} />
          {node.types.map((t, i) => (
            <circle key={t} cx={node.x + (i - (node.types.length - 1) / 2) * 4.5} cy={node.y + 3.5} r={1.6} fill={TYPE[t]} />
          ))}
        </g>
      );
    })}
  </svg>
);

export default OcpnSketch;
