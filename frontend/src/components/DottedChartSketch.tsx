/**
 * DottedChartSketch — a draft of the OC dotted chart for the widget's edit
 * tile and settings popup: events as dots along the x axis, one row per y
 * value (a few wide rows, or many thin ones when every object gets a row),
 * ordered by first or last occurrence, so the familiar diagonal edge shows on
 * the left or the right. Dots look as in the chart: hollow grey circles by
 * default, the chart's palette with "Color by" and its shapes with "Shape by".
 * Positions and labels are placeholders; the axis captions are the real ones.
 */

import React from "react";
import { cn } from "@/lib/utils";
import type { DottedChartConfig } from "@/react_component/dottedChart/DottedChartControls";
import { axisToControlValue, isObjectRowAxis } from "@/react_component/dottedChart/dottedChartAxisOptions";
import { OTHER_COLOR, PALETTE, SHAPES } from "@/react_component/dottedChart/dottedChartStyle";

const WIDTH = 300;
const HEIGHT = 190;
const INK = "var(--muted-foreground)";
const AXIS_LABEL_MAX_CHARS = 32;
// Categories the sketch's colors and shapes cycle through.
const COLOR_CATEGORIES = 6;

// Time spans (0..1) of the rows, in no particular order; the row order sorts
// them by start or by end. Value rows (e.g. activities) run over most of the
// log; object rows are short lives that start one after another.
const VALUE_SPANS: [number, number][] = [
  [0.02, 0.98], [0.04, 0.7], [0.12, 0.9], [0.25, 0.6], [0.3, 0.97], [0.5, 0.85],
];
const OBJECT_SPANS: [number, number][] = [
  [0.02, 0.55], [0.08, 0.3], [0.14, 0.42], [0.2, 0.78], [0.28, 0.46], [0.34, 0.62],
  [0.42, 0.95], [0.5, 0.68], [0.56, 0.84], [0.64, 0.76], [0.72, 0.98], [0.8, 0.92],
];
// Placeholder lengths of the row labels.
const ROW_LABEL_LENGTHS = [18, 12, 22, 15, 20, 10, 16, 21, 13, 19, 11, 17];

/** A small, repeatable offset in -0.5..0.5, so dots don't sit on a perfect grid. */
const jitter = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x) - 0.5;
};

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

type Shape = (typeof SHAPES)[number];

/** A dot as the chart draws it: a hollow circle, or a filled shape. */
function Dot({ x, y, r, color, shape }: { x: number; y: number; r: number; color: string; shape: Shape }) {
  if (shape === "square") return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={0.4} fill={color} />;
  if (shape === "triangle") {
    return <polygon points={`${x},${y - r * 1.1} ${x + r * 1.1},${y + r * 0.9} ${x - r * 1.1},${y + r * 0.9}`} fill={color} />;
  }
  if (shape === "diamond") {
    return <polygon points={`${x},${y - r * 1.2} ${x + r * 1.2},${y} ${x},${y + r * 1.2} ${x - r * 1.2},${y}`} fill={color} />;
  }
  if (shape === "cross") {
    return (
      <path d={`M${x - r},${y} H${x + r} M${x},${y - r} V${y + r}`} stroke={color} strokeWidth={r * 0.7} strokeLinecap="round" />
    );
  }
  return <circle cx={x} cy={y} r={r * 0.85} fill="none" stroke={color} strokeWidth={r * 0.45} />;
}

const DottedChartSketch: React.FC<{
  config: DottedChartConfig;
  /** The x and y axis captions (the selected options' labels). */
  xLabel: string;
  yLabel: string;
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}> = ({ config, xLabel, yLabel, className }) => {
  const objectRows = isObjectRowAxis(config.yAxis);
  const spans = [...(objectRows ? OBJECT_SPANS : VALUE_SPANS)].sort((a, b) =>
    config.rowOrder === "last_occurrence" ? a[1] - b[1] : a[0] - b[0],
  );
  const rows = spans.length;

  const plotLeft = 46;
  const plotRight = WIDTH - 8;
  const plotTop = 8;
  const plotBottom = HEIGHT - 30;
  const rowHeight = (plotBottom - plotTop) / rows;
  const px = (u: number) => plotLeft + 6 + u * (plotRight - plotLeft - 12);
  const py = (row: number) => plotTop + (row + 0.5) * rowHeight;
  const radius = objectRows ? 2.4 : 2.7;

  // Colors and shapes: one per row when they follow the y axis (e.g. colored
  // by activity with a row per activity), otherwise changing along each row.
  const yValue = axisToControlValue(config.yAxis);
  const colorValue = config.colorBy.type === "none" ? null : axisToControlValue(config.colorBy);
  const shapeValue = config.shapeBy.type === "none" ? null : axisToControlValue(config.shapeBy);
  const category = (value: string, row: number, k: number, salt: number) =>
    value === yValue ? row : k + row * 2 + salt;
  const colorOf = (row: number, k: number) =>
    colorValue === null ? OTHER_COLOR : PALETTE[category(colorValue, row, k, 0) % COLOR_CATEGORIES];
  const shapeOf = (row: number, k: number): Shape =>
    shapeValue === null
      ? "circle"
      : SHAPES[category(shapeValue, row, k, shapeValue === colorValue ? 0 : 1) % SHAPES.length];

  const dots = spans.flatMap(([start, end], row) => {
    const count = Math.round((end - start) * (objectRows ? 8 : 14)) + 2;
    const step = (end - start) / (count - 1);
    return Array.from({ length: count }, (_, k) => {
      // The first and last dot sit exactly at the span's ends, so the order shows.
      const u = k === 0 || k === count - 1 ? start + k * step : start + (k + jitter(row * 31 + k) * 0.6) * step;
      return { x: px(u), y: py(row), color: colorOf(row, k), shape: shapeOf(row, k), key: `${row}-${k}` };
    });
  });

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the dotted chart"
    >
      {/* Row labels and x ticks: placeholders. */}
      {spans.map((_, row) => (
        <rect
          key={row}
          x={plotLeft - 4 - ROW_LABEL_LENGTHS[row] * (objectRows ? 0.8 : 1)}
          y={py(row) - (objectRows ? 1.2 : 1.5)}
          width={ROW_LABEL_LENGTHS[row] * (objectRows ? 0.8 : 1)}
          height={objectRows ? 2.4 : 3}
          rx={1.2}
          fill={INK}
          opacity={0.3}
        />
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((u) => (
        <rect key={u} x={px(u) - 8} y={plotBottom + 5} width={16} height={3} rx={1.5} fill={INK} opacity={0.3} />
      ))}
      <polyline
        points={`${plotLeft},${plotTop} ${plotLeft},${plotBottom} ${plotRight},${plotBottom}`}
        fill="none"
        stroke={INK}
        strokeOpacity={0.5}
        strokeWidth={0.75}
      />

      {/* Axis captions: the selected options. */}
      <text x={(plotLeft + plotRight) / 2} y={plotBottom + 19} textAnchor="middle" dominantBaseline="central" fontSize={7} fill={INK}>
        {shorten(xLabel, AXIS_LABEL_MAX_CHARS)}
      </text>
      <text
        x={7}
        y={(plotTop + plotBottom) / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={7}
        fill={INK}
        transform={`rotate(-90 7 ${(plotTop + plotBottom) / 2})`}
      >
        {shorten(yLabel, AXIS_LABEL_MAX_CHARS)}
      </text>

      {dots.map(({ key, ...dot }) => (
        <Dot key={key} {...dot} r={radius} />
      ))}
    </svg>
  );
};

export default DottedChartSketch;
