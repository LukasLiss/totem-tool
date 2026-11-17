/**
 * VariantsSketch — a draft of the Variants Explorer for the widget's edit
 * tile and settings popup, modelled on the explorer without any names: its
 * toolbar (settings, summary, zoom, compact labels, compute), the "found
 * variants" line, and the variants as rows with their support bar, the first
 * one expanded into its object type legend and one lane per object with
 * chevron-shaped events in the object type colors (an event shared by
 * objects of both types in a gradient of the two). The variants depend on the
 * log, so the draft is a fixed example; all labels are placeholders.
 */

import React, { useId } from "react";
import { cn } from "@/lib/utils";
import { mapTypesToColors } from "@/utils/objectColors";

const WIDTH = 300;
const HEIGHT = 196;
const INK = "var(--muted-foreground)";
const BORDER = "#e2e8f0";
const PRIMARY = "#2563eb";
const [BLUE, , ORANGE] = Object.values(mapTypesToColors(["a", "b", "c"]));

// The expanded variant: lanes (one per object) and their events by column.
const CANVAS_LEFT = 82;
const COLUMN = 29;
const EVENT = { w: 26, h: 10 };
const LANES: { y: number; color: string; events: number[] }[] = [
  { y: 66, color: BLUE, events: [0, 1, 3, 5] },
  { y: 80, color: BLUE, events: [0, 2, 4] },
  { y: 100, color: ORANGE, events: [3, 4, 6] },
];
// The event in column 3 is shared by the first blue object and the orange one.
const SHARED_COLUMN = 3;
const SHARED_LANES = [0, 2];

/** An event block: a chevron pointing right, with a placeholder label. */
function Chevron({ x, y, fill }: { x: number; y: number; fill: string }) {
  const { w, h } = EVENT;
  const tip = 4;
  return (
    <g>
      <polygon
        points={`${x},${y} ${x + w - tip},${y} ${x + w},${y + h / 2} ${x + w - tip},${y + h} ${x},${y + h} ${x + tip},${y + h / 2}`}
        fill={fill}
      />
      <rect x={x + 8} y={y + h / 2 - 1} width={w - 14} height={2} rx={1} fill="#ffffff" opacity={0.8} />
    </g>
  );
}

/** A collapsed (or expanded) variant's header: chevron, support bar, count, id and signature. */
function VariantHeader({ y, support, expanded }: { y: number; support: number; expanded: boolean }) {
  return (
    <g>
      <polyline
        points={expanded ? `12,${y - 1.5} 15,${y + 1.5} 18,${y - 1.5}` : `13.5,${y - 3} 16.5,${y} 13.5,${y + 3}`}
        fill="none"
        stroke={INK}
        strokeWidth={0.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x={24} y={y - 2.5} width={50} height={5} rx={2.5} fill="#f8fafc" stroke={BORDER} strokeWidth={0.5} />
      <rect x={24} y={y - 2.5} width={50 * support} height={5} rx={2.5} fill={PRIMARY} />
      <rect x={78} y={y - 1.2} width={8} height={2.4} rx={1.2} fill={INK} opacity={0.6} />
      <rect x={100} y={y - 1.2} width={10} height={2.4} rx={1.2} fill={INK} opacity={0.6} />
      <rect x={WIDTH - 16 - 70} y={y - 1.2} width={70} height={2.4} rx={1.2} fill={INK} opacity={0.3} />
    </g>
  );
}

const VariantsSketch: React.FC<{
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}> = ({ className }) => {
  const gradientId = `${useId().replace(/:/g, "")}-shared`;
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the variants explorer"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={BLUE} />
          <stop offset="1" stopColor={ORANGE} />
        </linearGradient>
      </defs>

      {/* Toolbar: settings, summary, zoom, compact labels and the compute button. */}
      <rect x={6} y={6} width={34} height={11} rx={3} fill="#ffffff" stroke={BORDER} strokeWidth={0.7} />
      <rect x={13} y={10.3} width={20} height={2.4} rx={1.2} fill={INK} opacity={0.6} />
      <rect x={46} y={10.3} width={70} height={2.4} rx={1.2} fill={INK} opacity={0.3} />
      <rect x={138} y={10.8} width={36} height={1.4} rx={0.7} fill={BORDER} />
      <circle cx={156} cy={11.5} r={2.4} fill="#ffffff" stroke={INK} strokeWidth={0.6} />
      <rect x={182} y={10.3} width={30} height={2.4} rx={1.2} fill={INK} opacity={0.45} />
      <rect x={216} y={8.5} width={10} height={6} rx={3} fill={BORDER} />
      <circle cx={219} cy={11.5} r={2.2} fill="#ffffff" />
      <rect x={WIDTH - 6 - 52} y={6} width={52} height={11} rx={3} fill="#0f172a" />
      <rect x={WIDTH - 6 - 42} y={10.3} width={32} height={2.4} rx={1.2} fill="#ffffff" opacity={0.85} />

      {/* "Found … variants across … process executions" */}
      <rect x={6} y={27} width={110} height={2.6} rx={1.3} fill={INK} opacity={0.35} />

      {/* The first variant, expanded: legend of the object types and the lanes. */}
      <rect x={6} y={38} width={WIDTH - 12} height={84} rx={4} fill="none" stroke={BORDER} strokeWidth={0.8} />
      <VariantHeader y={48} support={0.78} expanded />
      <rect x={12} y={58} width={64} height={58} rx={3} fill="none" stroke={BORDER} strokeWidth={0.6} />
      <rect x={16} y={62} width={56} height={28} rx={2.5} fill="none" stroke={BORDER} strokeWidth={0.6} />
      <rect x={20} y={66} width={4} height={4} rx={1} fill={BLUE} />
      <rect x={27} y={66.8} width={26} height={2.4} rx={1.2} fill={INK} opacity={0.6} />
      <rect x={16} y={94} width={56} height={16} rx={2.5} fill="none" stroke={BORDER} strokeWidth={0.6} />
      <rect x={20} y={98} width={4} height={4} rx={1} fill={ORANGE} />
      <rect x={27} y={98.8} width={22} height={2.4} rx={1.2} fill={INK} opacity={0.6} />
      <rect x={CANVAS_LEFT - 2} y={58} width={WIDTH - 12 - CANVAS_LEFT} height={58} rx={3} fill="none" stroke={BORDER} strokeWidth={0.6} />
      {LANES.map((lane, l) =>
        lane.events.map((column) => (
          <Chevron
            key={`${l}-${column}`}
            x={CANVAS_LEFT + 2 + column * COLUMN}
            y={lane.y}
            fill={column === SHARED_COLUMN && SHARED_LANES.includes(l) ? `url(#${gradientId})` : lane.color}
          />
        )),
      )}

      {/* Further variants, collapsed, with less support. */}
      <rect x={6} y={128} width={WIDTH - 12} height={20} rx={4} fill="none" stroke={BORDER} strokeWidth={0.8} />
      <VariantHeader y={138} support={0.42} expanded={false} />
      <rect x={6} y={154} width={WIDTH - 12} height={20} rx={4} fill="none" stroke={BORDER} strokeWidth={0.8} />
      <VariantHeader y={164} support={0.18} expanded={false} />
      <rect x={6} y={180} width={WIDTH - 12} height={14} rx={4} fill="none" stroke={BORDER} strokeWidth={0.8} strokeDasharray="2 2" opacity={0.7} />
    </svg>
  );
};

export default VariantsSketch;
