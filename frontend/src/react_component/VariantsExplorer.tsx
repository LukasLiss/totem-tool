import React, { useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, ZoomIn, ZoomOut, Search,
  AlignLeft, Download, Filter, MinusCircle, PlusCircle
} from "lucide-react";

import { Switch } from "@/components/ui/switch";

/* =========================
   Types shared with callers
   ========================= */
export type VariantObject = {
  id: string;
  type: string;
  label?: string;
};

export type VariantEventNode = {
  id: string;
  activity: string;
  objectIds: string[];
  types: string[];
  x: number;
  y_lane: number;
  y_lanes: number[];
};

export type VariantGraph = {
  nodes: VariantEventNode[];
  edges: { from: string; to: string }[];
  objects: VariantObject[];
};

export type Variant = {
  id: string | number;
  support: number;
  signature: string;
  signature_hash: string;
  graph: VariantGraph;
};

/* ========== minimalist UI wrappers (no shadcn) ========== */
type BasicChildrenProps = { className?: string; children?: React.ReactNode };

const Card: React.FC<BasicChildrenProps> = ({ className = "", children }) => (
  <div className="rounded-md border" style={{ borderColor: "#E2E8F0" }}>
    <div className={className}>{children}</div>
  </div>
);
const CardHeader: React.FC<BasicChildrenProps> = ({ className = "", children }) => (
  <div className={className} style={{ padding: "12px 16px" }}>{children}</div>
);
const CardContent: React.FC<BasicChildrenProps> = ({ className = "", children }) => (
  <div className={className} style={{ padding: "12px 16px" }}>{children}</div>
);
const CardTitle: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 18, fontWeight: 600, color: "#0F172A" }}>{children}</div>
);

type ButtonProps = {
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  title?: string;
  size?: "md" | "icon" | "sm";
  variant?: "solid" | "ghost";
  className?: string;
};
const Button: React.FC<ButtonProps> = ({
  children, onClick, title, size = "md", variant = "solid", className = ""
}) => {
  const pad = size === "icon" ? "6px" : "6px 10px";
  const bg = variant === "ghost" ? "transparent" : "#2563EB";
  const col = variant === "ghost" ? "#0F172A" : "#fff";
  const brd = variant === "ghost" ? "#E2E8F0" : "transparent";
  return (
    <button
      onClick={onClick}
      title={title}
      className={className}
      style={{
        padding: pad, background: bg, color: col,
        border: "1px solid " + brd, borderRadius: 8, lineHeight: 1
      }}
    >
      {children}
    </button>
  );
};

/* slider wrapper (expects onValueChange([number])) */
type SliderProps = {
  value: [number];
  min: number;
  max: number;
  step: number;
  onValueChange: (vals: [number]) => void;
  className?: string;
};
const Slider: React.FC<SliderProps> = ({ value, min, max, step, onValueChange, className = "" }) => (
  <input
    type="range"
    className={className}
    min={min}
    max={max}
    step={step}
    value={value[0]}
    onChange={(e) => onValueChange([Number(e.target.value)])}
  />
);

/* ========== colors/tokens ========== */
const ACTOR_COLORS = ["#2563EB", "#10B981", "#F59E0B", "#8B5CF6", "#F43F5E"];
const EXTENDED_PALETTE = ["#06B6D4", "#84CC16", "#F97316", "#EC4899", "#6366F1"];
const TYPE_PALETTE = [...ACTOR_COLORS, ...EXTENDED_PALETTE];

const UI = {
  primary: "#2563EB",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E2E8F0",
  mutedBG: "#F8FAFC",
};

/* ========== utils ========== */
function shade(hex: string, factor: number): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const mix = (x: number) => Math.round(x + (255 - x) * factor);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
function mapTypesToColors(types: string[], overrides?: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  let i = 0;
  for (const t of types) {
    map[t] = (overrides && overrides[t]) || TYPE_PALETTE[i % TYPE_PALETTE.length];
    i++;
  }
  return map;
}
function abbreviateFirstLetters(label?: string): string | undefined {
  if (!label) return label;
  const words = label.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 12);
  return words.map((w) => w[0]).join("");
}

function consecutiveDedup(list: string[]): string[] {
  const out: string[] = [];
  for (const s of list) if (!out.length || out[out.length - 1] !== s) out.push(s);
  return out;
}

function modeOf(arr: string[]): string | undefined {
  if (!arr.length) return undefined;
  const m = new Map<string, number>();
  for (const a of arr) m.set(a, (m.get(a) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function activitiesFromSignature(sig?: string): string[] {
  if (!sig) return [];
  if (sig.includes("->") || sig.includes("→")) {
    return sig.split(/(?:->|→)/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function activitiesFromGraph(g: VariantGraph): string[] {
  // representative activity per x-column (mode)
  const byX = new Map<number, string[]>();
  for (const n of g.nodes) {
    if (!byX.has(n.x)) byX.set(n.x, []);
    byX.get(n.x)!.push(n.activity);
  }
  const xs = [...byX.keys()].sort((a, b) => a - b);
  const seq: string[] = [];
  for (const x of xs) {
    const m = modeOf(byX.get(x)!);
    if (m) seq.push(m);
  }
  return seq;
}

/** Closed-summary rule:
 * - ≤3: show all
 * - =4: show first two, third, last (all four)
 * - ≥5: first two, …, last
 */
function summarizeClosedVariant(v: Variant): string {
  let seq = activitiesFromSignature(v.signature);
  if (!seq.length) seq = activitiesFromGraph(v.graph);
  seq = consecutiveDedup(seq);

  const n = seq.length;
  if (n === 0) return "";
  if (n <= 3) return seq.join(" → ");
  if (n === 4) return [seq[0], seq[1], seq[2], seq[3]].join(" → ");
  return [seq[0], seq[1], "…", seq[n - 1]].join(" → ");
}


/* ========== shapes ========== */
const chevronClip = (tipPx: number = 16): string =>
  `polygon(0 0,
           calc(100% - ${tipPx}px) 0,
           100% 50%,
           calc(100% - ${tipPx}px) 100%,
           0 100%,
           ${tipPx}px 50%)`;

/* ========== main component ========== */
type VariantsExplorerProps = {
  variants: Variant[];
  typeColors?: Record<string, string>;
  laneHeight?: number;
  colWidth?: number;
};

export default function VariantsExplorer({
  variants,
  typeColors,
  laneHeight = 40,
  colWidth = 120,
}: VariantsExplorerProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [labelMode, setLabelMode] = useState<"compact" | "full">("compact");
  const [query, setQuery] = useState<string>("");
  const [minSupport, setMinSupport] = useState<number>(0);

  const totalSupport = useMemo(() => variants.reduce((s, v) => s + v.support, 0), [variants]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variants
      .filter((v) => v.support >= minSupport)
      .filter((v) => q ? (String(v.id).toLowerCase().includes(q) || v.signature.toLowerCase().includes(q)) : true)
      .sort((a, b) => b.support - a.support);
  }, [variants, minSupport, query]);

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <CardTitle>Object-Centric Variants</CardTitle>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Zoom */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ZoomOut size={16} color={UI.textSecondary} />
              <Slider
                value={[zoom]} min={0.5} max={2} step={0.1}
                onValueChange={(v) => setZoom(v[0])}
                className="w-40"
              />
              <ZoomIn size={16} color={UI.textSecondary} />
            </div>

            {/* Label mode toggle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: UI.mutedBG,
                border: `1px solid ${UI.border}`,
                borderRadius: 8,
                padding: "6px 10px",
              }}
            >
              <span style={{ fontSize: 12, color: UI.textSecondary }}>Compact</span>
              <Switch
                checked={labelMode === "full"}
                onCheckedChange={(val) => setLabelMode(val ? "full" : "compact")}
                aria-label="Toggle label mode"
              />
              <span style={{ fontSize: 12, color: UI.textSecondary }}>Full</span>
            </div>

            {/* Search */}
            <div style={{ position: "relative" }}>
              <Search size={14} color={UI.textSecondary} style={{ position: "absolute", left: 8, top: 10 }} />
              <input
                placeholder="Filter by id or signature…"
                style={{ padding: "8px 8px 8px 28px", width: 260, border: `1px solid ${UI.border}`, borderRadius: 8 }}
                value={query} onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter variants"
              />
            </div>

            {/* Min support */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Filter size={16} color={UI.textSecondary} />
              <input
                type="number" min={0}
                style={{ width: 100, padding: "6px 8px", border: `1px solid ${UI.border}`, borderRadius: 8 }}
                value={String(minSupport)}
                onChange={(e) => setMinSupport(Math.max(0, Number(e.target.value || 0)))}
                placeholder="Min support"
                aria-label="Minimum support"
              />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-2">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((v) => (
            <VariantRow
              key={v.signature_hash}
              v={v}
              totalSupport={totalSupport}
              zoom={zoom}
              labelMode={labelMode}
              laneHeight={laneHeight}
              colWidth={colWidth}
              typeColorsOverride={typeColors}
            />
          ))}
          {filtered.length === 0 && (
            <div style={{ fontSize: 12, color: UI.textSecondary }}>No variants match your filters.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// This type is needed for compatibility with the existing rendering logic
type PositionedEvent = {
  id: string;
  activity: string;
  objectIds: string[];
  xStart: number;
  xEnd: number;
};

/* ========== Variant row ========== */
type VariantRowProps = {
  v: Variant;
  totalSupport: number;
  zoom: number;
  labelMode: "compact" | "full";
  laneHeight: number;
  colWidth: number;
  typeColorsOverride?: Record<string, string>;
};

function VariantRow({
  v, totalSupport, zoom, labelMode, laneHeight, colWidth, typeColorsOverride
}: VariantRowProps) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());

  const GUTTER = 16;         // padding inside canvas box
  const ROW_GAP = 6;         // px space between lanes (canvas + legend)

  // create positioned events from precomputed nodes
  const pos = useMemo(() => {
    const positionedEvents: Record<string, PositionedEvent> = {};
    for (const node of v.graph.nodes) {
      positionedEvents[node.id] = {
        id: node.id,
        activity: node.activity,
        objectIds: node.objectIds,
        xStart: node.x,
        xEnd: node.x,
      };
    }
    return positionedEvents;
  }, [v.graph.nodes]);

  const objects = v.graph.objects;

  const objectTypes = useMemo(
    () => Array.from(new Set(objects.map((o) => o.type))),
    [objects]
  );
  const typeColor = useMemo(
    () => mapTypesToColors(objectTypes, typeColorsOverride),
    [objectTypes, typeColorsOverride]
  );

  const lanesByType = useMemo(() => {
    const map = new Map<string, VariantObject[]>();
    for (const o of objects) {
      if (!map.has(o.type)) map.set(o.type, []);
      map.get(o.type)!.push(o);
    }
    for (const [, arr] of map) arr.sort((a, b) => a.id.localeCompare(b.id));
    return Array.from(map.entries()); // [type, objects[]][]
  }, [objects]);

  const maxCol = useMemo(
    () => Math.max(0, ...Object.values(pos).map((p) => Math.max(p.xStart, p.xEnd))),
    [pos]
  );
  const cols = maxCol + 1;
  const gridTemplateCols = `repeat(${cols}, ${Math.round(colWidth * zoom)}px)`;

  const laneEvents = useMemo(() => {
    const map = new Map<string, PositionedEvent[]>();
    for (const p of Object.values(pos)) for (const oid of p.objectIds) {
      if (!map.has(oid)) map.set(oid, []);
      map.get(oid)!.push({ ...p });
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.xStart - b.xStart);
      for (let i = 0; i < arr.length; i++) {
        const cur = arr[i], prev = arr[i - 1], next = arr[i + 1];
        const prevShared = prev ? prev.objectIds.length > 1 : false;
        const nextShared = next ? next.objectIds.length > 1 : false;
        if (cur.objectIds.length === 1 && prevShared && nextShared && next) {
          const naturalEnd = next.xStart - 1;
          if (naturalEnd >= cur.xStart) cur.xEnd = Math.min(cur.xEnd, naturalEnd);
        }
      }
    }
    return map;
  }, [pos]);

  const supportPct = totalSupport ? (v.support / totalSupport) : 0;
  const closedSummary = useMemo(() => summarizeClosedVariant(v) || "—", [v]);
  const toggleType = (t: string) => setCollapsedTypes(prev => {
    const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n;
  });
  const colsCount = cols;

  // Count only actual lanes (no fake gap rows)
  const visibleRowCount = lanesByType.reduce(
    (acc, [t, objs]) => acc + (collapsedTypes.has(t) ? 1 : objs.length),
    0
  );

  // Compute real canvas height: lanes + small gaps + padding
  const canvasHeight =
    visibleRowCount * laneHeight +
    Math.max(0, visibleRowCount - 1) * ROW_GAP +
    GUTTER;

  return (
    <div style={{ border: `1px solid ${UI.border}`, borderRadius: 8 }}>
      <CardHeader className="py-2">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button
            variant="ghost" size="icon"
            onClick={() => setExpanded(e => !e)}
            title={expanded ? "Collapse variant" : "Expand variant"}
          >
            {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
          </Button>

          {/* support bar */}
          <div
            style={{
              position: "relative", height: 12, width: 160, border: `1px solid ${UI.border}`,
              background: UI.mutedBG, borderRadius: 6, overflow: "hidden"
            }}
            aria-label={`Support: ${v.support} (${(supportPct * 100).toFixed(1)}%)`}
          >
            <div style={{ position: "absolute", inset: "0 0 0 0", width: `${Math.round(supportPct * 100)}%`, background: UI.primary }} />
          </div>
          <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, color: UI.textPrimary }}>
            {v.support}
          </div>

          <div style={{ color: UI.textPrimary }}>
            Variant <span style={{ fontFamily: "ui-monospace, monospace" }}>{String(v.id)}</span>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {expanded ? (
            <div
              style={{
                fontSize: 12, color: UI.textSecondary, maxWidth: 420,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}
              title={v.signature}
            >
              signature: {v.signature}
            </div>
          ) : (
            <div
              style={{
                fontSize: 12, color: UI.textSecondary, maxWidth: 420,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}
              title={closedSummary}
            >
              {closedSummary}
            </div>
          )}

          <Button variant="ghost" size="icon" title="Export (stub)">
            <Download size={16} />
          </Button>
        </div>
          </div>
      </CardHeader>

            {expanded && (
        <CardContent className="pt-0">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
            {/* legend */}
            <div style={{ width: 256, flexShrink: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: UI.textSecondary }}>
                Object types
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {lanesByType.map(([type, objs], index) => {
                  const collapsed = collapsedTypes.has(type);
                  const tColor = typeColor[type];

                  // lanes in this group (respect collapse)
                  const lanes = collapsed ? 1 : objs.length;
                  // height of the group's lanes INCLUDING the internal gaps between those lanes
                  const groupHeight =
                    lanes * laneHeight + Math.max(0, lanes - 1) * ROW_GAP;
                  // one extra gap AFTER the group (except after the last group)
                  const afterGap = index < lanesByType.length - 1 ? ROW_GAP : 0;

                  return (
                    <React.Fragment key={type}>
                      {/* Card matches exactly the group's height */}
                      <div
                        style={{
                          height: groupHeight,
                          border: `1px solid ${UI.border}`,
                          borderRadius: 8,
                          padding: 8,
                          boxSizing: "border-box", // keep padding/border inside height
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            width: "100%",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ height: 12, width: 12, borderRadius: 3, background: tColor }} />
                            <div style={{ fontSize: 14, fontWeight: 600, color: UI.textPrimary }}>{type}</div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleType(type)}
                            title={collapsed ? `Expand ${type} lanes` : `Collapse ${type} lanes`}
                          >
                            {collapsed ? <PlusCircle size={16} /> : <MinusCircle size={16} />}
                          </Button>
                        </div>
                      </div>
                      {/* spacer between groups matches canvas rowGap */}
                      {afterGap > 0 && <div style={{ height: afterGap }} />}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* canvas */}
            <div
              style={{
                position: "relative",
                border: `1px solid ${UI.border}`,
                borderRadius: 8,
                overflow: "auto",
                width: "100%",
                marginTop: 26,
              }}
              aria-label={`Variant ${v.id} visualization`}
            >
              <div style={{ minWidth: "100%", height: canvasHeight }}>
                <div
                  style={{
                    position: "absolute",
                    top: GUTTER,
                    left: GUTTER,
                    right: 0,
                    bottom: 0,
                    display: "grid",
                    gridTemplateColumns: gridTemplateCols,
                    gridAutoRows: `${laneHeight}px`,
                    columnGap: "12px",
                    rowGap: `${ROW_GAP}px`,
                  }}
                >
                  {/* lane lines */}
                  {(() => {
                    const acc: { row: number; els: React.ReactNode[] } = { row: 0, els: [] };
                    for (const [type, objs] of lanesByType) {
                      const collapsed = collapsedTypes.has(type);
                      if (!collapsed) {
                        for (const o of objs) {
                          acc.row += 1;
                          acc.els.push(
                            <div
                              key={`lane-${o.id}`}
                              style={{
                                gridColumn: `1 / span ${colsCount}`,
                                gridRow: `${acc.row}`,
                                borderBottom: `1px dashed ${UI.border}`,
                              }}
                            />
                          );
                        }
                      } else {
                        acc.row += 1;
                        acc.els.push(
                          <div
                            key={`sep-${type}`}
                            style={{
                              gridColumn: `1 / span ${colsCount}`,
                              gridRow: `${acc.row}`,
                              borderBottom: `1px solid ${UI.border}`,
                            }}
                          />
                        );
                      }
                    }
                    return acc.els;
                  })()}

                  {/* events */}
                  {(() => {
                    const acc: { row: number; els: React.ReactNode[] } = { row: 0, els: [] };
                    for (const [type, objs] of lanesByType) {
                      if (collapsedTypes.has(type)) {
                        acc.row += 1;
                        continue;
                      }
                      for (const o of objs) {
                        acc.row += 1;
                        const events = (laneEvents.get(o.id) || [])
                          .slice()
                          .sort((a, b) => a.xStart - b.xStart);
                        for (let i = 0; i < events.length; i++) {
                          const ev = events[i];
                          const colStart = ev.xStart + 1;
                          const span = Math.max(1, ev.xEnd - ev.xStart + 1);
                          const isShared = ev.objectIds.length > 1;
                          const label =
                            labelMode === "compact"
                              ? abbreviateFirstLetters(ev.activity)!
                              : ev.activity;
                          const background = gradientFor(objects, typeColor, ev.objectIds);
                          const title = `${ev.activity}\nEvent: ${ev.id}\nObjects: ${ev.objectIds.join(
                            ", "
                          )}\nPos: [${ev.xStart}..${ev.xEnd}]`;
                          const tipPx = Math.max(
                            12,
                            Math.min(20, Math.round(colWidth * zoom * 0.18))
                          );
                          acc.els.push(
                            <div
                              key={`${o.id}-${ev.id}-${i}`}
                              title={title}
                              style={{
                                gridColumn: `${colStart} / span ${span}`,
                                gridRow: `${acc.row}`,
                                background,
                                color: "#fff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                position: "relative",
                                userSelect: "none",
                                fontSize: 12,
                                clipPath: chevronClip(tipPx),
                                WebkitClipPath: chevronClip(tipPx),
                                overflow: "hidden",
                                paddingRight: tipPx,
                              }}
                              aria-label={`${label} on ${o.id}${isShared ? " (shared)" : ""}`}
                            >
                              {isShared && (
                                <div
                                  aria-hidden
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    opacity: 0.25,
                                    backgroundImage:
                                      "repeating-linear-gradient(45deg, #000 0 2px, transparent 2px 6px)",
                                    clipPath: chevronClip(tipPx),
                                    WebkitClipPath: chevronClip(tipPx),
                                  }}
                                />
                              )}
                              <span
                                style={{
                                  padding: "2px 8px",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {label}
                              </span>
                              {isShared && (
                                <div
                                  style={{
                                    position: "absolute",
                                    right: Math.max(4, Math.round(tipPx * 0.8)),
                                    top: 4,
                                    fontSize: 10,
                                    opacity: 0.8,
                                  }}
                                  aria-hidden
                                >
                                  ⇄
                                </div>
                              )}
                            </div>
                          );
                        }
                      }
                    }
                    return acc.els;
                  })()}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </div>
  );
}

function gradientFor(
  objects: VariantObject[],
  typeColor: Record<string, string>,
  objectIds: string[]
): string {
  const colors = objectIds.map((oid) => {
    const obj = objects.find((o) => o.id === oid);
    const base = obj ? typeColor[obj.type] : UI.textSecondary;
    const siblings = objects.filter((o) => o.type === (obj ? obj.type : ""));
    const idx = obj ? siblings.findIndex((o) => o.id === oid) : 0;
    return shade(base, 0.15 * (idx % 5));
  });
  if (colors.length <= 1) return colors[0] || UI.textSecondary;
  const step = 100 / (colors.length - 1);
  return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${i * step}%`).join(", ")})`;
}

