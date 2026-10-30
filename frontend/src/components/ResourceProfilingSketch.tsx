/**
 * ResourceProfilingSketch — a draft of the resource profiling result for the
 * widget's edit tile and settings popup, modelled on the explorer's graph:
 * resources as points in the object-type colors of the selected resource
 * types (one type: every point; several: mixed), grouped into three clusters
 * with dashed outlines in the explorer's cluster colors (left out when
 * clustering is off), and a draft tooltip with one section per selected
 * feature group. Values are grey placeholders.
 */

import React from "react";
import { cn } from "@/lib/utils";
import {
  FEATURE_GROUPS,
  type FeatureGroup,
  type ProfilingPointSize,
} from "@/react_component/orgamining/settings";

const WIDTH = 300;
const HEIGHT = 200;
// The explorer's first cluster colors (OrgaMiningExplorer CLUSTER_COLORS).
const CLUSTER_COLORS = ["#f43f5e", "#f97316", "#eab308"];
// Resources of the three clusters in drawing units; the middle one sits
// under the tooltip, as the explorer shows a cluster's profile next to it.
const CLUSTERS: [number, number][][] = [
  [[52, 30], [70, 44], [44, 58], [62, 70], [38, 86], [56, 98], [30, 112]],
  [[150, 70], [166, 84], [146, 96], [170, 106], [156, 118]],
  [[62, 150], [86, 140], [108, 152], [76, 168], [100, 176], [124, 164], [52, 172], [118, 184]],
];
// Position of each cluster's first point when counting all points in a row.
const CLUSTER_OFFSETS = CLUSTERS.map((_, c) => CLUSTERS.slice(0, c).reduce((s, points) => s + points.length, 0));
// Point radius per point size (medium as the draft always drew them), and the
// fill opacity of "transparent points".
const POINT_RADIUS: Record<ProfilingPointSize, number> = { small: 2.8, medium: 4, large: 5.4 };
const TRANSPARENT_OPACITY = 0.45;
// How far a cluster's outline keeps from its outermost points.
const HULL_PADDING = 9;
// The cluster whose profile the tooltip shows.
const TOOLTIP_CLUSTER = 1;
const INK = "var(--muted-foreground)";

// Section titles as in the explorer's tooltip.
const SECTION_TITLES: Record<FeatureGroup, string> = {
  activity_fractions: "ACTIVITIES",
  cooccurrence_fractions: "CO-OCCURRENCE",
  object_collaboration_fractions: "OBJECT COLLABORATION",
  object_portfolio_fractions: "BO TYPE FRACTIONS",
  time_fractions: "TIME BINNING (HOURLY)",
  weekday_fractions: "TIME BINNING (WEEKLY)",
};
// Placeholder bar heights (share of the chart height) for the time histograms.
const HOURLY = [0, 0, 0, 0, 0, 0, 0.1, 0.35, 0.7, 0.85, 0.9, 0.6, 0.75, 0.8, 1, 0.8, 0.55, 0.3, 0.15, 0.08, 0.05, 0, 0, 0];
const WEEKLY = [0.8, 1, 0.9, 0.9, 0.75, 0.05, 0.05];

/** Convex hull (monotone chain) of points, for a cluster's outline. */
function convexHull(points: [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (pts: [number, number][]) => {
    const out: [number, number][] = [];
    for (const p of pts) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** The hull pushed outwards from the cluster's center, so the points sit inside. */
function paddedHull(points: [number, number][]): string {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  return convexHull(points)
    .map(([x, y]) => {
      const d = Math.hypot(x - cx, y - cy) || 1;
      return `${x + ((x - cx) / d) * HULL_PADDING},${y + ((y - cy) / d) * HULL_PADDING}`;
    })
    .join(" ");
}

/** Placeholder for a line of text. */
const TextBar = ({ x, y, width, opacity = 0.3 }: { x: number; y: number; width: number; opacity?: number }) => (
  <rect x={x} y={y - 1.5} width={width} height={3} rx={1.5} fill={INK} opacity={opacity} />
);

const ResourceProfilingSketch: React.FC<{
  /** The selected resource types; no selection draws grey points. */
  resourceTypes: string[];
  /** Object type → color, as the explorer colors them. */
  typeColors: Record<string, string>;
  computeClusters: boolean;
  /** Feature groups shown in the tooltip (clustering features and tooltip extras). */
  tooltipGroups: FeatureGroup[];
  pointSize?: ProfilingPointSize;
  /** See-through points, as with "Transparent points" in the graph. */
  transparentPoints?: boolean;
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}> = ({
  resourceTypes,
  typeColors,
  computeClusters,
  tooltipGroups,
  pointSize = "medium",
  transparentPoints = false,
  className,
}) => {
  const typeColor = (cluster: number, point: number) => {
    if (resourceTypes.length === 0) return INK;
    // The types take turns over all points of all clusters, so every selected
    // type gets about the same number of points (one type: all of them) and
    // the clusters come out mixed.
    const index = CLUSTER_OFFSETS[cluster] + point;
    return typeColors[resourceTypes[index % resourceTypes.length]] ?? INK;
  };

  // Tooltip sections in the explorer's order; without any feature the explorer uses activity fractions.
  const groups = FEATURE_GROUPS.filter((g) => tooltipGroups.includes(g));
  const sections = groups.length ? groups : (["activity_fractions"] as FeatureGroup[]);
  const sectionHeight = (g: FeatureGroup) =>
    g === "activity_fractions" ? 34 : g === "time_fractions" || g === "weekday_fractions" ? 24 : 21;

  const cardX = 192;
  const cardWidth = WIDTH - cardX - 6;
  const cardTop = 8;
  const headerHeight = 14;
  // Each section's height already leaves a little space below its content,
  // so the card only needs a small bottom padding on top of that.
  const cardHeight = headerHeight + sections.reduce((s, g) => s + sectionHeight(g), 0) + 3;
  const inner = cardX + 7;
  const innerWidth = cardWidth - 14;
  const accent = CLUSTER_COLORS[TOOLTIP_CLUSTER];

  let y = cardTop + headerHeight;
  const sectionShapes = sections.map((g) => {
    const top = y;
    y += sectionHeight(g);
    const title = (
      <text x={inner} y={top + 5} dominantBaseline="central" fontSize={4.2} fontWeight={600} letterSpacing={0.3} fill={INK}>
        {SECTION_TITLES[g]}
      </text>
    );
    const divider = <line x1={inner} x2={inner + innerWidth} y1={top} y2={top} stroke="var(--border)" strokeWidth={0.5} />;
    const row = (ry: number, width: number, key: number) => (
      <g key={key}>
        <circle cx={inner + 2} cy={ry} r={1.6} fill={INK} opacity={0.45} />
        <TextBar x={inner + 6} y={ry} width={width} />
        <TextBar x={inner + innerWidth - 10} y={ry} width={10} opacity={0.2} />
      </g>
    );
    let content: React.ReactNode;
    if (g === "activity_fractions") {
      // A small pie and its legend rows.
      const cx = inner + innerWidth / 2;
      const cy = top + 14;
      content = (
        <g>
          <circle cx={cx} cy={cy} r={6} fill={INK} opacity={0.35} />
          <path d={`M${cx},${cy} L${cx},${cy - 6} A6,6 0 0 1 ${cx + 5.2},${cy + 3} Z`} fill={INK} opacity={0.55} />
          {row(top + 25, 30, 0)}
          {row(top + 30, 24, 1)}
        </g>
      );
    } else if (g === "time_fractions" || g === "weekday_fractions") {
      // A small histogram over the hours of the day or the days of the week.
      const values = g === "time_fractions" ? HOURLY : WEEKLY;
      const base = top + 20;
      const slot = innerWidth / values.length;
      content = (
        <g>
          {values.map((v, i) => (
            <rect
              key={i}
              x={inner + i * slot + slot * 0.12}
              y={base - v * 10}
              width={slot * 0.76}
              height={Math.max(v * 10, 0.4)}
              fill={INK}
              opacity={0.4}
            />
          ))}
          <line x1={inner} x2={inner + innerWidth} y1={base} y2={base} stroke="var(--border)" strokeWidth={0.5} />
        </g>
      );
    } else {
      content = (
        <g>
          {row(top + 12, 28, 0)}
          {row(top + 17, 20, 1)}
        </g>
      );
    }
    return (
      <g key={g}>
        {divider}
        {title}
        {content}
      </g>
    );
  });

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the resource profiling result"
    >
      {/* Clusters: dashed outline and light tint, as in the explorer. */}
      {computeClusters &&
        CLUSTERS.map((points, c) => (
          <polygon
            key={c}
            points={paddedHull(points)}
            fill={CLUSTER_COLORS[c]}
            fillOpacity={0.08}
            stroke={CLUSTER_COLORS[c]}
            strokeWidth={0.8}
            strokeDasharray="3 2"
            strokeLinejoin="round"
          />
        ))}
      {CLUSTERS.map((points, c) =>
        points.map(([x, yy], i) => (
          <circle
            key={`${c}-${i}`}
            cx={x}
            cy={yy}
            r={POINT_RADIUS[pointSize]}
            fill={typeColor(c, i)}
            fillOpacity={transparentPoints ? TRANSPARENT_OPACITY : resourceTypes.length ? 1 : 0.55}
            stroke={computeClusters ? CLUSTER_COLORS[c] : "var(--background)"}
            strokeWidth={1.2}
          />
        ))
      )}

      {/* The draft tooltip with one section per feature group. */}
      <rect
        x={cardX}
        y={cardTop}
        width={cardWidth}
        height={cardHeight}
        rx={5}
        fill="var(--card)"
        stroke={computeClusters ? accent : "var(--border)"}
        strokeWidth={0.9}
      />
      <text
        x={inner}
        y={cardTop + 8}
        dominantBaseline="central"
        fontSize={4.6}
        fontWeight={700}
        letterSpacing={0.3}
        fill={computeClusters ? accent : INK}
      >
        {computeClusters ? "CLUSTER 2 — AVG. PROFILE" : "RESOURCE"}
      </text>
      {sectionShapes}
    </svg>
  );
};

export default ResourceProfilingSketch;
