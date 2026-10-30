/**
 * ScatterPlotSketch — a wireframe of the scatter plot widget for its edit
 * tile and settings popup: the real title and axis labels (nothing when
 * empty, as in the chart), a rising cloud of placeholder points, and with a
 * series column the points split into colored groups plus the chosen legend.
 */

import React from "react";
import { cn } from "@/lib/utils";
import type { LegendPosition, PointSize } from "./chartLegendUtils";
import { TRANSPARENT_POINT_OPACITY } from "./scatterUtils";

// Point radius per size: for the single cloud, and smaller along the series
// curves so they read as clean lines of dots.
const POINT_RADIUS: Record<PointSize, { cloud: number; series: number }> = {
  small: { cloud: 1.7, series: 1.4 },
  medium: { cloud: 2.6, series: 2.1 },
  large: { cloud: 3.6, series: 2.9 },
};

const WIDTH = 240;
const HEIGHT = 190;
// Points of the sketch in plot coordinates (0..1, y up): a loosely rising cloud.
const POINTS: [number, number][] = [
  [0.06, 0.1], [0.12, 0.22], [0.16, 0.08], [0.22, 0.3], [0.27, 0.18],
  [0.31, 0.38], [0.36, 0.27], [0.4, 0.46], [0.45, 0.35], [0.5, 0.55],
  [0.54, 0.42], [0.58, 0.62], [0.63, 0.5], [0.67, 0.7], [0.72, 0.58],
  [0.76, 0.78], [0.8, 0.66], [0.85, 0.86], [0.9, 0.74], [0.94, 0.92],
];
// With a series column: five series, each a clean curve of evenly spaced
// points with its own shape, all starting near the origin, so a color stands
// for a group that behaves alike. Curves map t in 0..1 to plot coordinates.
const SERIES_CURVES: ((t: number) => [number, number])[] = [
  (t) => [0.02 + 0.95 * t, 0.04 + 0.93 * (1 - (1 - t) ** 3.5)], // rises fast, levels off at the top, to the right edge
  (t) => [0.02 + 0.28 * t, 0.04 + 0.94 * t], // steep line, at the top early
  (t) => [0.02 + 0.95 * t, 0.04 + 0.7 * t], // moderate line across the width
  (t) => [0.02 + 0.73 * t, 0.04 + 0.88 * t ** 2.4], // slow start, then steep, just below the plateau
  (t) => [0.04 + 0.93 * t, 0.05 + 0.03 * t], // flat across the width
];
const GROUPS = SERIES_CURVES.length;
// Distance between neighbouring points along a curve, in plot units with x
// scaled by the plot's width / height, so steep and flat parts look alike.
const POINT_SPACING = 0.06;
const PLOT_ASPECT = 1.5;

/**
 * Points at equal distances along a curve, from its start to its very end:
 * the curve's length is split into as many equal steps as come closest to
 * POINT_SPACING, so the last point always sits at the curve's end.
 */
function pointsAlong(curve: (t: number) => [number, number]): [number, number][] {
  const steps = 400;
  // The curve as a fine polyline, with the distance travelled up to each vertex.
  const vertices = Array.from({ length: steps + 1 }, (_, i) => curve(i / steps));
  const travelled = [0];
  for (let i = 1; i <= steps; i++) {
    const [u0, v0] = vertices[i - 1];
    const [u1, v1] = vertices[i];
    travelled.push(travelled[i - 1] + Math.hypot((u1 - u0) * PLOT_ASPECT, v1 - v0));
  }
  const length = travelled[steps];
  const count = Math.max(1, Math.round(length / POINT_SPACING));
  const points: [number, number][] = [];
  let vertex = 0;
  for (let k = 0; k <= count; k++) {
    const target = (length * k) / count;
    while (vertex < steps && travelled[vertex + 1] < target) vertex++;
    points.push(vertices[Math.min(vertex + 1, steps)]);
  }
  points[0] = vertices[0];
  return points;
}

const SERIES_POINTS = SERIES_CURVES.flatMap((curve, group) =>
  pointsAlong(curve).map(([u, v]) => ({ u, v, group }))
);
// Placeholder label lengths of the legend entries.
const LEGEND_LABEL_LENGTHS = [22, 16, 26, 18, 20];
const LEGEND_ROW_HEIGHT = 9;
const TITLE_MAX_CHARS = 40;
const AXIS_LABEL_MAX_CHARS = 28;
const INK = "var(--muted-foreground)";

/** Placeholder for a line of text. */
const TextBar = ({ x, y, width, height = 4, opacity = 0.3 }: {
  x: number;
  y: number;
  width: number;
  height?: number;
  opacity?: number;
}) => <rect x={x} y={y - height / 2} width={width} height={height} rx={height / 2} fill={INK} opacity={opacity} />;

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

interface ScatterPlotSketchProps {
  /** The real chart title, shown as text; empty means no title. */
  title: string;
  /** The real axis labels; empty ones are left out, as in the chart. */
  xLabel: string;
  yLabel: string;
  /** A series column is set: points in colored groups, and the legend. */
  hasSeries: boolean;
  legendPosition: LegendPosition;
  pointSize: PointSize;
  /** See-through points, as with "Transparent points" in the chart. */
  transparentPoints: boolean;
  /** Colors of the five sketch groups (without series only the first is used); grey when omitted. */
  colors?: string[];
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}

const ScatterPlotSketch: React.FC<ScatterPlotSketchProps> = ({
  title,
  xLabel,
  yLabel,
  hasSeries,
  legendPosition,
  pointSize,
  transparentPoints,
  colors,
  className,
}) => {
  const showTitle = title.trim() !== "";
  const legend = hasSeries && (legendPosition === "bottom" || legendPosition === "columns") ? legendPosition : null;

  // Vertical bands: title, plot with x axis label below, legend.
  const top = showTitle ? 24 : 12;
  const legendRows = legend === "bottom" ? 1 : legend === "columns" ? Math.ceil(GROUPS / 2) : 0;
  const legendHeight = legendRows ? legendRows * LEGEND_ROW_HEIGHT + 4 : 0;
  const bottom = HEIGHT - 8 - legendHeight;
  // Plot area, leaving room for the y label (left) and x label (below) when set.
  const hasXLabel = xLabel.trim() !== "";
  const hasYLabel = yLabel.trim() !== "";
  const plotLeft = hasYLabel ? 30 : 16;
  const plotRight = WIDTH - 14;
  const plotTop = top;
  const plotBottom = bottom - (hasXLabel ? 18 : 6);
  const px = (u: number) => plotLeft + 6 + u * (plotRight - plotLeft - 12);
  const py = (v: number) => plotBottom - 6 - v * (plotBottom - plotTop - 12);

  const fill = (group: number) => {
    const color = colors?.[group] ? { fill: colors[group], opacity: 0.9 } : { fill: INK, opacity: 0.55 };
    return transparentPoints ? { ...color, opacity: TRANSPARENT_POINT_OPACITY } : color;
  };
  const radius = POINT_RADIUS[pointSize][hasSeries ? "series" : "cloud"];
  // One rising cloud without series; one band per series with them.
  const points = hasSeries ? SERIES_POINTS : POINTS.map(([u, v]) => ({ u, v, group: 0 }));

  const legendEntry = (x: number, y: number, group: number) => (
    <g key={group}>
      <rect x={x} y={y - 2} width={4} height={4} rx={1} fill={colors?.[group] ?? INK} opacity={colors?.[group] ? 1 : 0.55} />
      <TextBar x={x + 7} y={y} width={LEGEND_LABEL_LENGTHS[group]} />
    </g>
  );
  const legendWidth = (group: number) => 7 + LEGEND_LABEL_LENGTHS[group];
  const groups = Array.from({ length: GROUPS }, (_, g) => g);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the scatter plot"
    >
      {showTitle && (
        <text x={WIDTH / 2} y={9} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={600} fill="var(--foreground)">
          <title>{title}</title>
          {shorten(title, TITLE_MAX_CHARS)}
        </text>
      )}

      {/* Light grid and the two axes. */}
      {[0.25, 0.5, 0.75].map((t) => (
        <g key={t} stroke={INK} strokeOpacity={0.15} strokeWidth={0.5} strokeDasharray="2 2">
          <line x1={plotLeft} x2={plotRight} y1={plotTop + t * (plotBottom - plotTop)} y2={plotTop + t * (plotBottom - plotTop)} />
          <line x1={plotLeft + t * (plotRight - plotLeft)} x2={plotLeft + t * (plotRight - plotLeft)} y1={plotTop} y2={plotBottom} />
        </g>
      ))}
      <polyline
        points={`${plotLeft},${plotTop} ${plotLeft},${plotBottom} ${plotRight},${plotBottom}`}
        fill="none"
        stroke={INK}
        strokeOpacity={0.5}
        strokeWidth={0.75}
      />

      {/* Axis labels: the real text; nothing when empty. */}
      {hasXLabel && (
        <text x={(plotLeft + plotRight) / 2} y={plotBottom + 11} textAnchor="middle" dominantBaseline="central" fontSize={7} fill={INK}>
          {shorten(xLabel, AXIS_LABEL_MAX_CHARS)}
        </text>
      )}
      {hasYLabel && (
        <text
          x={plotLeft - 12}
          y={(plotTop + plotBottom) / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={7}
          fill={INK}
          transform={`rotate(-90 ${plotLeft - 12} ${(plotTop + plotBottom) / 2})`}
        >
          {shorten(yLabel, AXIS_LABEL_MAX_CHARS)}
        </text>
      )}

      {points.map(({ u, v, group }, i) => {
        const { fill: color, opacity } = fill(group);
        return <circle key={i} cx={px(u)} cy={py(v)} r={radius} fill={color} fillOpacity={opacity} />;
      })}

      {legend === "bottom" &&
        (() => {
          // One centered row of entries.
          const gap = 10;
          const total = groups.reduce((acc, g) => acc + legendWidth(g), 0) + gap * (GROUPS - 1);
          let x = (WIDTH - total) / 2;
          return groups.map((g) => {
            const entry = legendEntry(x, HEIGHT - 10, g);
            x += legendWidth(g) + gap;
            return entry;
          });
        })()}
      {legend === "columns" &&
        (() => {
          // Two columns as wide as their widest entry, centered as a pair.
          const gap = 24;
          const columnWidths = [0, 1].map((column) =>
            Math.max(...groups.filter((g) => g % 2 === column).map(legendWidth))
          );
          const x0 = (WIDTH - columnWidths[0] - gap - columnWidths[1]) / 2;
          const y0 = HEIGHT - 6 - (legendRows - 1) * LEGEND_ROW_HEIGHT;
          return groups.map((g) =>
            legendEntry(
              g % 2 === 0 ? x0 : x0 + columnWidths[0] + gap,
              y0 + Math.floor(g / 2) * LEGEND_ROW_HEIGHT,
              g
            )
          );
        })()}
    </svg>
  );
};

export default ScatterPlotSketch;
