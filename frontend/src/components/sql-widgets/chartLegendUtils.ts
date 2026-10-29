/**
 * Non-component helpers for the chart legends in chartLegend.tsx: the
 * settings types, value formatting, and the pie callout layout (where each
 * callout goes, and how large the pie can be so all callouts fit).
 */

export type LegendPosition = "bottom" | "columns" | "callouts";
export type LegendValues = "none" | "value" | "percent" | "both";

export interface ChartStyle {
  /** Pie chart footer with the number of categories; shown unless false. */
  show_category_count?: boolean;
  legend?: {
    position?: LegendPosition;
    values?: LegendValues;
  };
}

export interface LegendItem {
  label: string;
  color: string;
  /** Omitted when the chart has no per-entry value to show. */
  value?: number;
}

export function formatPercent(share: number): string {
  const pct = share * 100;
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

export function formatLegendValue(value: number, share: number, mode: LegendValues): string {
  switch (mode) {
    case "value":
      return value.toLocaleString();
    case "percent":
      return formatPercent(share);
    case "both":
      return `${value.toLocaleString()} (${formatPercent(share)})`;
    default:
      return "";
  }
}

/* ------------------------------------------------------------------ */
/* Pie callouts                                                        */
/* ------------------------------------------------------------------ */

// Slices below this share of the total get no callout; they would overlap.
export const CALLOUT_MIN_PERCENT = 0.03;
const CALLOUT_MAX_CHARS = 20;
// Radial distance from the slice edge to the bend of the connector.
const CALLOUT_ELBOW = 14;
// Length of the horizontal connector part between the bend and the text.
const CALLOUT_TAIL = 14;
// Gap between the connector end and the text, and between label and value.
export const CALLOUT_TEXT_GAP = 4;
// Callout font (text-xs) and the vertical room one or two text lines take.
const CALLOUT_FONT_PX = 12;
const CALLOUT_LINE_HEIGHT = 26;
const CALLOUT_TWO_LINE_HEIGHT = 40;
// Space kept free at the chart edges.
const CALLOUT_EDGE_PADDING = 6;
// Below this radius the pie gets too small; break callouts onto two lines instead.
const CALLOUT_MIN_RADIUS = 70;
// The radius recharts uses by default, as a share of half the smaller chart side.
const DEFAULT_RADIUS_SHARE = 0.8;
// Pie charts in recharts keep a 5px margin on every side.
const RECHARTS_MARGIN = 5;

export function calloutLabel(label: string): string {
  return label.length > CALLOUT_MAX_CHARS ? `${label.slice(0, CALLOUT_MAX_CHARS - 1)}…` : label;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in the callout font, in px. */
function textWidth(text: string): number {
  if (!text) return 0;
  if (measureContext === undefined) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return text.length * CALLOUT_FONT_PX * 0.6;
  measureContext.font = `${CALLOUT_FONT_PX}px ${getComputedStyle(document.body).fontFamily}`;
  return measureContext.measureText(text).width;
}

/** Angle of each slice's middle in radians, counterclockwise from 3 o'clock as recharts draws it. */
function sliceAngles(shares: number[]): number[] {
  let start = 0;
  return shares.map((share) => {
    const angle = (start + share / 2) * 2 * Math.PI;
    start += share;
    return angle;
  });
}

export interface CalloutPlacement {
  side: 1 | -1;
  /** Point on the slice edge, the bend of the connector, and the text anchor. */
  sx: number;
  sy: number;
  bx: number;
  by: number;
  tx: number;
  ty: number;
}

/**
 * Places the callouts of all slices large enough to get one: each text sits
 * next to its slice and is only moved vertically where it would overlap a
 * neighbour on the same side. A moved callout takes its bend along, so the
 * part between bend and text stays horizontal.
 */
export function layoutPieCallouts(
  shares: number[],
  cx: number,
  cy: number,
  radius: number,
  twoLines: boolean
): Map<number, CalloutPlacement> {
  const angles = sliceAngles(shares);
  const placements = new Map<number, CalloutPlacement>();
  shares.forEach((share, index) => {
    if (share < CALLOUT_MIN_PERCENT) return;
    const cos = Math.cos(angles[index]);
    const sin = -Math.sin(angles[index]); // SVG y grows downwards
    const side = cos >= 0 ? 1 : -1;
    const bx = cx + (radius + CALLOUT_ELBOW) * cos;
    const by = cy + (radius + CALLOUT_ELBOW) * sin;
    placements.set(index, {
      side,
      sx: cx + radius * cos,
      sy: cy + radius * sin,
      bx,
      by,
      tx: bx + side * CALLOUT_TAIL,
      ty: by,
    });
  });

  const lineHeight = twoLines ? CALLOUT_TWO_LINE_HEIGHT : CALLOUT_LINE_HEIGHT;
  const top = lineHeight / 2;
  const bottom = 2 * cy - lineHeight / 2;
  for (const side of [1, -1]) {
    const column = [...placements.values()]
      .filter((p) => p.side === side)
      .sort((a, b) => a.ty - b.ty);
    // Push down past the previous callout, then back up if the last one left the chart.
    column.forEach((p, i) => {
      p.ty = Math.max(p.ty, i === 0 ? top : column[i - 1].ty + lineHeight);
    });
    for (let i = column.length - 1; i >= 0; i--) {
      const limit = i === column.length - 1 ? bottom : column[i + 1].ty - lineHeight;
      column[i].ty = Math.min(column[i].ty, limit);
    }
  }
  for (const p of placements.values()) p.by = p.ty;
  return placements;
}

/** Largest radius at which every callout, `widths[i]` px wide, stays inside the chart. */
function radiusForCallouts(
  angles: number[],
  shares: number[],
  widths: number[],
  width: number,
  height: number,
  lineHeight: number
): number {
  const halfWidth = width / 2 - RECHARTS_MARGIN - CALLOUT_EDGE_PADDING;
  const halfHeight = height / 2 - RECHARTS_MARGIN - CALLOUT_EDGE_PADDING;
  let radius = Math.min(halfWidth, halfHeight) * DEFAULT_RADIUS_SHARE;
  shares.forEach((share, i) => {
    if (share < CALLOUT_MIN_PERCENT) return;
    const cos = Math.abs(Math.cos(angles[i]));
    const sin = Math.abs(Math.sin(angles[i]));
    // Horizontal: bend + tail + gap + text must end before the chart edge.
    const room = halfWidth - CALLOUT_TAIL - CALLOUT_TEXT_GAP - widths[i];
    if (cos > 0.01) radius = Math.min(radius, room / cos - CALLOUT_ELBOW);
    // Vertical: the text line must stay below the top / above the bottom edge.
    if (sin > 0.01) radius = Math.min(radius, (halfHeight - lineHeight / 2) / sin - CALLOUT_ELBOW);
  });
  return radius;
}

/**
 * How large the pie can be with callouts in a `width` x `height` chart. Uses
 * one-line callouts while the pie stays reasonably large, and moves the value
 * onto a second line otherwise.
 */
export function fitPieCallouts(
  items: { label: string; value: number }[],
  values: LegendValues,
  width: number,
  height: number
): { radius: number; twoLines: boolean } {
  const total = items.reduce((acc, item) => acc + item.value, 0);
  const shares = items.map((item) => (total ? item.value / total : 0));
  const angles = sliceAngles(shares);
  const labelWidths = items.map((item) => textWidth(calloutLabel(item.label)));
  const valueWidths = items.map((item, i) => textWidth(formatLegendValue(item.value, shares[i], values)));

  const oneLine = radiusForCallouts(
    angles,
    shares,
    labelWidths.map((w, i) => (valueWidths[i] ? w + CALLOUT_TEXT_GAP + valueWidths[i] : w)),
    width,
    height,
    CALLOUT_LINE_HEIGHT
  );
  // In small charts even a pie without callouts is below the minimum, so compare
  // against what the pie would get anyway.
  const fullRadius =
    (Math.min(width, height) / 2 - RECHARTS_MARGIN - CALLOUT_EDGE_PADDING) * DEFAULT_RADIUS_SHARE;
  if (oneLine >= Math.min(CALLOUT_MIN_RADIUS, fullRadius * 0.6) || values === "none") {
    return { radius: Math.max(oneLine, CALLOUT_MIN_RADIUS / 2), twoLines: false };
  }

  const twoLines = radiusForCallouts(
    angles,
    shares,
    labelWidths.map((w, i) => Math.max(w, valueWidths[i])),
    width,
    height,
    CALLOUT_TWO_LINE_HEIGHT
  );
  return { radius: Math.max(twoLines, oneLine, CALLOUT_MIN_RADIUS / 2), twoLines: twoLines > oneLine };
}
