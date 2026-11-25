/**
 * Legend pieces shared by the SQL chart widgets: an HTML legend below the
 * chart (a wrapped row or aligned columns, optionally with values) and, for
 * pie charts, slice callouts (a connector line from the slice edge to its
 * label). The settings live in the widget node's `chart_style.legend` object;
 * types and layout helpers are in chartLegendUtils.ts.
 */

import type { ReactNode } from "react";
import type { PieLabelRenderProps } from "recharts";
import { cn } from "@/lib/utils";
import {
  CALLOUT_TEXT_GAP,
  calloutLabel,
  formatLegendValue,
  formatPercent,
  layoutPieCallouts,
  type LegendItem,
  type LegendValues,
} from "./chartLegendUtils";

const Swatch = ({ color }: { color: string }) => (
  <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
);

/** Legend below the chart: `bottom` wraps entries in a row, `columns` aligns them in a grid. */
export function ChartValueLegend({
  items,
  layout,
  values = "none",
  className,
}: {
  items: LegendItem[];
  layout: "bottom" | "columns";
  values?: LegendValues;
  className?: string;
}) {
  const total = items.reduce((acc, item) => acc + (item.value ?? 0), 0);
  const share = (value: number) => (total ? value / total : 0);

  if (layout === "bottom") {
    return (
      <div className={cn("flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs", className)}>
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <Swatch color={item.color} />
            <span>{item.label}</span>
            {values !== "none" && item.value != null && (
              <span className="text-muted-foreground tabular-nums">
                {formatLegendValue(item.value, share(item.value), values)}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  const showValue = values === "value" || values === "both";
  const showPercent = values === "percent" || values === "both";
  // Fixed, compact columns (wider when values are shown), centered as a group,
  // so each entry's name stays close to its swatch and numbers.
  const columnWidth = values === "both" ? "15rem" : values === "none" ? "10rem" : "12rem";
  return (
    <div
      className={cn("grid gap-x-12 gap-y-1 text-left text-xs", className)}
      style={{ gridTemplateColumns: `repeat(auto-fill, ${columnWidth})`, justifyContent: "center" }}
    >
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 items-center gap-1.5">
          <Swatch color={item.color} />
          <span className="min-w-0 flex-1 truncate" title={item.label}>
            {item.label}
          </span>
          {showValue && item.value != null && (
            <span className="tabular-nums">{item.value.toLocaleString()}</span>
          )}
          {showPercent && item.value != null && (
            <span className="w-12 text-right text-muted-foreground tabular-nums">
              {formatPercent(share(item.value))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Pie charts only: one slice's callout, a connector from the slice edge plus
 * its label. Render it from recharts' `<Pie label>` with the label props;
 * `shares` (every slice's fraction of the total, in data order) lets each
 * callout make room for its neighbours, and `twoLines` puts the value below
 * the label instead of next to it (see fitPieCallouts).
 */
export function PieCallout({
  values,
  shares,
  twoLines = false,
  ...props
}: PieLabelRenderProps & { values: LegendValues; shares: number[]; twoLines?: boolean }): ReactNode {
  const { cx, cy, outerRadius, percent, name, value, fill, index } = props;
  const placement = layoutPieCallouts(
    shares,
    Number(cx) || 0,
    Number(cy) || 0,
    Number(outerRadius) || 0,
    twoLines
  ).get(index);
  if (!placement) return null;

  const { side, sx, sy, bx, by, tx, ty } = placement;
  const label = String(name ?? "");
  const valueText = formatLegendValue(Number(value) || 0, Number(percent) || 0, values);
  const textX = tx + side * CALLOUT_TEXT_GAP;

  return (
    <g>
      <circle cx={sx} cy={sy} r={2} fill={fill} />
      <polyline
        points={`${sx},${sy} ${bx},${by} ${tx},${ty}`}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth={1}
      />
      {/* dy instead of dominant-baseline: tspans don't inherit the latter */}
      <text
        x={textX}
        y={ty}
        dy={twoLines && valueText ? "-0.25em" : "0.35em"}
        textAnchor={side === 1 ? "start" : "end"}
        className="fill-foreground text-xs"
      >
        <title>{label}</title>
        {calloutLabel(label)}
        {valueText &&
          (twoLines ? (
            <tspan className="fill-muted-foreground" x={textX} dy="1.2em">
              {valueText}
            </tspan>
          ) : (
            <tspan className="fill-muted-foreground" dx={CALLOUT_TEXT_GAP}>
              {valueText}
            </tspan>
          ))}
      </text>
    </g>
  );
}
