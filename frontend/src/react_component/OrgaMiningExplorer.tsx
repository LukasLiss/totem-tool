import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { mapTypesToColors } from "@/utils/objectColors";

/* ── Types ─────────────────────────────────────────────────── */
type RAMData = {
  resources: string[];
  activities: string[];
  values: number[][];
  resource_object_types: Record<string, string>;
};

type OrgaMiningExplorerProps = {
  fileId?: number;
  embedded?: boolean;
};

type ViewMode = "table" | "graph";

const NODE_R = 8;

/* ── Classical MDS ──────────────────────────────────────────── */
// Projects n points from high-dimensional space to 2D preserving pairwise distances.
function classicalMDS(vectors: number[][]): { x: number; y: number }[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];

  // Squared euclidean distance matrix
  const D2: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let d = 0;
      for (let k = 0; k < vectors[i].length; k++) d += (vectors[i][k] - vectors[j][k]) ** 2;
      return d;
    })
  );

  // Double-center: B = -0.5 * H * D2 * H,  H = I - (1/n) * 11'
  const rowMeans = D2.map(row => row.reduce((s, v) => s + v, 0) / n);
  const totalMean = rowMeans.reduce((s, v) => s + v, 0) / n;
  const B: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      -0.5 * (D2[i][j] - rowMeans[i] - rowMeans[j] + totalMean)
    )
  );

  // Power iteration for the top 2 eigenvectors of B
  const matVec = (M: number[][], v: number[]) =>
    M.map(row => row.reduce((s, m, k) => s + m * v[k], 0));

  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

  const powerIter = (M: number[][], seed: number[]) => {
    let v = seed.map((_, i) => i === 0 ? 1 : Math.sin(i));
    const n2 = norm(v); v = v.map(x => x / n2);
    for (let iter = 0; iter < 200; iter++) {
      const w = matVec(M, v);
      const wn = norm(w);
      if (wn < 1e-12) break;
      v = w.map(x => x / wn);
    }
    const lambda = v.reduce((s, vi, i) => s + vi * matVec(M, v)[i], 0);
    return { lambda, v };
  };

  // First eigenvector
  const { lambda: l1, v: v1 } = powerIter(B, Array.from({ length: n }, (_, i) => i + 1));

  // Deflate and get second eigenvector
  const B2: number[][] = B.map((row, i) =>
    row.map((b, j) => b - l1 * v1[i] * v1[j])
  );
  const { lambda: l2, v: v2 } = powerIter(B2, Array.from({ length: n }, (_, i) => Math.cos(i + 1)));

  const s1 = Math.sqrt(Math.max(0, l1));
  const s2 = Math.sqrt(Math.max(0, l2));

  return v1.map((_, i) => ({ x: v1[i] * s1, y: v2[i] * s2 }));
}

/* ── Main component ─────────────────────────────────────────── */
export default function OrgaMiningExplorer({
  fileId,
  embedded = false,
}: OrgaMiningExplorerProps) {
  const [objectTypes, setObjectTypes] = useState<string[]>([]);
  const [resourceTypes, setResourceTypes] = useState<Set<string>>(new Set());
  const [data, setData] = useState<RAMData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [hasStartedLoading, setHasStartedLoading] = useState(false);
  const hasStartedLoadingRef = useRef(false);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const viewModeRef = useRef(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  const fileIdRef = useRef<number | undefined>(fileId);
  useEffect(() => { fileIdRef.current = fileId; }, [fileId]);

  // Load object types when fileId changes
  useEffect(() => {
    if (!fileId) {
      setObjectTypes([]);
      setResourceTypes(new Set());
      setData(null);
      setStatus("idle");
      hasStartedLoadingRef.current = false;
      setHasStartedLoading(false);
      return;
    }

    setObjectTypes([]);
    setResourceTypes(new Set());
    setData(null);
    setStatus("idle");
    hasStartedLoadingRef.current = false;
    setHasStartedLoading(false);

    const currentFileId = fileId;
    let cancelled = false;

    (async () => {
      if (fileIdRef.current !== currentFileId) return;
      const token = localStorage.getItem("access_token");
      if (!token) { setStatus("error"); setErrorMsg("Not authenticated"); return; }
      try {
        const res = await fetch(`/api/files/${currentFileId}/object_types/`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (fileIdRef.current !== currentFileId || cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const types: string[] = await res.json();
        if (fileIdRef.current !== currentFileId || cancelled) return;
        setObjectTypes(types);
      } catch (e: any) {
        if (fileIdRef.current !== currentFileId || cancelled) return;
        setStatus("error");
        setErrorMsg(e?.message || "Failed to load object types");
      }
    })();

    return () => { cancelled = true; };
  }, [fileId]);

  // Compute matrix when triggered
  useEffect(() => {
    if (!fileId || !hasStartedLoadingRef.current) return;

    const currentFileId = fileId;
    const params: Record<string, string> = { file_id: String(currentFileId) };
    if (resourceTypes.size > 0) params.resource_types = [...resourceTypes].join(",");

    let cancelled = false;

    (async () => {
      if (fileIdRef.current !== currentFileId) return;
      setStatus("loading");
      setErrorMsg("");

      const token = localStorage.getItem("access_token");
      if (!token) { setStatus("error"); setErrorMsg("Not authenticated"); return; }

      try {
        const res = await fetch(`/api/resource-activity-matrix/?${new URLSearchParams(params)}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (fileIdRef.current !== currentFileId || cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const result: RAMData = await res.json();
        if (fileIdRef.current !== currentFileId || cancelled) return;
        setData(result);
        setStatus("ready");
      } catch (e: any) {
        if (fileIdRef.current !== currentFileId || cancelled) return;
        setStatus("error");
        setErrorMsg(e?.message || "Computation failed");
      }
    })();

    return () => { cancelled = true; };
  }, [fileId, hasStartedLoading]);

  // Lock height after graph loads
  useEffect(() => {
    if (status !== "ready" || lockedHeight !== null) return;
    const id = setTimeout(() => {
      if (viewModeRef.current !== "graph") return;
      const h = resultsRef.current?.offsetHeight;
      if (h && h > 0) setLockedHeight(h);
    }, 50);
    return () => clearTimeout(id);
  }, [status, lockedHeight]);

  useEffect(() => { setLockedHeight(null); }, [data]);

  const handleCompute = () => {
    hasStartedLoadingRef.current = false;
    setHasStartedLoading(false);
    setTimeout(() => { hasStartedLoadingRef.current = true; setHasStartedLoading(true); }, 0);
  };

  const toggleResourceType = (t: string) =>
    setResourceTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const typeColorMap = useMemo(() => mapTypesToColors(objectTypes), [objectTypes]);

  const Wrapper = embedded ? "div" : Card;

  return (
    <Wrapper className="w-full">
      {!embedded && (
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Resource-Activity Matrix</CardTitle>
        </CardHeader>
      )}

      <CardContent className="space-y-4">
        {!fileId && (
          <p className="text-sm text-muted-foreground">Select a file to start.</p>
        )}

        {fileId && objectTypes.length > 0 && (
          <div className="flex gap-4 flex-wrap items-start">
            <TypeSelector
              title="Resource types"
              types={objectTypes}
              selected={resourceTypes}
              onToggle={toggleResourceType}
              colorMap={typeColorMap}
            />
          </div>
        )}

        {fileId && objectTypes.length > 0 && (
          <div className="flex flex-col gap-3 items-center py-4">
            <div className="text-sm text-muted-foreground text-center">
              Click below when ready to start the computation.
            </div>
            <Button
              onClick={handleCompute}
              disabled={status === "loading" || resourceTypes.size === 0}
              className="min-w-[200px]"
            >
              {status === "loading" ? "Computing…" : "Compute Matrix"}
            </Button>
            {status === "loading" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                Computing resource-activity matrix…
              </div>
            )}
          </div>
        )}

        {status === "error" && (
          <div className="text-sm text-destructive">Error: {errorMsg}</div>
        )}

        {status === "ready" && data && (
          <>
            <div className="flex gap-2">
              <Button size="sm" variant={viewMode === "graph" ? "default" : "outline"} onClick={() => setViewMode("graph")}>
                Graph
              </Button>
              <Button size="sm" variant={viewMode === "table" ? "default" : "outline"} onClick={() => setViewMode("table")}>
                Table
              </Button>
            </div>

            <div ref={resultsRef} style={lockedHeight ? { height: lockedHeight, overflow: "hidden" } : undefined}>
              {viewMode === "graph" && (
                <ResourceGraph data={data} typeColorMap={typeColorMap} />
              )}

              {viewMode === "table" && (
                <div
                  className="overflow-auto rounded-md border"
                  style={lockedHeight ? { maxHeight: lockedHeight } : undefined}
                >
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b bg-muted">
                        <th className="px-3 py-2 text-left font-medium sticky left-0 bg-muted z-20 border-r whitespace-nowrap">
                          Resource
                        </th>
                        {data.activities.map(act => (
                          <th key={act} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                            {act}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.resources.map((resource, ri) => (
                        <tr key={ri} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2 font-mono font-medium sticky left-0 bg-background border-r whitespace-nowrap z-10">
                            {resource}
                          </td>
                          {data.values[ri].map((val, ai) => (
                            <td key={ai} className="px-3 py-2 tabular-nums text-right">
                              {val === 0 ? (
                                <span className="text-muted-foreground">0</span>
                              ) : (
                                val.toFixed(3)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Wrapper>
  );
}

type NodeGroup = {
  key: string;
  resources: string[];
  profile: number[];
  typeCounts: { objType: string; count: number }[];
};

/* ── PieNode ────────────────────────────────────────────────── */
function pieSlicePath(r: number, startAngle: number, endAngle: number): string {
  const x1 = r * Math.cos(startAngle), y1 = r * Math.sin(startAngle);
  const x2 = r * Math.cos(endAngle),   y2 = r * Math.sin(endAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M 0 0 L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

function PieNode({ r, strokeWidth, typeCounts, colorMap }: {
  r: number;
  strokeWidth: number;
  typeCounts: { objType: string; count: number }[];
  colorMap: Record<string, string>;
}) {
  const total = typeCounts.reduce((s, t) => s + t.count, 0);
  if (typeCounts.length === 1) {
    return <circle r={r} fill={colorMap[typeCounts[0].objType] ?? "#94a3b8"} stroke="white" strokeWidth={strokeWidth} />;
  }
  let angle = -Math.PI / 2;
  return (
    <>
      {typeCounts.map(({ objType, count }) => {
        const sweep = (count / total) * 2 * Math.PI;
        const path = pieSlicePath(r, angle, angle + sweep);
        angle += sweep;
        return <path key={objType} d={path} fill={colorMap[objType] ?? "#94a3b8"} stroke="white" strokeWidth={strokeWidth} />;
      })}
    </>
  );
}

/* ── ResourceGraph ──────────────────────────────────────────── */
type ZoomedView = { x: number; y: number; w: number; h: number };

function ResourceGraph({
  data,
  typeColorMap,
}: {
  data: RAMData;
  typeColorMap: Record<string, string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rbRef = useRef<SVGRectElement>(null);
  const [size, setSize] = useState({ width: 700, height: 450 });
  const [zoomed, setZoomed] = useState<ZoomedView | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; resources: string[] } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.getBoundingClientRect().width || 700;
    setSize({ width: w, height: Math.max(400, w * 0.62) });
  }, []);

  // Convert screen coords → SVG user coords using the current full-canvas mapping.
  // When not zoomed viewBox == full canvas, so this is always a simple linear map.
  const toUser = (clientX: number, clientY: number, vb: ZoomedView) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width  * vb.w + vb.x,
      y: (clientY - rect.top)  / rect.height * vb.h + vb.y,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomed || e.button !== 0) return;
    const vb = { x: 0, y: 0, w: size.width, h: size.height };
    const { x, y } = toUser(e.clientX, e.clientY, vb);
    dragStart.current = { x, y };
    const el = rbRef.current;
    if (el) { el.setAttribute("x", String(x)); el.setAttribute("y", String(y)); el.setAttribute("width", "0"); el.setAttribute("height", "0"); el.setAttribute("display", "block"); }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const vb = { x: 0, y: 0, w: size.width, h: size.height };
    const { x, y } = toUser(e.clientX, e.clientY, vb);
    const rx = Math.min(dragStart.current.x, x), ry = Math.min(dragStart.current.y, y);
    const rw = Math.abs(x - dragStart.current.x), rh = Math.abs(y - dragStart.current.y);
    const el = rbRef.current;
    if (el) { el.setAttribute("x", String(rx)); el.setAttribute("y", String(ry)); el.setAttribute("width", String(rw)); el.setAttribute("height", String(rh)); }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const vb = { x: 0, y: 0, w: size.width, h: size.height };
    const { x, y } = toUser(e.clientX, e.clientY, vb);
    const x0 = dragStart.current.x, y0 = dragStart.current.y;
    dragStart.current = null;
    rbRef.current?.setAttribute("display", "none");
    const rw = Math.abs(x - x0), rh = Math.abs(y - y0);
    if (rw < 10 || rh < 10) return;
    setZoomed({ x: Math.min(x0, x), y: Math.min(y0, y), w: rw, h: rh });
  };

  // Group resources with identical profiles into one node
  const groups = useMemo<NodeGroup[]>(() => {
    const map = new Map<string, NodeGroup>();
    data.resources.forEach((resource, i) => {
      const key = JSON.stringify(data.values[i]);
      const objType = data.resource_object_types[resource] ?? "";
      if (map.has(key)) {
        const group = map.get(key)!;
        group.resources.push(resource);
        const existing = group.typeCounts.find(t => t.objType === objType);
        if (existing) existing.count++;
        else group.typeCounts.push({ objType, count: 1 });
      } else {
        map.set(key, {
          key,
          resources: [resource],
          profile: data.values[i],
          typeCounts: [{ objType, count: 1 }],
        });
      }
    });
    return [...map.values()];
  }, [data]);

  // MDS on unique group profiles, scaled to fit the SVG canvas
  const positions = useMemo(() => {
    const { width, height } = size;
    const pts = classicalMDS(groups.map(g => g.profile));
    if (pts.length === 0) return [];

    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    const pad = NODE_R + 30;
    return pts.map(p => ({
      x: pad + ((p.x - minX) / rangeX) * (width - 2 * pad),
      y: pad + ((p.y - minY) / rangeY) * (height - 2 * pad),
    }));
  }, [groups, size]);

  // Legend: unique resource object types present in this data
  const legendTypes = useMemo(() => {
    const types = new Set(Object.values(data.resource_object_types));
    return [...types].sort();
  }, [data.resource_object_types]);

  const BADGE_R = 5;
  const vb = zoomed ?? { x: 0, y: 0, w: size.width, h: size.height };
  // preserveAspectRatio="meet" uses the minimum of the two scale factors,
  // so node compensation must use the same value to stay at a fixed screen size.
  const effectiveScale = zoomed
    ? Math.min(size.width / vb.w, size.height / vb.h)
    : 1;
  const nodeR  = NODE_R  / effectiveScale;
  const badgeR = BADGE_R / effectiveScale;

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="w-full border rounded-md overflow-hidden bg-background relative">
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          style={{ cursor: zoomed ? "default" : "crosshair", userSelect: "none" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={e => { if (dragStart.current) handleMouseUp(e); }}
        >
          {groups.map((group, i) => {
            const pos = positions[i];
            if (!pos) return null;
            const count = group.resources.length;
            return (
              <g
                key={group.key}
                transform={`translate(${pos.x},${pos.y})`}
                onMouseEnter={e => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, resources: group.resources });
                }}
                onMouseMove={e => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTooltip(t => t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
                }}
                onMouseLeave={() => setTooltip(null)}
              >
                <PieNode r={nodeR} strokeWidth={0.5 / effectiveScale} typeCounts={group.typeCounts} colorMap={typeColorMap} />
                {count > 1 && (
                  <>
                    <circle r={badgeR} cx={nodeR} cy={-nodeR} fill="#1e293b" stroke="white" strokeWidth={0.5 / effectiveScale} />
                    <text x={nodeR} y={-nodeR} textAnchor="middle" dominantBaseline="central"
                      fontSize={5 / effectiveScale} fill="white" fontWeight="700"
                      style={{ pointerEvents: "none", userSelect: "none" }}>
                      {count}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Rubber band — DOM-mutated directly, no React state */}
          <rect ref={rbRef} display="none" fill="rgba(99,102,241,0.08)"
            stroke="#6366f1" strokeWidth={1 / effectiveScale} strokeDasharray={`${4 / effectiveScale} ${2 / effectiveScale}`}
            style={{ pointerEvents: "none" }} />
        </svg>

        {zoomed && (
          <button onClick={() => setZoomed(null)} style={{
            position: "absolute", bottom: 10, right: 10,
            background: "white", border: "1px solid #e2e8f0",
            borderRadius: 6, padding: "4px 10px", fontSize: 11,
            cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
          }}>
            Reset zoom
          </button>
        )}

        {tooltip && <TooltipBox tooltip={tooltip} containerSize={size} />}
      </div>

      {/* Legend */}
      <div className="flex gap-8 text-xs flex-wrap">
        <div>
          <p className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide" style={{ fontSize: 10 }}>
            Resources
          </p>
          <div className="space-y-1">
            {legendTypes.map(t => (
              <div key={t} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: typeColorMap[t] ?? "#94a3b8" }} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── TooltipBox ─────────────────────────────────────────────── */
function TooltipBox({
  tooltip,
  containerSize,
}: {
  tooltip: { x: number; y: number; resources: string[] };
  containerSize: { width: number; height: number };
}) {
  const estW = 120, estH = tooltip.resources.length * 20 + 12;
  const left = Math.min(tooltip.x + 14, containerSize.width - estW - 4);
  const top  = Math.min(tooltip.y - 4, containerSize.height - estH - 4);
  return (
    <div style={{
      position: "absolute", left, top,
      background: "white", border: "1px solid #e2e8f0", borderRadius: 6,
      padding: "6px 10px", fontSize: 12, pointerEvents: "none",
      zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", whiteSpace: "nowrap",
    }}>
      {tooltip.resources.map(r => <div key={r}>{r}</div>)}
    </div>
  );
}

/* ── TypeSelector ───────────────────────────────────────────── */
function TypeSelector({
  title, types, selected, onToggle, colorMap,
}: {
  title: string;
  types: string[];
  selected: Set<string>;
  onToggle: (t: string) => void;
  colorMap: Record<string, string>;
}) {
  return (
    <div className="border rounded-md p-3 min-w-[180px]">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">
        {types.map(t => (
          <div key={t} className="flex items-center gap-2">
            <Switch
              id={`ram-${title}-${t}`}
              checked={selected.has(t)}
              onCheckedChange={() => onToggle(t)}
              style={{ backgroundColor: colorMap[t] ?? "#94a3b8", opacity: selected.has(t) ? 1 : 0.35 }}
            />
            <Label htmlFor={`ram-${title}-${t}`} className="text-sm cursor-pointer">
              {t}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}
