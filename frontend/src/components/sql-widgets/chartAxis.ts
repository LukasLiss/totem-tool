/**
 * The axis design shared by the bar chart and the scatter plot, so both look
 * alike: dark axis lines (Recharts' default), no tick lines, a light dashed
 * grid (the chart container tones it down), tick text in the chart's muted 12px. Plus the width of a
 * numeric y axis, worked out from the data so the tick numbers (and the y
 * label) sit close to the plot whether they read "8" or "1,200".
 */

import { formatChartNumber } from "./sqlWidgetUtils";
import { textWidth } from "./textMeasure";

/** Props for every XAxis / YAxis of the charts. */
export const AXIS_STYLE = { tickLine: false, axisLine: true } as const;
/** The grid's dash pattern. */
export const GRID_DASH = "3 3";

// Tick text is 12px (the chart's text-xs); Recharts keeps 6px (tick size) +
// 2px (tick margin) between it and the plot, even without tick lines.
const TICK_FONT_SIZE = 12;
const TICK_GAP = 8;
// The rotated y label (see VerticalAxisLabel): 5px from the axis' edge, 11px wide, then 5px to the ticks.
const Y_LABEL_SPACE = 5 + 11 + 5;
// Slack for ticks a little wider than estimated.
const SLACK = 3;

/** A "nice" step (1, 2, 2.5 or 5 × 10^n) for about `count` ticks over `span`. */
function niceStep(span: number, count: number): number {
  const rough = span / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * Roughly the tick values Recharts picks for a numeric axis over `values`
 * (its default domain starts at 0; about five nice ticks). Only used to
 * size the axis, so it doesn't need to match exactly.
 */
function estimatedTicks(values: number[]): number[] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0];
  const low = Math.min(0, ...finite);
  const high = Math.max(0, ...finite);
  if (high === low) return [low];
  const step = niceStep(high - low, 5);
  const ticks: number[] = [];
  for (let t = Math.floor(low / step) * step; t <= Math.ceil(high / step) * step + step / 2; t += step) {
    // Round off floating point noise (0.30000000000000004).
    ticks.push(Number(t.toPrecision(12)));
  }
  return ticks;
}

/**
 * Width of a numeric y axis over `values`: the widest tick number, the gap to
 * the plot, and with `withLabel` the room for the rotated y label. Computed
 * from the data alone, so resizing the chart doesn't change it.
 */
export function yAxisWidthFor(values: number[], withLabel: boolean): number {
  const widest = Math.max(
    0,
    ...estimatedTicks(values).map((tick) => textWidth(formatChartNumber(tick), TICK_FONT_SIZE))
  );
  return Math.ceil(widest + TICK_GAP + SLACK + (withLabel ? Y_LABEL_SPACE : 0));
}
