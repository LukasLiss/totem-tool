/**
 * HandoverSketch — a draft of the handover-of-work graph for the widget's
 * edit tile and settings popup, modelled on the explorer's graph without any
 * text: resources as nodes in the colors of the selected resource types and
 * handovers as arrows in the colors of the selected business object types
 * (both handed out in turn, so every selected type shows up about equally).
 * With "cluster by object type" there is one node per resource type instead.
 */

import React from "react";
import { cn } from "@/lib/utils";

const WIDTH = 380;
const HEIGHT = 200;
const INK = "var(--muted-foreground)";
// Space between an arrow's tip and the node it points at.
const TIP_GAP = 1.5;
// The object type legend in the top left, as the explorer shows it; the
// graph leaves that corner free and fills the space below and beside it.
const LEGEND_WIDTH = 72;
// Entries shown before the rest collapses into "+N more", and the longest
// name before it is cut off.
const LEGEND_MAX_ROWS = 4;
const LEGEND_MAX_CHARS = 12;

// The full graph: resources roughly in columns, handing work on left to
// right; the first column starts below the legend.
const NODES: [number, number][] = [
  [30, 96], [34, 166],
  [104, 34], [100, 122],
  [170, 72], [176, 160],
  [236, 28], [246, 112],
  [300, 66], [304, 166],
  [354, 112], [356, 36],
];
// Handovers as [from, to, width]; from === to is a resource handing work to itself.
const EDGES: [number, number, number][] = [
  [0, 2, 1.4], [0, 3, 3], [0, 0, 2.4],
  [1, 3, 2], [1, 5, 1.2], [1, 1, 2],
  [2, 4, 2.4], [2, 6, 1.2],
  [3, 4, 3.2], [3, 5, 1.4],
  [4, 7, 2.6], [4, 6, 1],
  [5, 7, 1.6], [5, 9, 1.2],
  [6, 8, 2], [6, 11, 1.2],
  [7, 8, 2.2], [7, 10, 1.4], [7, 7, 1.8],
  [8, 10, 2.4], [8, 11, 1],
  [9, 10, 1.6],
];
const NODE_RADIUS = 9;
const CLUSTER_NODE_RADIUS = 17;
const MAX_CLUSTER_NODES = 6;

type Point = [number, number];
type Arrow = { d: string; head: string; color: string; width: number };

/** Arrowhead length and half width, growing with the line so thick lines keep a visible tip. */
const headLength = (width: number) => 4.5 + width * 1.4;
const headHalfWidth = (width: number) => 2.2 + width * 0.8;

/**
 * The arrowhead at `tip`, pointing away from `control` (the curve's last
 * control point), and where the line has to stop so it ends inside the head
 * instead of running past its tip.
 */
function arrowHead(tip: Point, control: Point, width: number): { head: string; lineEnd: Point } {
  const dx = tip[0] - control[0];
  const dy = tip[1] - control[1];
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const length = headLength(width);
  const half = headHalfWidth(width);
  const bx = tip[0] - ux * length;
  const by = tip[1] - uy * length;
  return {
    head: `${tip[0]},${tip[1]} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`,
    lineEnd: [tip[0] - ux * (length - 1), tip[1] - uy * (length - 1)],
  };
}

/**
 * An arrow from one node to another, slightly curved by `bend` (so arrows
 * both ways between two nodes don't overlap), its tip just off the target's edge.
 */
function arrow(from: Point, to: Point, rFrom: number, rTo: number, bend: number, color: string, width: number): Arrow {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const sx = x1 + ux * rFrom;
  const sy = y1 + uy * rFrom;
  const tx = x2 - ux * (rTo + TIP_GAP);
  const ty = y2 - uy * (rTo + TIP_GAP);
  const cx = (sx + tx) / 2 - uy * bend;
  const cy = (sy + ty) / 2 + ux * bend;
  const { head, lineEnd } = arrowHead([tx, ty], [cx, cy], width);
  return { d: `M${sx},${sy} Q${cx},${cy} ${lineEnd[0]},${lineEnd[1]}`, head, color, width };
}

/**
 * A loop above a node, for work a resource hands to itself. `size` and
 * `spread` grow for nested loops, so their tips land side by side.
 */
function loop([x, y]: Point, r: number, size: number, color: string, width: number, spread = 0.42): Arrow {
  // A round loop like the explorer's: it leaves the node a little left of the
  // top, rises about `size` above it and comes back in a little right of the
  // top, so its arrowhead points back into the node.
  const sx = x - r * Math.sin(spread);
  const sy = y - r * Math.cos(spread);
  const tx = x + (r + TIP_GAP) * Math.sin(spread);
  const ty = y - (r + TIP_GAP) * Math.cos(spread);
  const lift = size * 1.33;
  const swing = size * 0.75;
  const c1: Point = [sx - swing, sy - lift];
  const c2: Point = [tx + swing, sy - lift];
  const { head, lineEnd } = arrowHead([tx, ty], c2, width);
  return { d: `M${sx},${sy} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${lineEnd[0]},${lineEnd[1]}`, head, color, width };
}

const HandoverSketch: React.FC<{
  /** The selected resource types (node colors); none draws grey nodes. */
  resourceTypes: string[];
  /** The selected business object types (arrow colors); none draws grey arrows. */
  businessObjectTypes: string[];
  /** Object type → color, as the explorer colors them. */
  typeColors: Record<string, string>;
  /** One node per resource type instead of one per resource. */
  clusterByOt: boolean;
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}> = ({ resourceTypes, businessObjectTypes, typeColors, clusterByOt, className }) => {
  const nodeColor = (i: number) =>
    resourceTypes.length ? typeColors[resourceTypes[i % resourceTypes.length]] ?? INK : INK;
  const arrowColor = (i: number) =>
    businessObjectTypes.length ? typeColors[businessObjectTypes[i % businessObjectTypes.length]] ?? INK : INK;

  let nodes: { point: Point; r: number; color: string }[];
  let edges: Arrow[];

  if (clusterByOt) {
    // One node per resource type in a ring, handing work to their neighbours
    // (both ways) and to themselves.
    const count = Math.min(Math.max(resourceTypes.length, resourceTypes.length ? 1 : 3), MAX_CLUSTER_NODES);
    const cx = WIDTH / 2 + 10;
    const cy = HEIGHT / 2 + 12;
    const ring = count === 1 ? 0 : count === 2 ? 70 : 64;
    const points: Point[] = Array.from({ length: count }, (_, i) => {
      const a = (i / count) * 2 * Math.PI + (count === 2 ? 0 : -Math.PI / 2);
      return [cx + ring * Math.cos(a) * (count === 2 ? 1 : 1.35), cy + ring * Math.sin(a)];
    });
    nodes = points.map((point, i) => ({ point, r: CLUSTER_NODE_RADIUS, color: nodeColor(i) }));
    edges = [];
    let e = 0;
    points.forEach((point) => {
      // Work kept within a type: nested loops above each node, one per arrow color (up to three).
      const loops = Math.min(3, Math.max(1, businessObjectTypes.length));
      for (let l = 0; l < loops; l++) {
        edges.push(loop(point, CLUSTER_NODE_RADIUS, 14 + l * 7, arrowColor(e++), 2, 0.42 + l * 0.16));
      }
    });
    if (count > 1) {
      points.forEach((point, i) => {
        const next = points[(i + 1) % count];
        if (count === 2 && i === 1) return;
        edges.push(arrow(point, next, CLUSTER_NODE_RADIUS, CLUSTER_NODE_RADIUS, 16, arrowColor(e++), 3));
        edges.push(arrow(next, point, CLUSTER_NODE_RADIUS, CLUSTER_NODE_RADIUS, 16, arrowColor(e++), 1.6));
      });
    }
  } else {
    nodes = NODES.map((point, i) => ({ point, r: NODE_RADIUS, color: nodeColor(i) }));
    edges = EDGES.map(([from, to, width], i) =>
      from === to
        ? loop(NODES[from], NODE_RADIUS, 13, arrowColor(i), width)
        : arrow(NODES[from], NODES[to], NODE_RADIUS, NODE_RADIUS, 0, arrowColor(i), width),
    );
  }

  // Legend entries as in the explorer: node types and arrow types together,
  // sorted. Without a selection, grey placeholder rows keep the card's shape.
  const legendTypes = [...new Set([...resourceTypes, ...businessObjectTypes])].sort();
  const overflow = legendTypes.length > LEGEND_MAX_ROWS;
  const legendRows = overflow ? legendTypes.slice(0, LEGEND_MAX_ROWS - 1) : legendTypes;
  const rowCount = legendTypes.length ? legendRows.length + (overflow ? 1 : 0) : 2;
  const legendHeight = 9 + rowCount * 9;
  const rowY = (i: number) => 15 + i * 9;
  const shortName = (t: string) => (t.length > LEGEND_MAX_CHARS ? `${t.slice(0, LEGEND_MAX_CHARS - 1)}…` : t);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the handover graph"
    >
      <rect x={4} y={6} width={LEGEND_WIDTH} height={legendHeight} rx={5} fill="var(--card)" stroke="var(--border)" strokeWidth={0.8} />
      {legendTypes.length
        ? legendRows.map((t, i) => (
            <g key={t}>
              <circle cx={13} cy={rowY(i)} r={2.4} fill={typeColors[t] ?? INK} />
              <text x={19} y={rowY(i)} dominantBaseline="central" fontSize={5.5} fill="var(--foreground)">
                {shortName(t)}
              </text>
            </g>
          ))
        : [0, 1].map((i) => (
            <g key={i}>
              <circle cx={13} cy={rowY(i)} r={2.4} fill={INK} opacity={0.45} />
              <rect x={19} y={rowY(i) - 1.5} width={i ? 26 : 36} height={3} rx={1.5} fill={INK} opacity={0.3} />
            </g>
          ))}
      {overflow && (
        <text x={11} y={rowY(legendRows.length)} dominantBaseline="central" fontSize={5} fill={INK}>
          +{legendTypes.length - legendRows.length} more
        </text>
      )}
      {/* Line and head share one group opacity, so they don't darken where they overlap. */}
      {edges.map((edge, i) => (
        <g key={i} opacity={businessObjectTypes.length ? 0.9 : 0.5}>
          <path d={edge.d} fill="none" stroke={edge.color} strokeWidth={edge.width} />
          <polygon points={edge.head} fill={edge.color} strokeLinejoin="round" />
        </g>
      ))}
      {nodes.map(({ point: [x, y], r, color }, i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={color} fillOpacity={resourceTypes.length ? 1 : 0.55} />
      ))}
    </svg>
  );
};

export default HandoverSketch;
