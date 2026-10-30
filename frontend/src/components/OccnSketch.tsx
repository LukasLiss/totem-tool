/**
 * OccnSketch — a draft of the object-centric causal net for the OCCN widget's
 * edit tile and settings popup, modelled on the visualizer without any names:
 * per object type a colored start and end square (play and stop glyph),
 * activities striped in light tones of their object types, arcs in the type
 * colors, and the binding markers on the arcs next to each activity (circles
 * for exactly one, squares for other cardinalities) with dark lines joining
 * the markers bound together. It follows the layout direction; with "Show
 * controls panel" the title, legend and toolbar (its threshold slider at the
 * set threshold) appear top left, and a lock badge shows while interactions
 * start locked. The net depends on the log, so it is a fixed example.
 */

import React from "react";
import { cn } from "@/lib/utils";
import { mapTypesToColors } from "@/utils/objectColors";

// Wider when the flow runs left to right, so the five layers keep their spacing.
const WIDTH_TB = 300;
const WIDTH_LR = 420;
const HEIGHT = 240;
const INK = "var(--muted-foreground)";
const OUTLINE = "#0f172a";
const TYPE_COLORS = Object.values(mapTypesToColors(["a", "b", "c"]));
const TYPES = [0, 1, 2];

const TERMINAL = 13;
const ACTIVITY = { w: 46, h: 17 };
const ARROW = 3.5;
const MARKER = 3.2;
// Where the markers sit along an arc: a fifth of the way from the activity.
const MARKER_T = 0.2;

/** A light tone of a type color, as the activities' stripes use them. */
function lighten(hex: string, amount = 0.45): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

// Nodes on layers along the flow, with a position across it (-1..1).
type SketchNode = { layer: number; slot: number; kind: "start" | "end" | "activity"; types: number[]; label: number };
const NODES: Record<string, SketchNode> = {
  s0: { layer: 0, slot: -1, kind: "start", types: [0], label: 12 },
  s1: { layer: 0, slot: 0, kind: "start", types: [1], label: 12 },
  s2: { layer: 0, slot: 1, kind: "start", types: [2], label: 12 },
  a: { layer: 1, slot: -0.5, kind: "activity", types: [0, 1], label: 26 },
  b: { layer: 1, slot: 1, kind: "activity", types: [2], label: 20 },
  c: { layer: 2, slot: 0, kind: "activity", types: [0, 1, 2], label: 30 },
  d: { layer: 3, slot: -0.8, kind: "activity", types: [0], label: 22 },
  e: { layer: 3, slot: 0.5, kind: "activity", types: [1, 2], label: 28 },
  e0: { layer: 4, slot: -1, kind: "end", types: [0], label: 12 },
  e1: { layer: 4, slot: 0, kind: "end", types: [1], label: 12 },
  e2: { layer: 4, slot: 1, kind: "end", types: [2], label: 12 },
};
// Arcs as [from, to, object type, cardinality other than one at the source / target].
const ARCS: [string, string, number, boolean, boolean][] = [
  ["s0", "a", 0, false, false], ["s1", "a", 1, false, false], ["s2", "b", 2, false, false],
  ["a", "c", 0, false, false], ["a", "c", 1, false, false], ["b", "c", 2, true, true],
  ["c", "d", 0, false, false], ["c", "e", 1, false, false], ["c", "e", 2, true, true],
  ["d", "e0", 0, false, false], ["e", "e1", 1, false, false], ["e", "e2", 2, false, false],
];
// Markers bound together (one binding): [activity, "in" | "out", arc indexes].
const BINDINGS: [string, "in" | "out", number[]][] = [
  ["a", "in", [0, 1]],
  ["a", "out", [3, 4]],
  ["c", "in", [3, 4, 5]],
  ["c", "out", [7, 8]],
  ["e", "in", [7, 8]],
];

const OccnSketch: React.FC<{
  layoutDirection: "TB" | "LR";
  showControls: boolean;
  interactionLocked: boolean;
  /** The frequency threshold (0..1), shown on the toolbar's slider. */
  threshold: number;
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}> = ({ layoutDirection, showControls, interactionLocked, threshold, className }) => {
  const lr = layoutDirection === "LR";
  const width = lr ? WIDTH_LR : WIDTH_TB;
  // The controls panel takes the left edge; the graph uses the rest.
  const left = showControls ? 72 : 8;
  const place = ({ layer, slot }: SketchNode): [number, number] =>
    lr
      ? [left + 16 + layer * ((width - left - 40) / 4), HEIGHT / 2 + slot * 62]
      : [(left + width) / 2 + slot * 62, 16 + layer * ((HEIGHT - 32) / 4)];
  const size = (node: SketchNode) =>
    node.kind === "activity" ? ACTIVITY : { w: TERMINAL, h: TERMINAL };

  // Arcs, and where their markers sit: on the arc, a fifth of the way from the
  // activity it leaves or enters, where arcs of a binding have spread apart.
  const markerAt = new Map<string, [number, number]>();
  const arcs = ARCS.map(([from, to, type], i) => {
    const a = NODES[from];
    const b = NODES[to];
    const [x1, y1] = place(a);
    const [x2, y2] = place(b);
    // Arcs of different types run side by side, far enough apart for their markers.
    const lane = (type - 1) * 6;
    let p: [number, number][];
    let head: string;
    if (lr) {
      const sx = x1 + size(a).w / 2;
      const ex = x2 - size(b).w / 2;
      const sy = y1 + (a.kind === "activity" ? lane : 0);
      const ey = y2 + (b.kind === "activity" ? lane : 0);
      const mx = (sx + ex) / 2;
      p = [[sx, sy], [mx, sy], [mx, ey], [ex - ARROW, ey]];
      head = `${ex},${ey} ${ex - ARROW},${ey - 2} ${ex - ARROW},${ey + 2}`;
    } else {
      const sy = y1 + size(a).h / 2;
      const ey = y2 - size(b).h / 2;
      const sx = x1 + (a.kind === "activity" ? lane : 0);
      const ex = x2 + (b.kind === "activity" ? lane : 0);
      const my = (sy + ey) / 2;
      p = [[sx, sy], [sx, my], [ex, my], [ex, ey - ARROW]];
      head = `${ex},${ey} ${ex - 2},${ey - ARROW} ${ex + 2},${ey - ARROW}`;
    }
    const at = (t: number): [number, number] => {
      const u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [0, 1].map((k) => w.reduce((sum, wi, j) => sum + wi * p[j][k], 0)) as [number, number];
    };
    markerAt.set(`${i}:out`, at(MARKER_T));
    markerAt.set(`${i}:in`, at(1 - MARKER_T));
    const d = `M${p[0].join(",")} C${p[1].join(",")} ${p[2].join(",")} ${p[3].join(",")}`;
    return (
      <g key={i}>
        <path d={d} fill="none" stroke={TYPE_COLORS[type]} strokeWidth={1.3} />
        <polygon points={head} fill={TYPE_COLORS[type]} />
      </g>
    );
  });

  // Binding markers on the arcs next to activities only (start and end have none).
  const markers = ARCS.flatMap(([from, to, type, manyOut, manyIn], i) => {
    const out: { key: string; at: [number, number]; type: number; square: boolean }[] = [];
    if (NODES[from].kind === "activity") out.push({ key: `${i}:out`, at: markerAt.get(`${i}:out`)!, type, square: manyOut });
    if (NODES[to].kind === "activity") out.push({ key: `${i}:in`, at: markerAt.get(`${i}:in`)!, type, square: manyIn });
    return out;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the object-centric causal net"
    >
      {arcs}

      {/* Lines joining the markers of one binding, below the markers. */}
      {BINDINGS.map(([, side, arcIndexes], i) => (
        <polyline
          key={i}
          points={arcIndexes
            .map((arc) => markerAt.get(`${arc}:${side}`)!)
            // Across the flow, so the line runs from one side of the binding to the other.
            .sort((p, q) => (lr ? p[1] - q[1] : p[0] - q[0]))
            .map((point) => point.join(","))
            .join(" ")}
          fill="none"
          stroke={OUTLINE}
          strokeOpacity={0.7}
          strokeWidth={0.6}
        />
      ))}
      {markers.map(({ key, at: [x, y], type, square }) =>
        square ? (
          <rect key={key} x={x - MARKER / 2} y={y - MARKER / 2} width={MARKER} height={MARKER} fill={TYPE_COLORS[type]} stroke={OUTLINE} strokeWidth={0.5} />
        ) : (
          <circle key={key} cx={x} cy={y} r={MARKER / 2} fill={TYPE_COLORS[type]} stroke={OUTLINE} strokeWidth={0.5} />
        ),
      )}

      {Object.entries(NODES).map(([id, node]) => {
        const [x, y] = place(node);
        if (node.kind !== "activity") {
          const color = TYPE_COLORS[node.types[0]];
          return (
            <g key={id}>
              <rect x={x - TERMINAL / 2} y={y - TERMINAL / 2} width={TERMINAL} height={TERMINAL} rx={3} fill={color} stroke={OUTLINE} strokeOpacity={0.55} strokeWidth={0.5} />
              {node.kind === "start" ? (
                <polygon points={`${x - 2},${y - 3} ${x + 3.2},${y} ${x - 2},${y + 3}`} fill="#ffffff" />
              ) : (
                <rect x={x - 2.6} y={y - 2.6} width={5.2} height={5.2} fill="#ffffff" />
              )}
              {/* The object type's name below, in its color. */}
              <rect x={x - node.label / 2} y={y + TERMINAL / 2 + 2.5} width={node.label} height={2.2} rx={1.1} fill={color} opacity={0.6} />
            </g>
          );
        }
        // An activity: one horizontal stripe per object type, in a light tone of its color.
        const { w, h } = ACTIVITY;
        const stripe = h / node.types.length;
        const clipId = `occn-sketch-${id}`;
        return (
          <g key={id}>
            <clipPath id={clipId}>
              <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={4} />
            </clipPath>
            <g clipPath={`url(#${clipId})`}>
              {node.types.map((t, i) => (
                <rect key={t} x={x - w / 2} y={y - h / 2 + i * stripe} width={w} height={stripe} fill={lighten(TYPE_COLORS[t])} />
              ))}
            </g>
            <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={4} fill="none" stroke={OUTLINE} strokeOpacity={0.45} strokeWidth={0.7} />
            <rect x={x - node.label / 2} y={y - 1.3} width={node.label} height={2.6} rx={1.3} fill={OUTLINE} opacity={0.5} />
          </g>
        );
      })}

      {/* The visualizer's controls: title, legend and toolbar with the threshold slider. */}
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
          <rect x={12} y={66.8} width={30} height={1.4} rx={0.7} fill="#e2e8f0" />
          <rect x={12} y={66.8} width={30 * Math.min(1, Math.max(0, threshold))} height={1.4} rx={0.7} fill={INK} opacity={0.6} />
          <circle cx={12 + 30 * Math.min(1, Math.max(0, threshold))} cy={67.5} r={2.3} fill="#ffffff" stroke={INK} strokeWidth={0.6} />
          <circle cx={53} cy={67.5} r={3.6} fill={interactionLocked ? "#e2e8f0" : "#ffffff"} stroke="#cbd5e1" strokeWidth={0.6} />
        </g>
      )}

      {/* Interactions start locked: a lock badge top right, with or without the controls. */}
      {interactionLocked && (
        <g transform={`translate(${width - 12} 12)`}>
          <circle r={7} fill="#ffffff" stroke="#e2e8f0" strokeWidth={0.7} />
          <path d="M-1.6,-0.4 V-1.8 A1.6,1.6 0 0 1 1.6,-1.8 V-0.4" fill="none" stroke="#475569" strokeWidth={0.8} strokeLinecap="round" />
          <rect x={-2.5} y={-0.4} width={5} height={3.6} rx={0.6} fill="#475569" />
        </g>
      )}
    </svg>
  );
};

export default OccnSketch;
