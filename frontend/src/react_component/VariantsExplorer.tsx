import { useEffect, useMemo, useRef, useState } from "react";
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
  fileId?: number;                                // Event log file ID
  automaticLoading?: boolean;                     // Auto-load variants (default: false)
  onVariantsLoad?: (variants: Variant[]) => void; // Optional callback when variants load
  typeColors?: Record<string, string>;            // UI customization
  colWidth?: number;                              // Column width (default: 120)
  embedded?: boolean;                             // When true, removes outer Card wrapper
  defaultLeadingType?: string;                    // Pre-select this type if provided and valid
};

export default function VariantsExplorer({
  fileId,
  automaticLoading = false,
  onVariantsLoad,
  typeColors,
  colWidth = 120,
  embedded = false,
  defaultLeadingType,
}: VariantsExplorerProps) {
  // Component state
  const [variants, setVariants] = useState<Variant[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [leadingType, setLeadingType] = useState<string>("");
  const [hasStartedLoading, setHasStartedLoading] = useState<boolean>(false);

  // UI state
  const [zoom, setZoom] = useState<number>(1);
  const [labelMode, setLabelMode] = useState<"compact" | "full">("compact");
  const [query, setQuery] = useState<string>("");

  // Track current fileId to detect stale closures
  const fileIdRef = useRef<number | undefined>(fileId);

  // Update ref whenever fileId changes
  useEffect(() => {
    fileIdRef.current = fileId;
  }, [fileId]);

  const totalSupport = useMemo(() => variants.reduce((s, v) => s + v.support, 0), [variants]);

  // Fetch object types when fileId changes
  useEffect(() => {
    if (!fileId) {
      setAvailableTypes([]);
      setLeadingType("");
      setHasStartedLoading(false);
      setStatus("idle");
      setVariants([]);
      setErrorMsg("");
      return;
    }

    // SYNCHRONOUS state reset BEFORE async work
    setHasStartedLoading(false);  // Reset loading flag immediately
    setStatus("idle");            // Reset status immediately
    setLeadingType("");           // Clear old leading type immediately
    setVariants([]);              // Clear old variants immediately
    setErrorMsg("");              // Clear old errors immediately

    const currentFileId = fileId;  // Capture fileId in closure
    let cancelled = false;

    (async () => {
      try {
        // Check if we're still on the same file before proceeding
        if (fileIdRef.current !== currentFileId) {
          return;  // File changed, abort this stale closure
        }

        const token = localStorage.getItem("access_token");
        if (!token) {
          throw new Error("Not authenticated");
        }

        const url = `/api/files/${currentFileId}/object_types/`;
        const res = await fetch(url, {
          credentials: "include",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        if (res.status === 401) {
          throw new Error("UNAUTHORIZED");
        }

        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

        const objectTypes: string[] = await res.json();

        // Check again after async operation
        if (fileIdRef.current !== currentFileId) {
          return;  // File changed during fetch, abort
        }

        if (!cancelled && Array.isArray(objectTypes) && objectTypes.length > 0) {
          setAvailableTypes(objectTypes);

          // Use defaultLeadingType if provided and valid, otherwise auto-select first type alphabetically
          if (defaultLeadingType && objectTypes.includes(defaultLeadingType)) {
            setLeadingType(defaultLeadingType);
          } else {
            const sortedTypes = [...objectTypes].sort();
            setLeadingType(sortedTypes[0]);
          }
        }
      } catch (e: any) {
        // Check again before setting error
        if (fileIdRef.current !== currentFileId) {
          return;  // File changed, don't show error from old file
        }

        if (!cancelled) {
          console.error("Failed to load object types:", e);
          setErrorMsg(e?.message || "Failed to load object types");
          setStatus("error");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [fileId]);

  // Fetch variants when fileId or leadingType changes
  useEffect(() => {
    if (!fileId) {
      setVariants([]);
      setStatus("idle");
      setErrorMsg("");
      return;
    }

    // Wait for object types to be loaded and leadingType to be selected
    if (!leadingType) {
      return;
    }

    // Only fetch if automaticLoading is true OR user has manually started loading
    if (!automaticLoading && !hasStartedLoading) {
      return;
    }

    const currentFileId = fileId;  // Capture fileId in closure
    const currentLeadingType = leadingType;  // Capture leadingType in closure
    let cancelled = false;

    (async () => {
      // CRITICAL: Check if we're still on the same file before setting status="loading"
      if (fileIdRef.current !== currentFileId) {
        return;  // File changed, abort this stale closure
      }

      const qs = `?file_id=${currentFileId}&leading_type=${encodeURIComponent(currentLeadingType)}`;

      setStatus("loading");
      setErrorMsg("");

      try {
        const token = localStorage.getItem("access_token");
        if (!token) {
          throw new Error("Not authenticated");
        }

        const url = `/api/variants/${qs}`;
        const res = await fetch(url, {
          credentials: "include",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        if (res.status === 401) {
          throw new Error("UNAUTHORIZED");
        }

        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const text = await res.text();
          throw new Error(`Expected JSON, got: ${text.slice(0, 120)}…`);
        }

        const data = await res.json();
        const arr: Variant[] = Array.isArray(data) ? data : data.variants;

        // Check again after async operation
        if (fileIdRef.current !== currentFileId) {
          return;  // File changed during fetch, abort
        }

        if (!cancelled) {
          setVariants(arr ?? []);
          {console.log(arr)}
          setStatus(arr && arr.length ? "ready" : "empty");
          onVariantsLoad?.(arr ?? []);
        }
      } catch (e: any) {
        // Check again before setting error
        if (fileIdRef.current !== currentFileId) {
          return;  // File changed, don't show error from old file
        }

        if (!cancelled) {
          setStatus("error");
          setErrorMsg(e?.message || "Unknown error while loading variants.");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [leadingType, automaticLoading, hasStartedLoading, onVariantsLoad]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variants
      .filter((v) => q ? (String(v.id).toLowerCase().includes(q) || v.signature.toLowerCase().includes(q)) : true)
      .sort((a, b) => b.support - a.support);
  }, [variants, query]);

  //console.log("Status: " + status + " automaticLoading: " + automaticLoading + " hasStartedLoading: " + hasStartedLoading);

  const Wrapper = embedded ? 'div' : Card;

  return (
    <Wrapper className="w-full">
      <CardHeader className="pb-2">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">Perspective:</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-w-[150px] justify-between">
                  {leadingType || "Select type"}
                  <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[200px]">
                <DropdownMenuLabel>Select Object Type</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={leadingType} onValueChange={setLeadingType}>
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

      {/* Idle state - no file selected */}
      {status === "idle" && !fileId && (
        <CardContent className="pt-2">
          <div className="text-sm text-muted-foreground">
            Select a file to view variants
          </div>
        </CardContent>
      )}

      {/* Manual loading state - waiting for user to start */}
      {!automaticLoading && !hasStartedLoading && fileId && leadingType && status === "idle" && (
        <CardContent className="pt-2">
          <div className="flex flex-col gap-3 items-center py-4">
            <div className="text-sm text-muted-foreground text-center">
              Variant computation can take some time for large event logs.
              <br />
              Click below when ready to start the analysis.
            </div>
            <Button
              onClick={() => setHasStartedLoading(true)}
              className="min-w-[200px]"
            >
              Start Variant Computation
            </Button>
          </div>
        </CardContent>
      )}

      {/* Loading state */}
      {status === "loading" && (
        <CardContent className="pt-2">
          <div className="flex items-center gap-2">
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
            <span className="text-sm">Loading variants...</span>
          </div>
        </CardContent>
      )}

      {/* Error state */}
      {status === "error" && (
        <CardContent className="pt-2">
          <div className="flex flex-col gap-2">
            <div className="text-sm text-red-600 font-semibold">
              Failed to load variants
            </div>
            {errorMsg && (
              <div className="text-xs text-red-500">{errorMsg}</div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLeadingType("")}
              className="w-fit"
            >
              Retry
            </Button>
          </div>
        </CardContent>
      )}

      {/* Empty state */}
      {status === "empty" && (
        <CardContent className="pt-2">
          <div className="text-sm text-muted-foreground">
            No variants found for this file
          </div>
        </CardContent>
      )}

      {/* Ready state - show variants */}
      {status === "ready" && (
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
      )}
    </Wrapper>
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

  // Create ordered list of lanes (one per object, preserving backend's lane order)
  const lanes = useMemo(() => {
    return objects.map((obj, idx) => ({
      index: idx,
      object: obj,
      type: obj.type,
    }));
  }, [objects]);

  // Group lanes by type for legend display (preserves order, tracks lane count per type)
  const typeGroups = useMemo(() => {
    const groups: { type: string; laneCount: number; startIndex: number }[] = [];
    let currentType = '';
    let count = 0;
    let startIndex = 0;
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      if (lane.type !== currentType) {
        if (currentType) groups.push({ type: currentType, laneCount: count, startIndex });
        currentType = lane.type;
        count = 1;
        startIndex = i;
      } else {
        count++;
      }
    }
    if (currentType) groups.push({ type: currentType, laneCount: count, startIndex });
    return groups;
  }, [lanes]);

  const maxCol = useMemo(
    () => Math.max(0, ...Object.values(pos).map((p) => Math.max(p.xStart, p.xEnd))),
    [pos]
  );
  const cols = maxCol + 1;
  const gridTemplateCols = `repeat(${cols}, ${Math.round(colWidth * zoom)}px)`;

  // Map lane index -> events in that lane (using y_lanes from node data)
  const laneEvents = useMemo(() => {
    const map = new Map<number, PositionedEvent[]>();
    for (const node of v.graph.nodes) {
      for (const laneIdx of node.y_lanes) {
        if (!map.has(laneIdx)) map.set(laneIdx, []);
        map.get(laneIdx)!.push({
          id: node.id,
          activity: node.activity,
          objectIds: node.objectIds,
          xStart: node.x,
          xEnd: node.x,
        });
      }
    }
    // Sort events in each lane by x position
    for (const [, arr] of map) {
      arr.sort((a, b) => a.xStart - b.xStart);
    }
    return map;
  }, [v.graph.nodes]);

  const supportPct = totalSupport ? (v.support / totalSupport) : 0;
  const toggleType = (t: string) => setCollapsedTypes(prev => {
    const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n;
  });

  // Fixed height for each type lane to match legend boxes
  const typeLaneHeight = 48;

  // Calculate legend height based on actual type groups (including collapsed ones)
  const legendHeight = useMemo(() => {
    let height = 32; // padding (16 top + 16 bottom)
    typeGroups.forEach(({ type, laneCount }, idx) => {
      const collapsed = collapsedTypes.has(type);
      height += collapsed ? typeLaneHeight : laneCount * typeLaneHeight + (laneCount - 1) * 12;
      if (idx < typeGroups.length - 1) height += 12; // gap between groups
    });
    return height;
  }, [typeGroups, collapsedTypes, typeLaneHeight]);

  // Calculate the grid row for a lane, accounting for collapsed type groups
  const getRowForLane = (laneIdx: number): number => {
    const lane = lanes[laneIdx];
    let row = 1;

    for (const group of typeGroups) {
      if (group.type === lane.type) {
        // Found our type group - add position within group
        const posInGroup = laneIdx - group.startIndex;
        return row + posInGroup;
      }
      // Add rows for this type group
      const collapsed = collapsedTypes.has(group.type);
      row += collapsed ? 1 : group.laneCount;
    }
    return row;
  };


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
                  height: legendHeight,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16, paddingBottom: 16, paddingLeft: 16, paddingRight: 16 }}>
                  {typeGroups.map(({ type, laneCount }) => {
                    const collapsed = collapsedTypes.has(type);
                    const tColor = typeColor[type];
                    // Height matches the lanes in the grid: laneCount * laneHeight + (laneCount - 1) * gap
                    const groupHeight = collapsed
                      ? typeLaneHeight
                      : laneCount * typeLaneHeight + (laneCount - 1) * 12;
                    return (
                      <div
                        key={type}
                        style={{
                          border: `1px solid ${UI.border}`,
                          borderRadius: 8,
                          padding: 8,
                          height: `${groupHeight}px`,
                          display: "flex",
                          alignItems: collapsed ? "center" : "flex-start"
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
                              {type} {laneCount > 1 && `(${laneCount})`}
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
              <div style={{ minWidth: "100%", height: legendHeight, paddingTop: 16, paddingBottom: 16 }}>
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
                  {/* events - one lane per object instance */}
                  {lanes.map((lane, laneIdx) => {
                    if (collapsedTypes.has(lane.type)) return null;

                    // Get events for this specific lane
                    const events = laneEvents.get(lane.index) || [];

                    // Calculate grid row accounting for collapsed type groups
                    const gridRow = getRowForLane(laneIdx);

                    return events.map((ev, i) => {
                      const colStart = ev.xStart + 1;
                      const span = Math.max(1, ev.xEnd - ev.xStart + 1);
                      const isShared = ev.objectIds.length > 1;
                      const label = labelMode === "compact" ? abbreviateFirstLetters(ev.activity)! : ev.activity;
                      const background = gradientFor(objects, typeColor, ev.objectIds);
                      const title = `${ev.activity}\nEvent: ${ev.id}\nObjects: ${ev.objectIds.join(", ")}\nLane: ${lane.index} (${lane.type})\nPos: [${ev.xStart}..${ev.xEnd}]`;
                      const tipPx = Math.max(12, Math.min(20, Math.round(colWidth * zoom * 0.18)));

                      return (
                        <div
                          key={`lane-${lane.index}-${ev.id}-${i}`}
                          title={title}
                          style={{
                            gridColumn: `${colStart} / span ${span}`,
                            gridRow: `${gridRow}`,
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
                            paddingLeft: tipPx,
                            paddingRight: tipPx,
                          }}
                          aria-label={`${label} (${lane.type})${isShared ? " (shared)" : ""}`}
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
                                zIndex: 0,
                              }}
                            />
                          )}

                          <span
                            style={{
                              padding: "2px 8px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              position: "relative",
                              zIndex: 1,
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
    // Extract type from objectId (format: "type::item" -> "item")
    const typeFromId = oid.startsWith("type::") ? oid.slice(6) : oid;
    // Find object by type instead of ID (IDs may have different formats)
    const obj = objects.find((o) => o.type === typeFromId);
    const base = obj ? typeColor[obj.type] : UI.textSecondary;
    const siblings = objects.filter((o) => o.type === typeFromId);
    const idx = siblings.length > 0 ? 0 : 0; // Use first sibling's shade
    return shade(base, 0.15 * (idx % 5));
  });
  if (colors.length <= 1) return colors[0] || UI.textSecondary;
  const step = 100 / (colors.length - 1);
  return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${i * step}%`).join(", ")})`;
}
