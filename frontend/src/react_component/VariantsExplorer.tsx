import { useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, ZoomIn, ZoomOut, Search,
  MinusCircle, PlusCircle
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* =========================
   Types shared with callers
   ========================= */
export type VariantObject = {
  id: string;
  type: string;
  label?: string;
};

// MODIFIED: Added new properties from the backend layout calculation
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

/* ========== shapes ========== */
/** Returns a CSS polygon that clips a rectangle into a chevron.
 * tipPx controls how pointy the right tip is (12–20 looks good). */
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
  leadingType?: string;
  availableTypes?: string[];
  onLeadingTypeChange?: (type: string) => void;
  typeColors?: Record<string, string>;
  colWidth?: number;
};

export default function VariantsExplorer({
  variants,
  leadingType = "",
  availableTypes = [],
  onLeadingTypeChange,
  typeColors,
  colWidth = 120,
}: VariantsExplorerProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [labelMode, setLabelMode] = useState<"compact" | "full">("compact");
  const [query, setQuery] = useState<string>("");

  const totalSupport = useMemo(() => variants.reduce((s, v) => s + v.support, 0), [variants]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variants
      .filter((v) => q ? (String(v.id).toLowerCase().includes(q) || v.signature.toLowerCase().includes(q)) : true)
      .sort((a, b) => b.support - a.support);
  }, [variants, query]);

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          {onLeadingTypeChange ? (
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">Perspective:</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="min-w-[150px] justify-between">
                    {leadingType}
                    <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[200px]">
                  <DropdownMenuLabel>Select Object Type</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={leadingType} onValueChange={onLeadingTypeChange}>
                    {availableTypes.length > 0 ? (
                      availableTypes.map((type) => (
                        <DropdownMenuRadioItem key={type} value={type}>
                          {type}
                        </DropdownMenuRadioItem>
                      ))
                    ) : (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading types...</div>
                    )}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="text-lg font-semibold">Object-Centric Variants</div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Zoom */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ZoomOut size={16} className="text-muted-foreground" />
              <Slider
                value={[zoom]}
                min={0.5}
                max={2}
                step={0.1}
                onValueChange={(v) => setZoom(v[0])}
                className="w-40"
              />
              <ZoomIn size={16} className="text-muted-foreground" />
            </div>

            {/* Label mode toggle - Switch */}
            <div className="flex items-center gap-2">
              <Label htmlFor="label-mode" className="text-sm font-medium">
                Compact Labels
              </Label>
              <Switch
                id="label-mode"
                checked={labelMode === "compact"}
                onCheckedChange={(checked) => setLabelMode(checked ? "compact" : "full")}
              />
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filter by id or signature…"
                className="pl-9 w-[260px]"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter variants"
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
  colWidth: number;
  typeColorsOverride?: Record<string, string>;
};

function VariantRow({
  v, totalSupport, zoom, labelMode, colWidth, typeColorsOverride
}: VariantRowProps) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());

  const GUTTER = 16;

  // MODIFIED: This now creates a compatible 'pos' object from the pre-calculated node data.
  const pos = useMemo(() => {
    const positionedEvents: Record<string, PositionedEvent> = {};
    for (const node of v.graph.nodes) {
      positionedEvents[node.id] = {
        id: node.id,
        activity: node.activity,
        objectIds: node.objectIds,
        xStart: node.x,
        // Set end to start for a consistent 1-column width. This could be enhanced later.
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
  const toggleType = (t: string) => setCollapsedTypes(prev => {
    const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n;
  });

  // Each type gets exactly one lane, regardless of how many objects it has
  const visibleRowCount = lanesByType.length;
  // Fixed height for each type lane to match legend boxes
  const typeLaneHeight = 48;

  return (
    <div style={{ border: `1px solid ${UI.border}`, borderRadius: 8 }}>
      <CardHeader className="py-2">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button
            variant="ghost"
            size="icon"
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

          <div style={{ color: UI.textPrimary, fontFamily: "ui-monospace, monospace", marginLeft: 42 }}>
            {String(v.id)}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                fontSize: 12, color: UI.textSecondary, maxWidth: 350,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}
              title={v.signature}
            >
              signature: {v.signature}
            </div>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 pb-6">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
            {/* legend */}
            <div style={{ width: 256, flexShrink: 0 }}>
              <div
                style={{
                  border: `1px solid ${UI.border}`,
                  borderRadius: 8,
                  height: visibleRowCount * typeLaneHeight + (visibleRowCount - 1) * 12 + 32,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16, paddingBottom: 16, paddingLeft: 16, paddingRight: 16 }}>
                  {lanesByType.map(([type]) => {
                    const collapsed = collapsedTypes.has(type);
                    const tColor = typeColor[type];
                    return (
                      <div
                        key={type}
                        style={{
                          border: `1px solid ${UI.border}`,
                          borderRadius: 8,
                          padding: 8,
                          height: `${typeLaneHeight}px`,
                          display: "flex",
                          alignItems: "center"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{
                              height: 12,
                              width: 12,
                              borderRadius: 3,
                              background: collapsed ? UI.textSecondary : tColor,
                              opacity: collapsed ? 0.5 : 1
                            }} />
                            <div style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: collapsed ? UI.textSecondary : UI.textPrimary,
                              opacity: collapsed ? 0.5 : 1
                            }}>
                              {type}
                            </div>
                          </div>
                          <Button
                            size="sm" variant="ghost" onClick={() => toggleType(type)}
                            title={collapsed ? `Expand ${type} lanes` : `Collapse ${type} lanes`}
                          >
                            {collapsed ? <PlusCircle size={16} /> : <MinusCircle size={16} />}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
              }}
              aria-label={`Variant ${v.id} visualization`}
            >
              <div style={{ minWidth: "100%", height: visibleRowCount * typeLaneHeight + (visibleRowCount - 1) * 12 + 32, paddingTop: 16, paddingBottom: 16 }}>
                <div
                  style={{
                    position: "absolute",
                    top: 16,
                    left: GUTTER,
                    right: 0,
                    bottom: 16,
                    display: "grid",
                    gridTemplateColumns: gridTemplateCols,
                    gridAutoRows: `${typeLaneHeight}px`,
                    columnGap: "12px",
                    rowGap: "12px",
                  }}
                >
                  {/* events - all events for each type in one lane */}
                  {lanesByType.map(([type, objs], typeIdx) => {
                    if (collapsedTypes.has(type)) return null;

                    // Collect all events for this type from all objects
                    const allTypeEvents: PositionedEvent[] = [];
                    for (const o of objs) {
                      const events = laneEvents.get(o.id) || [];
                      allTypeEvents.push(...events);
                    }

                    // Sort by position and remove duplicates (same event on multiple objects)
                    const uniqueEvents = allTypeEvents
                      .filter((ev, idx, arr) => arr.findIndex(e => e.id === ev.id) === idx)
                      .sort((a, b) => a.xStart - b.xStart);

                    return uniqueEvents.map((ev, i) => {
                      const colStart = ev.xStart + 1;
                      const span = Math.max(1, ev.xEnd - ev.xStart + 1);
                      const isShared = ev.objectIds.length > 1;
                      const label = labelMode === "compact" ? abbreviateFirstLetters(ev.activity)! : ev.activity;
                      const background = gradientFor(objects, typeColor, ev.objectIds);
                      const title = `${ev.activity}\nEvent: ${ev.id}\nObjects: ${ev.objectIds.join(", ")}\nPos: [${ev.xStart}..${ev.xEnd}]`;
                      const tipPx = Math.max(12, Math.min(20, Math.round(colWidth * zoom * 0.18)));

                      return (
                        <div
                          key={`${type}-${ev.id}-${i}`}
                          title={title}
                          style={{
                            gridColumn: `${colStart} / span ${span}`,
                            gridRow: `${typeIdx + 1}`,
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
                          aria-label={`${label} (${type})${isShared ? " (shared)" : ""}`}
                        >
                          {isShared && (
                            <div
                              aria-hidden
                              style={{
                                position: "absolute",
                                inset: 0,
                                opacity: 0.25,
                                backgroundImage: "repeating-linear-gradient(45deg, #000 0 2px, transparent 2px 6px)",
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
                    });
                  })}
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
