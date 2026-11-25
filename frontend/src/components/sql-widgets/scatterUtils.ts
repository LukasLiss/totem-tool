/**
 * Turning query rows into the scatter plot's series, shared by the widget
 * and its settings popup: picking the x / y columns, grouping points by the
 * series column, and keeping the largest series (by point count) while the
 * rest is merged into one "Other" series.
 */

import { limitCategories, type CategorySlice } from "./chartData";
import { DEFAULT_HIGH_COLOR, DEFAULT_LOW_COLOR, type ChartColors } from "./chartColors";
import type { PointSize } from "./chartLegendUtils";
import { toNumber } from "./sqlWidgetUtils";

/**
 * The colors as the scatter plot uses them: one color without a series
 * column; with one, a color per series unless the user chose otherwise.
 */
export function scatterColors(colors: ChartColors, hasSeries: boolean): ChartColors {
  return hasSeries ? { mode: "category", ...colors } : { ...colors, mode: "single" };
}

/** Series shown with their own color unless the user picks another number. */
export const DEFAULT_MAX_SERIES = 12;

/**
 * Point radius in px per point size (4, 7 and 10 px across). The chart
 * draws its points with this radius itself: recharts' ZAxis only sizes
 * points when bound to a data column.
 */
export const POINT_RADIUS_PX: Record<PointSize, number> = { small: 2, medium: 3.5, large: 5 };
/** Opacity of "transparent points": overlaps stay visible as darker areas. */
export const TRANSPARENT_POINT_OPACITY = 0.4;
// Name of the single group when there is no series column.
const NO_SERIES = "points";

export interface ScatterSeries {
  name: string;
  points: { x: number; y: number }[];
  /** The "Other" series that collects the points of all further series. */
  other?: boolean;
}

/** The x / y columns: the chosen ones, else the first two numeric columns. */
function scatterAxisKeys(rows: Record<string, unknown>[], columns: string[], xColumn: string, yColumn: string) {
  const numericCols = columns.filter((c) => rows.some((r) => toNumber(r[c]) != null));
  const xKey = xColumn || numericCols[0] || columns[0] || "";
  const yKey = yColumn || numericCols.find((c) => c !== xKey) || columns[1] || "";
  return { xKey, yKey };
}

/**
 * Whether a column's values can be ordered for "By value" colors: every
 * non-empty value is a number, and there is at least one. Otherwise
 * `example` is a value that isn't a number (when there is one).
 */
export function columnOrderability(
  rows: Record<string, unknown>[],
  column: string
): { orderable: boolean; example?: string } {
  let numbers = 0;
  for (const r of rows) {
    const v = r[column];
    if (v == null || v === "") continue;
    if (toNumber(v) == null) return { orderable: false, example: String(v) };
    numbers++;
  }
  return { orderable: numbers > 0 };
}

/** The notice shown when "By value" can't be used with `column`. */
export function notOrderableNotice(column: string, example?: string): string {
  const why = example != null
    ? `has values that aren't numbers (e.g. “${example.length > 30 ? `${example.slice(0, 29)}…` : example}”)`
    : "has no numeric values";
  return `“${column}” ${why}, so the points are colored by category instead.`;
}

/** The low and high color of "By value" colors. */
export function valueGradient(colors: ChartColors): [string, string] {
  return [colors.low ?? DEFAULT_LOW_COLOR, colors.high ?? DEFAULT_HIGH_COLOR];
}

export interface ValuePoint {
  x: number;
  y: number;
  /** The point's value in the color column; null when empty. */
  c: number | null;
}

/**
 * "By value" colors: every point with its own value from the color column
 * (instead of grouping points into series), plus the smallest and largest
 * value for the color ramp and the legend.
 */
export function buildValuePoints(
  rows: Record<string, unknown>[],
  columns: string[],
  { xColumn, yColumn, seriesColumn }: { xColumn: string; yColumn: string; seriesColumn: string }
) {
  const { xKey, yKey } = scatterAxisKeys(rows, columns, xColumn, yColumn);
  const points: ValuePoint[] = [];
  let min = Infinity;
  let max = -Infinity;
  let withoutValue = 0;
  for (const r of rows) {
    const x = toNumber(r[xKey]);
    const y = toNumber(r[yKey]);
    if (x == null || y == null) continue;
    const c = toNumber(r[seriesColumn]);
    if (c == null) withoutValue++;
    else {
      min = Math.min(min, c);
      max = Math.max(max, c);
    }
    points.push({ x, y, c });
  }
  return { points, min, max, withoutValue, xKey, yKey };
}

export function buildScatterSeries(
  rows: Record<string, unknown>[],
  columns: string[],
  {
    xColumn,
    yColumn,
    seriesColumn,
    maxSeries,
  }: { xColumn: string; yColumn: string; seriesColumn: string; maxSeries: number | null }
) {
  const { xKey, yKey } = scatterAxisKeys(rows, columns, xColumn, yColumn);
  const seriesKey = seriesColumn || "";

  const groups = new Map<string, { x: number; y: number }[]>();
  for (const r of rows) {
    const x = toNumber(r[xKey]);
    const y = toNumber(r[yKey]);
    if (x == null || y == null) continue;
    const name = seriesKey ? (r[seriesKey] == null ? "NULL" : String(r[seriesKey])) : NO_SERIES;
    const points = groups.get(name);
    if (points) points.push({ x, y });
    else groups.set(name, [{ x, y }]);
  }

  // The largest series keep their own color; the points of all others go to "Other".
  const slices: CategorySlice[] = limitCategories(
    Array.from(groups, ([name, points]) => ({ label: name, value: points.length })),
    seriesKey ? maxSeries ?? DEFAULT_MAX_SERIES : null
  );
  const kept = new Set(slices.filter((s) => !s.other).map((s) => s.label));
  const series: ScatterSeries[] = slices.map((slice) =>
    slice.other
      ? {
          name: slice.label,
          other: true,
          points: Array.from(groups).flatMap(([name, points]) => (kept.has(name) ? [] : points)),
        }
      : { name: slice.label, points: groups.get(slice.label) ?? [] }
  );

  return { series, slices, xKey, yKey, seriesKey };
}
