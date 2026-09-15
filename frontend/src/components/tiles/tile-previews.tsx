/**
 * Thumbnails for the dashboard edit panel's draggable components.
 *
 * Each one is a schematic of the notation its component draws — binding dots
 * for the causal net, places and transitions for the Petri net, chevron rows
 * for variants — so a tile is identifiable without reading its label. They are
 * deliberately *not* screenshots: the panel renders them at 100x50, where a
 * shrunken real graph turns to noise, and five tiles used to share two
 * screenshots between them.
 *
 * Drawn in code rather than shipped as assets, the same way
 * `components/icons/totem-icons.ts` is. That also fixes a bug: the panel used
 * to reference `src/images/...` directly, a path only the dev server resolves,
 * so every image tile — the trash target included — was broken in a build.
 *
 * To add one: draw on the 100x50 grid with a 2px stroke, round caps and joins,
 * and ~4px of outer margin. Structure is slate; object types take their colour
 * from `OBJECT_TYPE_COLORS` so a thumbnail is tinted like the view it stands
 * for. Keep it to 3-8 shapes, and make sure it cannot be mistaken for its
 * neighbours: the three DFG tiles differ by arc weight and by branching, and
 * the dotted chart differs from the scatter plot by colour and trend line.
 */
import React from 'react';

/** The tool's object-type palette, in the order `utils/objectColors.ts` assigns it. */
const BLUE = '#2563EB';
const GREEN = '#10B981';
const AMBER = '#F59E0B';
const VIOLET = '#8B5CF6';
const ROSE = '#F43F5E';
const CYAN = '#06B6D4';

/** Structure, muted fills and text. Never used to stand for an object type. */
const SLATE = '#475569';
const MUTED = '#E2E8F0';
const INK = '#334155';

/**
 * The shared canvas. Fixes the size every tile renders at and paints a white
 * ground, since the artwork's colours are chosen against one.
 */
function TilePreview({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <svg
      width="100"
      height="50"
      viewBox="0 0 100 50"
      role="img"
      aria-label={`${label} preview`}
      className="rounded-md bg-white"
    >
      {children}
    </svg>
  );
}

/** A frame with text rules inside — a block of prose. */
export const TextBoxTile = () => (
  <TilePreview label="Text Box">
    <rect x="5" y="9" width="90" height="32" rx="2" fill="none" stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <line x1="14" y1="19" x2="86" y2="19" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <line x1="14" y1="26" x2="86" y2="26" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <line x1="14" y1="33" x2="56" y2="33" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
  </TilePreview>
);

/** The conventional mountains-and-sun placeholder. */
export const ImageTile = () => (
  <TilePreview label="Image Component">
    <rect x="5" y="9" width="90" height="32" rx="2" fill="none" stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <circle cx="74" cy="20" r="5" fill={AMBER} />
    <polygon points="14,37 32,18 50,37" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <polygon points="42,37 55,25 68,37" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
  </TilePreview>
);

/** Object types grouped into levels inside one area — the enclosing box is the point. */
export const ProcessAreaTile = () => (
  <TilePreview label="Process Area">
    <rect x="4" y="6" width="92" height="38" rx="2" fill="none" stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="10" y="11" width="18" height="10" rx="2" fill={BLUE} />
    <rect x="34" y="11" width="18" height="10" rx="2" fill={GREEN} />
    <rect x="58" y="11" width="18" height="10" rx="2" fill={AMBER} />
    <rect x="22" y="29" width="18" height="10" rx="2" fill={VIOLET} />
    <rect x="50" y="29" width="18" height="10" rx="2" fill={CYAN} />
  </TilePreview>
);

/** Object types joined by temporal relations — no activities, and no enclosing area. */
export const TotemMinerTile = () => (
  <TilePreview label="TOTeM Miner">
    <line x1="17" y1="13" x2="67" y2="12" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <line x1="17" y1="13" x2="69" y2="37" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <line x1="19" y1="37" x2="69" y2="37" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <rect x="8" y="8" width="18" height="10" rx="2" fill={BLUE} />
    <rect x="58" y="7" width="18" height="10" rx="2" fill={AMBER} />
    <rect x="10" y="32" width="18" height="10" rx="2" fill={CYAN} />
    <rect x="60" y="32" width="18" height="10" rx="2" fill={VIOLET} />
  </TilePreview>
);

/** Activities joined by directly-follows arrows, one colour per object type. */
export const OcdfgTile = () => (
  <TilePreview label="Object-Centric DFG">
    <rect x="6" y="18" width="20" height="14" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="40" y="18" width="20" height="14" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="74" y="18" width="20" height="14" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <line x1="27" y1="25" x2="35" y2="25" stroke={BLUE} strokeWidth="2" strokeLinecap="round" />
    <polygon points="35,21 40,25 35,29" fill={BLUE} />
    <line x1="61" y1="25" x2="69" y2="25" stroke={GREEN} strokeWidth="2" strokeLinecap="round" />
    <polygon points="69,21 74,25 69,29" fill={GREEN} />
  </TilePreview>
);

/** The same graph, but the arcs carry visibly different weights. */
export const OcdfgArcWeightTile = () => (
  <TilePreview label="Object-Centric DFG with arc weights">
    <rect x="6" y="14" width="20" height="14" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="40" y="14" width="20" height="14" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="74" y="14" width="20" height="14" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <line x1="27" y1="21" x2="39" y2="21" stroke={BLUE} strokeWidth="1" strokeLinecap="round" />
    <line x1="61" y1="21" x2="73" y2="21" stroke={GREEN} strokeWidth="5" strokeLinecap="round" />
    <path d="M16 29 L16 42 L84 42 L84 29" fill="none" stroke={AMBER} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </TilePreview>
);

/** The same graph forking into two paths that rejoin — branching is the point. */
export const OcdfgVariantsTile = () => (
  <TilePreview label="Object-Centric DFG variants">
    <line x1="23" y1="23" x2="38" y2="14" stroke={BLUE} strokeWidth="2" strokeLinecap="round" />
    <line x1="58" y1="14" x2="73" y2="23" stroke={BLUE} strokeWidth="2" strokeLinecap="round" />
    <line x1="23" y1="28" x2="38" y2="37" stroke={GREEN} strokeWidth="2" strokeLinecap="round" />
    <line x1="58" y1="37" x2="73" y2="28" stroke={GREEN} strokeWidth="2" strokeLinecap="round" />
    <rect x="5" y="19" width="16" height="12" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="38" y="8" width="20" height="12" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="38" y="31" width="20" height="12" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="75" y="19" width="16" height="12" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
  </TilePreview>
);

/** Each edge carries a binding node; the arc ties two of them into one binding. */
export const OccnTile = () => (
  <TilePreview label="Object-Centric Causal Net">
    <line x1="24" y1="25" x2="72" y2="14" stroke={BLUE} strokeWidth="2" strokeLinecap="round" />
    <line x1="24" y1="25" x2="72" y2="36" stroke={GREEN} strokeWidth="2" strokeLinecap="round" />
    <path d="M49 19 Q55 25 49 31" fill="none" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <circle cx="49" cy="19" r="3.5" fill={BLUE} />
    <circle cx="49" cy="31" r="3.5" fill={GREEN} />
    <rect x="5" y="18" width="19" height="14" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="72" y="8" width="22" height="12" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="72" y="30" width="22" height="12" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
  </TilePreview>
);

/** Places and transitions alternating — what makes a Petri net a Petri net. */
export const OcpnTile = () => (
  <TilePreview label="Object-Centric Petri Net">
    <line x1="16" y1="25" x2="27" y2="25" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <line x1="35" y1="25" x2="43" y2="25" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <line x1="57" y1="25" x2="65" y2="25" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <line x1="73" y1="25" x2="83" y2="25" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <circle cx="10" cy="25" r="6" fill="#FFFFFF" stroke={BLUE} strokeWidth="2" />
    <rect x="27" y="16" width="8" height="18" rx="2" fill={INK} />
    <circle cx="50" cy="25" r="7" fill="#FFFFFF" stroke={GREEN} strokeWidth="2" />
    <rect x="65" y="16" width="8" height="18" rx="2" fill={INK} />
    <circle cx="89" cy="25" r="6" fill="#FFFFFF" stroke={VIOLET} strokeWidth="2" />
  </TilePreview>
);

/** A stack of traces, one chevron row per variant. */
export const VariantsTile = () => (
  <TilePreview label="Variants Explorer">
    <polygon points="6,7 21,7 26,12 21,17 6,17 11,12" fill={BLUE} />
    <polygon points="28,7 43,7 48,12 43,17 28,17 33,12" fill={BLUE} />
    <polygon points="50,7 65,7 70,12 65,17 50,17 55,12" fill={BLUE} />
    <polygon points="6,20 21,20 26,25 21,30 6,30 11,25" fill={GREEN} />
    <polygon points="28,20 43,20 48,25 43,30 28,30 33,25" fill={GREEN} />
    <polygon points="50,20 65,20 70,25 65,30 50,30 55,25" fill={GREEN} />
    <polygon points="6,33 21,33 26,38 21,43 6,43 11,38" fill={AMBER} />
    <polygon points="28,33 43,33 48,38 43,43 28,43 33,38" fill={AMBER} />
  </TilePreview>
);

/** A row of stat tiles, each bar standing in for a figure. */
export const LogStatisticsTile = () => (
  <TilePreview label="Log Statistics">
    <rect x="5" y="12" width="27" height="26" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="36" y="12" width="27" height="26" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="67" y="12" width="27" height="26" rx="2" fill={MUTED} stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="12" y="24" width="13" height="9" rx="2" fill={BLUE} />
    <rect x="43" y="19" width="13" height="14" rx="2" fill={GREEN} />
    <rect x="74" y="27" width="13" height="6" rx="2" fill={AMBER} />
  </TilePreview>
);

/** Multi-coloured dots, no trend line — that is what separates it from the scatter plot. */
export const DottedChartTile = () => (
  <TilePreview label="Object-Centric Dotted Chart">
    <path d="M10 7 L10 42 L94 42" fill="none" stroke={SLATE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="23" cy="34" r="3.5" fill={BLUE} />
    <circle cx="37" cy="29" r="3.5" fill={GREEN} />
    <circle cx="51" cy="31" r="3.5" fill={AMBER} />
    <circle cx="65" cy="22" r="3.5" fill={VIOLET} />
    <circle cx="79" cy="16" r="3.5" fill={ROSE} />
    <circle cx="89" cy="12" r="3.5" fill={CYAN} />
  </TilePreview>
);

/**
 * A donut in four segments. Drawn as one circle stroked four times with
 * `strokeDasharray`, so the segments are arc lengths along a circumference of
 * 2*pi*15 = 94.25 rather than four hand-computed arc paths.
 */
export const PieChartTile = () => (
  <TilePreview label="Pie Chart">
    <circle cx="50" cy="25" r="15" fill="none" stroke={BLUE} strokeWidth="10" strokeDasharray="33 61.25" strokeDashoffset="0" />
    <circle cx="50" cy="25" r="15" fill="none" stroke={GREEN} strokeWidth="10" strokeDasharray="23.6 70.65" strokeDashoffset="-33" />
    <circle cx="50" cy="25" r="15" fill="none" stroke={AMBER} strokeWidth="10" strokeDasharray="23.6 70.65" strokeDashoffset="-56.6" />
    <circle cx="50" cy="25" r="15" fill="none" stroke={VIOLET} strokeWidth="10" strokeDasharray="14.1 80.15" strokeDashoffset="-80.2" />
  </TilePreview>
);

/** A code frame with a title bar and a keyword. */
export const SqlEditorTile = () => (
  <TilePreview label="SQL Editor">
    <rect x="5" y="8" width="90" height="34" rx="2" fill="none" stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <rect x="6" y="9" width="88" height="10" fill={MUTED} />
    <text x="11" y="30" fontFamily="monospace" fontSize="8" fill={VIOLET}>SELECT *</text>
    <line x1="11" y1="35" x2="72" y2="35" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <line x1="11" y1="39" x2="52" y2="39" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
  </TilePreview>
);

/**
 * The corner mark the three SQL-driven widgets share, so they read as a family
 * and stay distinct from the plain charts above them in the panel. Positioned
 * per tile: the KPI has a frame to sit inside, the two charts do not.
 */
const sqlMark = (x: number, y: number) => (
  <text x={x} y={y} textAnchor="end" fontFamily="monospace" fontSize="7" fill={VIOLET}>SQL</text>
);

/** One big figure with a caption rule. */
export const KpiTile = () => (
  <TilePreview label="KPI by SQL">
    <rect x="5" y="6" width="90" height="38" rx="2" fill="none" stroke={SLATE} strokeWidth="2" strokeLinejoin="round" />
    <text x="46" y="30" textAnchor="middle" fontFamily="sans-serif" fontWeight="700" fontSize="17" fill={INK}>12,345</text>
    <line x1="33" y1="37" x2="59" y2="37" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    {sqlMark(89, 17)}
  </TilePreview>
);

export const BarChartTile = () => (
  <TilePreview label="Bar Chart by SQL">
    <line x1="8" y1="42" x2="94" y2="42" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <rect x="12" y="24" width="14" height="18" fill={BLUE} />
    <rect x="31" y="19" width="14" height="23" fill={BLUE} />
    <rect x="50" y="30" width="14" height="12" fill={BLUE} />
    <rect x="69" y="22" width="14" height="20" fill={BLUE} />
    {sqlMark(94, 13)}
  </TilePreview>
);

/** One colour and a trend line, against the dotted chart's many colours and none. */
export const ScatterPlotTile = () => (
  <TilePreview label="Scatter Plot by SQL">
    <path d="M10 7 L10 42 L94 42" fill="none" stroke={SLATE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="18" y1="37" x2="86" y2="15" stroke={SLATE} strokeWidth="2" strokeLinecap="round" strokeDasharray="4 4" />
    <circle cx="26" cy="35" r="3.5" fill={BLUE} />
    <circle cx="42" cy="32" r="3.5" fill={BLUE} />
    <circle cx="56" cy="24" r="3.5" fill={BLUE} />
    <circle cx="70" cy="25" r="3.5" fill={BLUE} />
    <circle cx="83" cy="17" r="3.5" fill={BLUE} />
    {sqlMark(94, 13)}
  </TilePreview>
);

/** The delete target: an action, not a component, so outline-only and uncoloured. */
export const TrashTile = () => (
  <TilePreview label="Drop here to remove">
    <line x1="30" y1="15" x2="70" y2="15" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <path d="M42 15 L42 10 L58 10 L58 15" fill="none" stroke={SLATE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M35 15 L38 43 L62 43 L65 15" fill="none" stroke={SLATE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="45" y1="21" x2="46" y2="37" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
    <line x1="55" y1="21" x2="54" y2="37" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
  </TilePreview>
);
