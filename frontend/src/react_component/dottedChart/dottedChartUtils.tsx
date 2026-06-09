import type { ReactElement } from "react";
import { Cross, Diamond, Square, Triangle } from "lucide-react";

export type AxisOption =
  | { type: "time" }
  | { type: "timestamp" }
  | { type: "timestamp_unix" }
  | { type: "since_start" }
  | { type: "activity" }
  | { type: "event_attribute"; name: string }
  | { type: "none" };

export type SortOption = {
  field: AxisOption;
  direction?: "asc" | "desc";
};

export interface OCEvent {
  id: string;
  x: number | string | null;
  y: number | string | null;
  color_value: number | string | null;
  shape_value: number | string | null;
  activity: string;
  timestamp: string | null;
  timestamp_unix: number;
  row_id: string | null;
  row_index: number | null;
  event_index_in_row: number | null;
  objects: Record<string, string[]>;
}

export interface DottedChartResponse {
  events: OCEvent[];
  total_count: number;
  sampled: boolean;
  outlier_count: number;
}

export interface DottedChartViewport {
  t_min?: number | string | null;
  t_max?: number | string | null;
  row_min?: number | null;
  row_max?: number | null;
}

export interface ChartPoint extends OCEvent {
  chartX: number;
  chartY: number;
  xLabel: string;
  yLabel: string;
  colorKey: string;
  shapeKey: string;
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#0891b2",
  "#ca8a04",
  "#db2777",
  "#475569",
  "#65a30d",
];

const SHAPES = ["circle", "square", "triangle", "diamond", "cross"] as const;

type ShapeName = (typeof SHAPES)[number];

export function axisOptionToParam(axis?: AxisOption | null): string | undefined {
  if (!axis || axis.type === "none") return undefined;
  if (axis.type === "event_attribute") return axis.name;
  return axis.type;
}

export function sortOptionToParam(sortBy?: SortOption | AxisOption | null): string | undefined {
  if (!sortBy) return undefined;
  if ("type" in sortBy) return axisOptionToParam(sortBy);
  return axisOptionToParam(sortBy.field);
}

export function toChartPoints(events: OCEvent[]): ChartPoint[] {
  const xValues = uniqueValues(events.map((event) => event.x));
  const yValues = uniqueValues(events.map((event) => event.y));
  const xIndexes = new Map(xValues.map((value, index) => [value, index + 1]));
  const yIndexes = new Map(yValues.map((value, index) => [value, index + 1]));

  return events
    .map((event) => {
      const chartX =
        typeof event.x === "number"
          ? event.x
          : xIndexes.get(valueKey(event.x)) ?? Number.NaN;
      const chartY =
        typeof event.y === "number"
          ? event.y
          : yIndexes.get(valueKey(event.y)) ?? Number.NaN;

      return {
        ...event,
        chartX,
        chartY,
        xLabel: valueKey(event.x),
        yLabel: valueKey(event.y),
        colorKey: valueKey(event.color_value ?? event.activity),
        shapeKey: valueKey(event.shape_value ?? "circle"),
      };
    })
    .filter((event) => Number.isFinite(event.chartX) && Number.isFinite(event.chartY));
}

export function makeColorScale(points: ChartPoint[]): Map<string, string> {
  const values = uniqueValues(points.map((point) => point.colorKey));
  return new Map(values.map((value, index) => [value, PALETTE[index % PALETTE.length]]));
}

export function makeShapeScale(points: ChartPoint[]): Map<string, ShapeName> {
  const values = uniqueValues(points.map((point) => point.shapeKey));
  return new Map(values.map((value, index) => [value, SHAPES[index % SHAPES.length]]));
}

export function makeAxisLabelLookup(points: ChartPoint[], axis: "x" | "y"): Map<number, string> {
  const pairs = points.map((point) =>
    axis === "x" ? [point.chartX, point.xLabel] : [point.chartY, point.yLabel]
  ) as Array<[number, string]>;
  return new Map(pairs);
}

export function formatAxisTick(value: number | string): string {
  if (typeof value === "string") return value;
  if (Math.abs(value) >= 1_000_000_000) {
    return new Date(value * 1000).toLocaleDateString();
  }
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatTimestamp(timestamp: string | null, timestampUnix: number): string {
  if (timestamp) return new Date(timestamp).toLocaleString();
  return new Date(timestampUnix * 1000).toLocaleString();
}

export function objectSummary(objects: Record<string, string[]>): string {
  const entries = Object.entries(objects);
  if (!entries.length) return "No related objects";
  return entries
    .map(([type, ids]) => `${type}: ${ids.slice(0, 4).join(", ")}${ids.length > 4 ? "..." : ""}`)
    .join(" · ");
}

export function renderPointShape(
  cx: number,
  cy: number,
  color: string,
  shape: ShapeName,
  onClick?: () => void
): ReactElement<SVGElement> {
  const common = {
    fill: color,
    stroke: color,
    strokeWidth: 1.5,
    role: "button",
    tabIndex: 0,
    onClick,
    style: { cursor: onClick ? "pointer" : "default" },
  };

  if (shape === "square") {
    return <rect x={cx - 3.5} y={cy - 3.5} width={7} height={7} rx={1} {...common} />;
  }
  if (shape === "triangle") {
    return <Triangle x={cx - 4} y={cy - 4} width={8} height={8} {...common} />;
  }
  if (shape === "diamond") {
    return <Diamond x={cx - 4} y={cy - 4} width={8} height={8} {...common} />;
  }
  if (shape === "cross") {
    return <Cross x={cx - 4} y={cy - 4} width={8} height={8} fill="none" {...common} />;
  }
  return <circle cx={cx} cy={cy} r={3.5} {...common} fill="transparent" strokeWidth={1.75} />;
}

function numericValue(value: number | string | null): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function valueKey(value: number | string | null): string {
  if (value === null || value === undefined || value === "") return "None";
  return String(value);
}

function uniqueValues(values: Array<number | string | null>): string[] {
  return Array.from(new Set(values.map(valueKey)));
}
