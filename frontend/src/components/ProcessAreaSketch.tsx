/**
 * ProcessAreaSketch — a draft of the process area for the widget's edit tile
 * and settings popup, modelled on the visualizer without any names: object
 * types as colored boxes on their levels, grouped into light process areas,
 * connected by dark orthogonal links with their end markers, and the level
 * captions on the right. The result depends on the log, so the draft is a
 * fixed example; box labels and type counts are placeholders.
 */

import React from "react";
import { cn } from "@/lib/utils";
import { mapTypesToColors } from "@/utils/objectColors";

const WIDTH = 320;
const HEIGHT = 196;
const INK = "var(--muted-foreground)";
const LINK = "#1e293b";
const AREA_FILL = "#e0e7ff";
const AREA_STROKE = "#c7d2fe";

// The first colors of the object type palette, as the visualizer hands them out.
const TYPE_COLORS = Object.values(mapTypesToColors(["a", "b", "c", "d", "e", "f", "g"]));

// Grid: five columns, and the levels from the top (highest) to the bottom (0).
const COLUMNS = [30, 84, 138, 192, 246];
const LEVEL_Y = [22, 60, 98, 136, 174];
const BOX_W = 44;
const BOX_H = 18;
const AREA_PAD = 4;

type Box = { col: number; row: number; color: string; label: number };
// Process areas, each a row of object types on one level.
const AREAS: Box[][] = [
  [{ col: 2, row: 0, color: TYPE_COLORS[2], label: 22 }],
  [{ col: 3, row: 1, color: TYPE_COLORS[6], label: 20 }],
  [
    { col: 0, row: 2, color: TYPE_COLORS[1], label: 26 },
    { col: 1, row: 2, color: TYPE_COLORS[4], label: 28 },
  ],
  [{ col: 4, row: 2, color: TYPE_COLORS[5], label: 18 }],
  [{ col: 2, row: 3, color: TYPE_COLORS[0], label: 24 }],
  [{ col: 3, row: 4, color: TYPE_COLORS[3], label: 26 }],
];

// End markers as in the visualizer: a filled block or a pair of bars, across
// a link that leaves a box vertically ("v") or horizontally ("h").
type Marker = { x: number; y: number; dir: "v" | "h"; kind: "block" | "bars" };
const LINKS: { d: string; ends: Marker[] }[] = [
  { d: "M134,31 V127", ends: [{ x: 134, y: 31, dir: "v", kind: "block" }, { x: 134, y: 127, dir: "v", kind: "bars" }] },
  { d: "M141,31 V59 Q141,63 145,63 H170", ends: [{ x: 141, y: 31, dir: "v", kind: "bars" }, { x: 170, y: 63, dir: "h", kind: "bars" }] },
  { d: "M84,89 V60 Q84,56 88,56 H170", ends: [{ x: 84, y: 89, dir: "v", kind: "bars" }, { x: 170, y: 56, dir: "h", kind: "block" }] },
  { d: "M106,98 H121 Q125,98 125,102 V127", ends: [{ x: 106, y: 98, dir: "h", kind: "bars" }, { x: 125, y: 127, dir: "v", kind: "bars" }] },
  { d: "M146,127 V98 Q146,94 150,94 H224", ends: [{ x: 146, y: 127, dir: "v", kind: "block" }, { x: 224, y: 94, dir: "h", kind: "block" }] },
  { d: "M192,165 V106 Q192,102 196,102 H224", ends: [{ x: 192, y: 165, dir: "v", kind: "block" }, { x: 224, y: 102, dir: "h", kind: "block" }] },
  { d: "M138,145 V170 Q138,174 142,174 H170", ends: [{ x: 138, y: 145, dir: "v", kind: "block" }, { x: 170, y: 174, dir: "h", kind: "block" }] },
];

function EndMarker({ x, y, dir, kind }: Marker) {
  if (kind === "block") {
    return dir === "v"
      ? <rect x={x - 3} y={y - 1.5} width={6} height={3} fill={LINK} />
      : <rect x={x - 1.5} y={y - 3} width={3} height={6} fill={LINK} />;
  }
  return dir === "v" ? (
    <g stroke={LINK} strokeWidth={0.8}>
      <line x1={x - 3} x2={x + 3} y1={y - 1} y2={y - 1} />
      <line x1={x - 3} x2={x + 3} y1={y + 1} y2={y + 1} />
    </g>
  ) : (
    <g stroke={LINK} strokeWidth={0.8}>
      <line x1={x - 1} x2={x - 1} y1={y - 3} y2={y + 3} />
      <line x1={x + 1} x2={x + 1} y1={y - 3} y2={y + 3} />
    </g>
  );
}

const ProcessAreaSketch: React.FC<{
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}> = ({ className }) => (
  <svg
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    className={cn("mx-auto block", className ?? "w-full max-w-sm")}
    role="img"
    aria-label="Layout sketch of the process area"
  >
    {/* Process areas behind their object types. */}
    {AREAS.map((boxes, i) => {
      const left = COLUMNS[boxes[0].col] - BOX_W / 2 - AREA_PAD;
      const right = COLUMNS[boxes[boxes.length - 1].col] + BOX_W / 2 + AREA_PAD;
      const y = LEVEL_Y[boxes[0].row] - BOX_H / 2 - AREA_PAD;
      return (
        <rect
          key={i}
          x={left}
          y={y}
          width={right - left}
          height={BOX_H + 2 * AREA_PAD}
          rx={6}
          fill={AREA_FILL}
          stroke={AREA_STROKE}
          strokeWidth={0.8}
        />
      );
    })}

    {/* Links between object types, with their end markers. */}
    {LINKS.map(({ d }, i) => (
      <path key={i} d={d} fill="none" stroke={LINK} strokeWidth={0.9} />
    ))}
    {/* The arrow between the two object types sharing an area. */}
    <path d="M52,98 H58" stroke={LINK} strokeWidth={0.9} />
    <polygon points="62,98 57,95.5 57,100.5" fill={LINK} />

    {/* Object types: colored boxes with a placeholder name. */}
    {AREAS.flat().map(({ col, row, color, label }, i) => (
      <g key={i}>
        <rect x={COLUMNS[col] - BOX_W / 2} y={LEVEL_Y[row] - BOX_H / 2} width={BOX_W} height={BOX_H} rx={4} fill={color} />
        <rect x={COLUMNS[col] - label / 2} y={LEVEL_Y[row] - 1.5} width={label} height={3} rx={1.5} fill="#ffffff" opacity={0.75} />
      </g>
    ))}
    {LINKS.flatMap(({ ends }, i) => ends.map((end, j) => <EndMarker key={`${i}-${j}`} {...end} />))}

    {/* Level captions on the right; the number of object types is a placeholder. */}
    {LEVEL_Y.map((y, row) => (
      <g key={row}>
        <text x={280} y={y - 3} dominantBaseline="central" fontSize={5.5} fontWeight={700} letterSpacing={0.4} fill="var(--foreground)">
          LEVEL {LEVEL_Y.length - 1 - row}
        </text>
        <rect x={280} y={y + 3} width={26} height={3} rx={1.5} fill={INK} opacity={0.3} />
      </g>
    ))}
  </svg>
);

export default ProcessAreaSketch;
