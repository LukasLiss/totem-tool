/**
 * PieChartSketch — a wireframe of the pie chart widget for its edit form. It
 * only shows the layout the settings produce (title, pie or donut, legend
 * style, values, category count, colors), with placeholder shapes instead of
 * real labels and numbers.
 */

import React from "react";
import type { LegendPosition, LegendValues } from "@/components/sql-widgets/chartLegendUtils";
import { cn } from "@/lib/utils";

const WIDTH = 240;
const HEIGHT = 190;
// Fixed slice sizes for the sketch, largest first.
const SHARES = [0.34, 0.24, 0.18, 0.14, 0.1];
// Slice shades, as opacity of the muted foreground color.
const SHADES = [0.75, 0.55, 0.4, 0.28, 0.18];
// Placeholder label lengths per slice, so the legend doesn't look uniform.
const LABEL_LENGTHS = [26, 20, 30, 18, 24];
const VALUE_LENGTH = 10;
const VALUE_GAP = 2;
const INK = "var(--muted-foreground)";

/** One pie slice (inner radius 0) or donut segment, counterclockwise from a0 to a1. */
function slicePath(cx: number, cy: number, r: number, ri: number, a0: number, a1: number): string {
  const point = (radius: number, a: number) => `${cx + radius * Math.cos(a)},${cy - radius * Math.sin(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (ri === 0) {
    return `M${cx},${cy} L${point(r, a0)} A${r},${r} 0 ${large} 0 ${point(r, a1)} Z`;
  }
  return `M${point(r, a0)} A${r},${r} 0 ${large} 0 ${point(r, a1)} L${point(ri, a1)} A${ri},${ri} 0 ${large} 1 ${point(ri, a0)} Z`;
}

/** Placeholder for a line of text. */
const TextBar = ({ x, y, width, height = 4, opacity = 0.3 }: {
  x: number;
  y: number;
  width: number;
  height?: number;
  opacity?: number;
}) => <rect x={x} y={y - height / 2} width={width} height={height} rx={height / 2} fill={INK} opacity={opacity} />;

/** Fill of slice `index`: the chart's color if given, else a grey shade. */
const sliceFill = (index: number, colors?: string[]) =>
  colors?.[index] ? { fill: colors[index], opacity: 1 } : { fill: INK, opacity: SHADES[index] };

const Swatch = ({ x, y, index, colors }: { x: number; y: number; index: number; colors?: string[] }) => {
  const { fill, opacity } = sliceFill(index, colors);
  return <rect x={x} y={y - 2} width={4} height={4} rx={1} fill={fill} opacity={opacity} />;
};

// Longer titles are cut off with an ellipsis so they fit the sketch width.
const TITLE_MAX_CHARS = 40;

interface PieChartSketchProps {
  /** The real chart title, shown as text; empty means no title. */
  title: string;
  chartType: "pie" | "donut";
  showCenterText: boolean;
  showLegend: boolean;
  legendPosition: LegendPosition;
  legendValues: LegendValues;
  showCategoryCount: boolean;
  /** Colors of the five sketch slices; grey shades when omitted. */
  colors?: string[];
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}

const PieChartSketch: React.FC<PieChartSketchProps> = ({
  title,
  chartType,
  showCenterText,
  showLegend,
  legendPosition,
  legendValues,
  showCategoryCount,
  colors,
  className,
}) => {
  const legend = showLegend ? legendPosition : null;
  // One box per shown value: value or percent alone, or both side by side.
  const valueCount = legendValues === "both" ? 2 : legendValues === "none" ? 0 : 1;
  const valuesWidth = valueCount ? valueCount * VALUE_LENGTH + (valueCount - 1) * VALUE_GAP : 0;
  // Width of a legend entry: swatch, label and, if shown, the value boxes.
  const entryWidth = (i: number) => 7 + LABEL_LENGTHS[i] + (valuesWidth ? 3 + valuesWidth : 0);
  const showTitle = title.trim() !== "";
  const shortTitle = title.length > TITLE_MAX_CHARS ? `${title.slice(0, TITLE_MAX_CHARS - 1)}…` : title;

  // Vertical bands: title, pie, legend below the pie, category count.
  const top = showTitle ? 20 : 8;
  const bottom = HEIGHT - (showCategoryCount ? 16 : 8);
  const legendHeight = legend === "bottom" ? 18 : legend === "columns" ? 28 : 0;
  const pieBottom = bottom - (legendHeight ? legendHeight + 6 : 0);
  const cx = WIDTH / 2;
  const cy = (top + pieBottom) / 2;
  // Callouts need room around the pie; without legend the pie stays at a draft-like size.
  const r = legend === "callouts" ? Math.min((pieBottom - top) / 2 - 10, 46) : Math.min((pieBottom - top) / 2, 64);
  const ri = chartType === "donut" ? r * 0.6 : 0;

  const slices = SHARES.reduce<{ a0: number; a1: number }[]>((acc, share) => {
    const a0 = acc.length ? acc[acc.length - 1].a1 : 0;
    return [...acc, { a0, a1: a0 + share * 2 * Math.PI }];
  }, []);

  const valueBoxes = (x: number, y: number) =>
    Array.from({ length: valueCount }, (_, i) => (
      <TextBar key={i} x={x + i * (VALUE_LENGTH + VALUE_GAP)} y={y} width={VALUE_LENGTH} opacity={0.18} />
    ));

  const legendEntry = (x: number, y: number, index: number, valuesX?: number) => (
    <g key={index}>
      <Swatch x={x} y={y} index={index} colors={colors} />
      <TextBar x={x + 7} y={y} width={LABEL_LENGTHS[index]} />
      {valueBoxes(valuesX ?? x + 7 + LABEL_LENGTHS[index] + 3, y)}
    </g>
  );

  // Bottom legend: a wrapped row of entries, three on the first line, two on the second.
  const bottomLegend = () => {
    return [[0, 1, 2], [3, 4]].map((row, rowIndex) => {
      const gap = 8;
      const rowWidth = row.reduce((acc, i) => acc + entryWidth(i), 0) + gap * (row.length - 1);
      let x = (WIDTH - rowWidth) / 2;
      return row.map((i) => {
        const entry = legendEntry(x, pieBottom + 8 + rowIndex * 9, i);
        x += entryWidth(i) + gap;
        return entry;
      });
    });
  };

  // Column legend: two columns as wide as their widest entry, centered as a
  // pair, with the value boxes right-aligned in each column.
  const columnLegend = () => {
    const gap = 24;
    const columnWidths = [0, 1].map((column) =>
      Math.max(...SHARES.map((_, i) => (i % 2 === column ? entryWidth(i) : 0)))
    );
    const x0 = (WIDTH - columnWidths[0] - gap - columnWidths[1]) / 2;
    return SHARES.map((_, i) => {
      const column = i % 2;
      const x = column === 0 ? x0 : x0 + columnWidths[0] + gap;
      const y = pieBottom + 8 + Math.floor(i / 2) * 9;
      return legendEntry(x, y, i, x + columnWidths[column] - valuesWidth);
    });
  };

  const callouts = () =>
    slices.map(({ a0, a1 }, i) => {
      const a = (a0 + a1) / 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const side = cos >= 0 ? 1 : -1;
      const sx = cx + r * cos;
      const sy = cy - r * sin;
      const bx = cx + (r + 6) * cos;
      const by = cy - (r + 6) * sin;
      const tx = bx + side * 6;
      const labelWidth = LABEL_LENGTHS[i];
      const textX = side === 1 ? tx + 2 : tx - 2 - (entryWidth(i) - 7);
      return (
        <g key={i}>
          <polyline
            points={`${sx},${sy} ${bx},${by} ${tx},${by}`}
            fill="none"
            stroke={INK}
            strokeOpacity={0.5}
            strokeWidth={0.75}
          />
          <TextBar x={textX} y={by} width={labelWidth} />
          {valueBoxes(textX + labelWidth + 3, by)}
        </g>
      );
    });

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the pie chart"
    >
      {showTitle && (
        <text x={cx} y={9} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={600} fill="var(--foreground)">
          <title>{title}</title>
          {shortTitle}
        </text>
      )}
      {slices.map(({ a0, a1 }, i) => (
        <path
          key={i}
          d={slicePath(cx, cy, r, ri, a0, a1)}
          fill={sliceFill(i, colors).fill}
          fillOpacity={sliceFill(i, colors).opacity}
          stroke="var(--card)"
          strokeWidth={1.5}
        />
      ))}
      {chartType === "donut" && showCenterText && (
        <>
          <TextBar x={cx - ri * 0.45} y={cy - 3} width={ri * 0.9} height={6} opacity={0.5} />
          <TextBar x={cx - ri * 0.35} y={cy + 6} width={ri * 0.7} />
        </>
      )}
      {legend === "bottom" && bottomLegend()}
      {legend === "columns" && columnLegend()}
      {legend === "callouts" && callouts()}
      {showCategoryCount && <TextBar x={cx - 18} y={HEIGHT - 6} width={36} />}
    </svg>
  );
};

export default PieChartSketch;
