import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type SimulationNodeDatum, type SimulationLinkDatum,
} from "d3-force";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/* ── Types ─────────────────────────────────────────────────── */
export type HandoverNode = { id: string; object_type: string };
export type HandoverEdge = {
  source: string;
  target: string;
  businessobject_type: string;
  weight: number;
  raw_weight: number;
};
export type HandoverData = { nodes: HandoverNode[]; edges: HandoverEdge[] };

type OCHandoverExplorerProps = {
  fileId?: number;
  onDataLoad?: (data: HandoverData) => void;
  embedded?: boolean;
};

type ViewMode = "table" | "graph";
type Method = "oc" | "flattened";

/* ── Colors ─────────────────────────────────────────────────── */
// Golden angle gives maximum perceptual hue separation for any number of colors.
const GOLDEN_ANGLE = 137.508;

// Muted/pastel for resource nodes (low saturation, high lightness — like matplotlib Set2)
function nodeColor(i: number): string {
  return `hsl(${(i * GOLDEN_ANGLE) % 360}, 42%, 67%)`;
}

// Saturated/dark for business object edges (like matplotlib tab10)
// Offset by 60° so the first node and first edge are never the same hue.
function edgeColor(i: number): string {
  return `hsl(${(i * GOLDEN_ANGLE + 60) % 360}, 68%, 42%)`;
}

function buildColorMap(keys: string[], colorFn: (i: number) => string): Record<string, string> {
  const map: Record<string, string> = {};
  keys.forEach((k, i) => { map[k] = colorFn(i); });
  return map;
}

/* ── Graph constants ────────────────────────────────────────── */
const NODE_R = 26;
const ARROW_LEN = 14;  // arrow length along path direction (base → tip), user space
const ARROW_H   = 18;  // arrow height perpendicular to path, user space
const BASE_CURVE = 38;

/* ── Main component ─────────────────────────────────────────── */
export default function OCHandoverExplorer({
  fileId,
  onDataLoad,
  embedded = false,
}: OCHandoverExplorerProps) {
  const [objectTypes, setObjectTypes] = useState<string[]>([]);
  const [method, setMethod] = useState<Method>("oc");
  const [resourceTypes, setResourceTypes] = useState<Set<string>>(new Set());
  const [boTypes, setBoTypes] = useState<Set<string>>(new Set());
  const [caseType, setCaseType] = useState<string>("");
  const [flatResourceType, setFlatResourceType] = useState<string>("");
  const [data, setData] = useState<HandoverData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [hasStartedLoading, setHasStartedLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");

  const fileIdRef = useRef<number | undefined>(fileId);
  useEffect(() => { fileIdRef.current = fileId; }, [fileId]);

  // Phase 1: load object types when fileId changes
  useEffect(() => {
    if (!fileId) {
      setObjectTypes([]);
      setResourceTypes(new Set());
      setBoTypes(new Set());
      setData(null);
      setStatus("idle");
      setHasStartedLoading(false);
      return;
    }

    setObjectTypes([]);
    setResourceTypes(new Set());
    setBoTypes(new Set());
    setCaseType("");
    setFlatResourceType("");
    setData(null);
    setStatus("idle");
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

  // Reset results when the method changes
  useEffect(() => {
    setData(null);
    setStatus("idle");
    setHasStartedLoading(false);
    setErrorMsg("");
  }, [method]);

  // Phase 2: compute handover when triggered
  useEffect(() => {
    if (!fileId || !hasStartedLoading) return;
    const currentMethod = method;
    if (currentMethod === "oc" && (resourceTypes.size === 0 || boTypes.size === 0)) return;
    if (currentMethod === "flattened" && (!caseType || !flatResourceType)) return;

    const currentFileId = fileId;
    const params: Record<string, string> = { file_id: String(currentFileId), method: currentMethod };
    if (currentMethod === "oc") {
      params.resource_types = [...resourceTypes].join(",");
      params.businessobject_types = [...boTypes].join(",");
    } else {
      params.case_type = caseType;
      params.resource_type = flatResourceType;
    }
    let cancelled = false;

    (async () => {
      if (fileIdRef.current !== currentFileId) return;
      setStatus("loading");
      setErrorMsg("");

      const token = localStorage.getItem("access_token");
      if (!token) { setStatus("error"); setErrorMsg("Not authenticated"); return; }

      try {
        const res = await fetch(`/api/handover/?${new URLSearchParams(params)}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (fileIdRef.current !== currentFileId || cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const result: HandoverData = await res.json();
        if (fileIdRef.current !== currentFileId || cancelled) return;
        setData(result);
        setStatus(result.edges.length > 0 ? "ready" : "empty");
        onDataLoad?.(result);
      } catch (e: any) {
        if (fileIdRef.current !== currentFileId || cancelled) return;
        setStatus("error");
        setErrorMsg(e?.message || "Handover computation failed");
      }
    })();

    return () => { cancelled = true; };
  }, [fileId, hasStartedLoading, onDataLoad]);

  const handleCompute = () => {
    setHasStartedLoading(false);
    setTimeout(() => setHasStartedLoading(true), 0);
  };

  const toggleResourceType = (t: string) =>
    setResourceTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const toggleBoType = (t: string) =>
    setBoTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const boTypeColors = useMemo(
    () => buildColorMap(data ? [...new Set(data.edges.map(e => e.businessobject_type))] : [], edgeColor),
    [data],
  );
  const nodeTypeColors = useMemo(
    () => buildColorMap(data ? [...new Set(data.nodes.map(n => n.object_type))] : [], nodeColor),
    [data],
  );

  const sortedEdges = useMemo(
    () => data ? [...data.edges].sort((a, b) => b.weight - a.weight) : [],
    [data],
  );
  const maxRaw = useMemo(
    () => sortedEdges.reduce((m, e) => Math.max(m, e.raw_weight), 1),
    [sortedEdges],
  );

  const Wrapper = embedded ? "div" : Card;

  return (
    <Wrapper className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">OC Handover of Work</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {!fileId && (
          <p className="text-sm text-muted-foreground">Select a file to start.</p>
        )}

        {fileId && objectTypes.length > 0 && (
          <div className="flex items-center gap-3">
            <span className={`text-sm ${method === "oc" ? "font-semibold" : "text-muted-foreground"}`}>
              Object-Centric
            </span>
            <Switch checked={method === "flattened"} onCheckedChange={v => setMethod(v ? "flattened" : "oc")} />
            <span className={`text-sm ${method === "flattened" ? "font-semibold" : "text-muted-foreground"}`}>
              Flattened
            </span>
          </div>
        )}

        {fileId && objectTypes.length > 0 && method === "oc" && (
          <div className="flex gap-4 flex-wrap">
            <TypeSelector title="Resource types" types={objectTypes} selected={resourceTypes} onToggle={toggleResourceType} />
            <TypeSelector title="Business object types" types={objectTypes} selected={boTypes} onToggle={toggleBoType} />
          </div>
        )}

        {fileId && objectTypes.length > 0 && method === "flattened" && (
          <div className="flex gap-4 flex-wrap">
            <SingleTypeSelector title="Case type" types={objectTypes} selected={caseType} onSelect={setCaseType} />
            <SingleTypeSelector title="Resource type" types={objectTypes} selected={flatResourceType} onSelect={setFlatResourceType} />
          </div>
        )}

        {fileId && objectTypes.length > 0 && (() => {
          const canCompute = method === "oc"
            ? resourceTypes.size > 0 && boTypes.size > 0
            : caseType !== "" && flatResourceType !== "";
          return (
            <Button onClick={handleCompute} disabled={status === "loading" || !canCompute}>
              {status === "loading" ? "Computing…" : "Compute Handover"}
            </Button>
          );
        })()}

        {status === "loading" && (
          <div className="flex items-center gap-2 text-sm">
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
            Computing handover graph…
          </div>
        )}

        {status === "error" && (
          <div className="text-sm text-destructive">Error: {errorMsg}</div>
        )}

        {status === "empty" && (
          <p className="text-sm text-muted-foreground">No handover edges found for this selection.</p>
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

            {viewMode === "graph" && (
              <HandoverGraph
                nodes={data.nodes}
                edges={data.edges}
                boTypeColors={boTypeColors}
                nodeTypeColors={nodeTypeColors}
              />
            )}

            {viewMode === "table" && (
              <div className="overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left font-medium">Source</th>
                      <th className="px-3 py-2 text-left font-medium">Target</th>
                      <th className="px-3 py-2 text-left font-medium">Business object type</th>
                      <th className="px-3 py-2 text-left font-medium">Count</th>
                      <th className="px-3 py-2 text-left font-medium w-40">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEdges.map((edge, i) => {
                      const color = boTypeColors[edge.businessobject_type] ?? "#94a3b8";
                      const barPct = Math.round((edge.raw_weight / maxRaw) * 100);
                      return (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2 font-mono">{edge.source}</td>
                          <td className="px-3 py-2 font-mono">{edge.target}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-white text-xs" style={{ background: color }}>
                              {edge.businessobject_type}
                            </span>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{edge.raw_weight}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                                <div className="h-full rounded" style={{ width: `${barPct}%`, background: color }} />
                              </div>
                              <span className="tabular-nums text-xs text-muted-foreground w-12 text-right">
                                {edge.weight.toFixed(4)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Wrapper>
  );
}

/* ── TypeSelector ───────────────────────────────────────────── */
function TypeSelector({
  title, types, selected, onToggle,
}: { title: string; types: string[]; selected: Set<string>; onToggle: (t: string) => void }) {
  return (
    <div className="border rounded-md p-3 min-w-[180px]">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">
        {types.map(t => (
          <div key={t} className="flex items-center gap-2">
            <Switch id={`${title}-${t}`} checked={selected.has(t)} onCheckedChange={() => onToggle(t)} />
            <Label htmlFor={`${title}-${t}`} className="text-sm cursor-pointer">{t}</Label>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── SingleTypeSelector ─────────────────────────────────────── */
function SingleTypeSelector({
  title, types, selected, onSelect,
}: { title: string; types: string[]; selected: string; onSelect: (t: string) => void }) {
  return (
    <div className="border rounded-md p-3 min-w-[180px]">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">
        {types.map(t => (
          <button key={t} className="flex items-center gap-2 w-full text-left" onClick={() => onSelect(t)}>
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
              selected === t ? "border-primary" : "border-muted-foreground/40"
            }`}>
              {selected === t && <div className="w-2 h-2 rounded-full bg-primary" />}
            </div>
            <span className="text-sm">{t}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── HandoverGraph ──────────────────────────────────────────── */
type SimNode = SimulationNodeDatum & { id: string; object_type: string };
type SimLink = SimulationLinkDatum<SimNode>;

function HandoverGraph({
  nodes,
  edges,
  boTypeColors,
  nodeTypeColors,
}: {
  nodes: HandoverNode[];
  edges: HandoverEdge[];
  boTypeColors: Record<string, string>;
  nodeTypeColors: Record<string, string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [size, setSize] = useState({ width: 700, height: 450 });
  const [dragId, setDragId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.getBoundingClientRect().width || 700;
    setSize({ width: w, height: Math.max(400, w * 0.62) });
  }, []);

  // Force simulation — re-run when nodes/edges/size change
  useEffect(() => {
    if (nodes.length === 0) return;
    const { width, height } = size;

    const simNodes: SimNode[] = nodes.map(n => ({
      id: n.id,
      object_type: n.object_type,
      x: width / 2 + (Math.random() - 0.5) * width * 0.5,
      y: height / 2 + (Math.random() - 0.5) * height * 0.5,
    }));

    const nodeById: Record<string, SimNode> = {};
    simNodes.forEach(n => { nodeById[n.id] = n; });

    const simLinks: SimLink[] = edges
      .filter(e => nodeById[e.source] && nodeById[e.target])
      .map(e => ({ source: nodeById[e.source], target: nodeById[e.target] }));

    const sim = forceSimulation<SimNode>(simNodes)
      .force("link", forceLink<SimNode, SimLink>(simLinks).distance(150).strength(0.3))
      .force("charge", forceManyBody<SimNode>().strength(-500))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<SimNode>(NODE_R + 22));

    for (let i = 0; i < 300; i++) sim.tick();
    sim.stop();

    const pos: Record<string, { x: number; y: number }> = {};
    simNodes.forEach(n => {
      pos[n.id] = {
        x: Math.max(NODE_R + 4, Math.min(width - NODE_R - 4, n.x ?? width / 2)),
        y: Math.max(NODE_R + 4, Math.min(height - NODE_R - 4, n.y ?? height / 2)),
      };
    });
    setPositions(pos);
  }, [nodes, edges, size]);

  // Detect which pairs have a reverse edge
  const reverseSet = useMemo(() => {
    const s = new Set(edges.map(e => `${e.source}\x00${e.target}`));
    return (u: string, v: string) => s.has(`${v}\x00${u}`);
  }, [edges]);

  // Group edges by directed pair
  const edgeGroups = useMemo(() => {
    const g = new Map<string, HandoverEdge[]>();
    edges.forEach(e => {
      const key = `${e.source}\x00${e.target}`;
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(e);
    });
    return g;
  }, [edges]);

  const minWeight = useMemo(() => Math.min(...edges.map(e => e.weight)), [edges]);
  const maxWeight = useMemo(() => Math.max(...edges.map(e => e.weight), minWeight + 0.0001), [edges, minWeight]);

  const boTypes = useMemo(() => [...new Set(edges.map(e => e.businessobject_type))], [edges]);
  const nodeTypes = useMemo(() => [...new Set(nodes.map(n => n.object_type))], [nodes]);

  // Pre-compute all edge paths
  const edgePaths = useMemo(() => {
    if (Object.keys(positions).length === 0) return [];

    const result: Array<{
      key: string;
      d: string;
      color: string;
      strokeWidth: number;
      markerId: string;
    }> = [];

    const wRange = maxWeight - minWeight;
    const strokeFor = (w: number) =>
      wRange < 1e-6 ? 3 : 1.5 + ((w - minWeight) / wRange) * 4.5;

    edgeGroups.forEach((groupEdges, pairKey) => {
      const [srcId, tgtId] = pairKey.split("\x00");
      const src = positions[srcId];
      const tgt = positions[tgtId];
      if (!src || !tgt) return;

      // ── Self-loop ──────────────────────────────────────────
      if (srcId === tgtId) {
        groupEdges.forEach((edge, idx) => {
          const color = boTypeColors[edge.businessobject_type] ?? "#94a3b8";
          const markerId = `arrow-${edge.businessobject_type.replace(/[^a-zA-Z0-9]/g, "_")}`;
          const strokeWidth = strokeFor(edge.weight);

          // Draw a cubic-bezier loop above the node; spread multiple loops by offset
          const spread = idx * NODE_R * 0.9;
          const loopH = NODE_R * 2.4 + spread;
          const loopW = NODE_R * 1.6 + spread;

          // Start / end on the node circle (upper-left / upper-right)
          const startA = -Math.PI * 0.72;
          const startX = src.x + NODE_R * Math.cos(startA);
          const startY = src.y + NODE_R * Math.sin(startA);

          // Control points arch above
          const cp1x = src.x - loopW;
          const cp1y = src.y - loopH;
          const cp2x = src.x + loopW;
          const cp2y = src.y - loopH;

          // End: approach the node from upper-right; pull back by ARROW_LEN so
          // the stroke ends exactly where the arrow base begins.
          const endA = -Math.PI * 0.28;
          const endTX = src.x + NODE_R * Math.cos(endA);
          const endTY = src.y + NODE_R * Math.sin(endA);
          const edx = endTX - cp2x, edy = endTY - cp2y;
          const eLen = Math.hypot(edx, edy) || 1;
          const endX = endTX - (edx / eLen) * ARROW_LEN;
          const endY = endTY - (edy / eLen) * ARROW_LEN;

          result.push({
            key: `${pairKey}-${edge.businessobject_type}-${idx}`,
            d: `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`,
            color, strokeWidth, markerId,
          });
        });
        return;
      }

      // ── Normal edge ────────────────────────────────────────
      const hasRev = reverseSet(srcId, tgtId);
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) return;

      const ux = dx / len;
      const uy = dy / len;
      const px = -uy; // perpendicular (left of src→tgt)
      const py = ux;

      groupEdges.forEach((edge, idx) => {
        const color = boTypeColors[edge.businessobject_type] ?? "#94a3b8";
        const markerId = `arrow-${edge.businessobject_type.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const strokeWidth = strokeFor(edge.weight);

        const n = groupEdges.length;
        let offset: number;
        if (n === 1 && !hasRev) {
          offset = 0;
        } else if (n === 1) {
          offset = BASE_CURVE;
        } else {
          const base = hasRev ? BASE_CURVE : 0;
          offset = base + BASE_CURVE * 0.7 * (idx - (n - 1) / 2);
        }

        let d: string;

        if (offset === 0) {
          const sx = src.x + ux * NODE_R;
          const sy = src.y + uy * NODE_R;
          const ex = tgt.x - ux * (NODE_R + ARROW_LEN);
          const ey = tgt.y - uy * (NODE_R + ARROW_LEN);
          d = `M ${sx} ${sy} L ${ex} ${ey}`;
        } else {
          const cx = (src.x + tgt.x) / 2 + px * offset;
          const cy = (src.y + tgt.y) / 2 + py * offset;

          // Start: node boundary toward control point
          const dsx = cx - src.x, dsy = cy - src.y;
          const dsLen = Math.hypot(dsx, dsy) || 1;
          const sx = src.x + (dsx / dsLen) * NODE_R;
          const sy = src.y + (dsy / dsLen) * NODE_R;

          // End: node boundary from control point, pulled back by ARROW_LEN
          const dtx = tgt.x - cx, dty = tgt.y - cy;
          const dtLen = Math.hypot(dtx, dty) || 1;
          const ex = tgt.x - (dtx / dtLen) * (NODE_R + ARROW_LEN);
          const ey = tgt.y - (dty / dtLen) * (NODE_R + ARROW_LEN);

          d = `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`;
        }

        result.push({ key: `${pairKey}-${edge.businessobject_type}-${idx}`, d, color, strokeWidth, markerId });
      });
    });

    return result;
  }, [positions, edgeGroups, reverseSet, boTypeColors, minWeight, maxWeight]);

  // Node drag handlers
  const handleNodeMouseDown = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    const pos = positions[id];
    if (!pos) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { x: e.clientX - rect.left - pos.x, y: e.clientY - rect.top - pos.y };
    setDragId(id);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragId) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPositions(prev => ({
      ...prev,
      [dragId]: {
        x: Math.max(NODE_R, Math.min(size.width - NODE_R, e.clientX - rect.left - dragOffset.current.x)),
        y: Math.max(NODE_R, Math.min(size.height - NODE_R, e.clientY - rect.top - dragOffset.current.y)),
      },
    }));
  };

  const handleMouseUp = () => setDragId(null);

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="w-full border rounded-md overflow-hidden bg-background">
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: dragId ? "grabbing" : "default", display: "block" }}
        >
          <defs>
            {boTypes.map(bt => {
              const color = boTypeColors[bt] ?? "#94a3b8";
              const id = `arrow-${bt.replace(/[^a-zA-Z0-9]/g, "_")}`;
              // markerUnits="userSpaceOnUse" keeps the arrowhead a fixed pixel size
              // regardless of stroke width, so thick and thin edges all get the same arrow.
              return (
                <marker key={id} id={id}
                  markerWidth={ARROW_LEN} markerHeight={ARROW_H}
                  refX={0} refY={ARROW_H / 2}
                  orient="auto" markerUnits="userSpaceOnUse">
                  <polygon
                    points={`0 0, ${ARROW_LEN} ${ARROW_H / 2}, 0 ${ARROW_H}`}
                    fill={color}
                  />
                </marker>
              );
            })}
          </defs>

          {/* Edges */}
          {edgePaths.map(ep => (
            <path
              key={ep.key}
              d={ep.d}
              fill="none"
              markerEnd={`url(#${ep.markerId})`}
              style={{ stroke: ep.color, strokeWidth: ep.strokeWidth, opacity: 0.85 }}
            />
          ))}

          {/* Nodes */}
          {nodes.map(node => {
            const pos = positions[node.id];
            if (!pos) return null;
            const color = nodeTypeColors[node.object_type] ?? "#94a3b8";
            const label = node.id.length > 11 ? node.id.slice(0, 11) + "…" : node.id;
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x},${pos.y})`}
                style={{ cursor: "grab" }}
                onMouseDown={e => handleNodeMouseDown(node.id, e)}
              >
                <circle r={NODE_R} fill={color} stroke="white" strokeWidth={2} />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={9}
                  fill="white"
                  fontWeight="600"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legends */}
      <div className="flex gap-8 text-xs flex-wrap">
        <div>
          <p className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide" style={{ fontSize: 10 }}>
            Resources
          </p>
          <div className="space-y-1">
            {nodeTypes.map(t => (
              <div key={t} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: nodeTypeColors[t] ?? "#94a3b8" }} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide" style={{ fontSize: 10 }}>
            Handover object type
          </p>
          <div className="space-y-1">
            {boTypes.map(t => (
              <div key={t} className="flex items-center gap-2">
                <div className="w-4 h-2 rounded-sm flex-shrink-0" style={{ background: boTypeColors[t] ?? "#94a3b8" }} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
