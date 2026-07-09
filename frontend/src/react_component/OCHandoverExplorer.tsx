import { useEffect, useLayoutEffect, useMemo, useRef, useState, useContext } from "react";
import { ClusterContext, type ClusterInfo } from "@/contexts/ClusterContext";
import TooltipBox from "@/react_component/ResourceTooltip";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Download, Info, Loader2, MinusIcon, Network, Pause, Play, PlusIcon, ScanIcon, Search, SlidersHorizontal, Square, Timer, X } from "lucide-react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceRadial,
  type SimulationNodeDatum, type SimulationLinkDatum,
} from "d3-force";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mapTypesToColors } from "@/utils/objectColors";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";


/* ── Types ─────────────────────────────────────────────────── */
export type HandoverNode = { id: string; object_type: string; event_count: number };
export type HandoverEdge = {
  source: string;
  target: string;
  businessobject_type: string;
  weight: number;
  raw_weight: number;
  avg_time: number | null;
  min_time: number | null;
  max_time: number | null;
};
export type HandoverData = { nodes: HandoverNode[]; edges: HandoverEdge[] };

type FlowEvent = {
  source: string;
  target: string;
  bo_type: string;
  bo_ids: string[];
  start_time: number;  // Unix seconds
  duration: number;    // seconds (>= 1)
};
type FlowsData = {
  flows: FlowEvent[];
  timeline: { start: number; end: number };
};
type BindingArc = {
  other_resource: string;
  bo_type: string;
  mark: "dot" | "square";
  is_gapped: boolean;
};
type BindingPattern = {
  type: "output" | "input";
  resource: string;
  arcs: BindingArc[];
  line_type: "solid" | "dotted" | null;
  count: number;
};

type OCHandoverExplorerProps = {
  fileId?: number;
  onDataLoad?: (data: HandoverData) => void;
  embedded?: boolean;
  fileName?: string;
};

type ViewMode = "table" | "graph" | "log";
type Method = "oc" | "flattened";

type EventLogData = {
  object_types: string[];
  events: {
    event_id: string;
    activity: string;
    timestamp: number | string;
    objects: Record<string, string[]>;
  }[];
};
type Normalization = "by_source" | "by_target" | "by_arcs_in_eog" | "by_total_weight";
type SortCol = "source" | "target" | "bo_type" | "count" | "weight";
type SortDir = "asc" | "desc";

const NORMALIZATION_LABELS: Record<Normalization, string> = {
  by_source:       "By Source",
  by_target:       "By Target",
  by_arcs_in_eog:  "By Arcs in EOG",
  by_total_weight: "By Total Weight",
};

/* ── Graph constants ────────────────────────────────────────── */
const NODE_R = 26;

// Interpolate between grey (#CBD5E1) and a hex color; t=0 → grey, t=1 → color
function mixHex(hex: string, t: number): string {
  const gr = [203, 213, 225]; // #CBD5E1
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(gr[0], r)},${mix(gr[1], g)},${mix(gr[2], b)})`;
}
const ARROW_LEN = 14;  // arrow length along path direction (base → tip), user space
const ARROW_H   = 18;  // arrow height perpendicular to path, user space
const BASE_CURVE = 38;

const _SUPS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
function fmtSpeed(s: number): string {
  if (s === 1) return "1×";
  const exp = Math.log10(s);
  if (Number.isInteger(exp)) return `10${_SUPS[exp]}×`;
  const e = Math.floor(exp);
  return `${s / Math.pow(10, e)}·10${_SUPS[e]}×`;
}

const _SPEED_OPTIONS = [1, 10, 100, 1000, 5000, 10000, 50000, 100000, 1000000, 10000000, 100000000];
function snapSpeed(target: number): number {
  return _SPEED_OPTIONS.reduce((best, s) =>
    Math.abs(Math.log(s) - Math.log(target)) < Math.abs(Math.log(best) - Math.log(target)) ? s : best
  );
}

/* ── Main component ─────────────────────────────────────────── */
export default function OCHandoverExplorer({
  fileId,
  onDataLoad,
  embedded = false,
  fileName,
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
  const hasStartedLoadingRef = useRef(false);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [maxGap, setMaxGap] = useState<number | null>(null);
  const [normalization, setNormalization] = useState<Normalization>("by_arcs_in_eog");
  const [normalizationScope, setNormalizationScope] = useState<"global" | "per_bo_type">("global");
  const [sortCol, setSortCol] = useState<SortCol>("weight");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [parallelFilterEnabled, setParallelFilterEnabled] = useState(false);
  const [parallelThreshold, setParallelThreshold] = useState(0.5);
  const [minParallelObs, setMinParallelObs] = useState(1);
  const [minParallelObsStr, setMinParallelObsStr] = useState("1");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const [visibleGraphNodes, setVisibleGraphNodes] = useState<HandoverNode[]>([]);
  const [nodeSearch, setNodeSearch] = useState("");
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const nodeSearchRef = useRef<HTMLDivElement>(null);
  const graphPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const graphViewBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const { clusterInfo } = useContext(ClusterContext);
  const [useClusters, setUseClusters] = useState(false);
  const [clusterByOt, setClusterByOt] = useState(false);
  const [logData, setLogData] = useState<EventLogData | null>(null);
  const [logStatus, setLogStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [logError, setLogError] = useState("");
  const [flowsData, setFlowsData] = useState<FlowsData | null>(null);
  const [flowsStatus, setFlowsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [bindingsData, setBindingsData] = useState<BindingPattern[] | null>(null);
  const [bindingsStatus, setBindingsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [animIsPlaying, setAnimIsPlaying] = useState(false);
  const [animSliderTime, setAnimSliderTime] = useState(0);
  const [animPlaySpeed, setAnimPlaySpeed] = useState(100);
  const [connectorMode, setConnectorMode] = useState<"fade" | "persist" | "none">("fade");
  const animPlayRef = useRef<(() => void) | null>(null);
  const animPauseRef = useRef<(() => void) | null>(null);
  const animScrubRef = useRef<((t: number) => void) | null>(null);
  useEffect(() => {
    setAnimIsPlaying(false);
    if (flowsData) {
      const duration = flowsData.timeline.end - flowsData.timeline.start;
      setAnimPlaySpeed(snapSpeed(Math.max(1, duration / 30)));
      setAnimSliderTime(flowsData.timeline.start);
    } else {
      setAnimPlaySpeed(100);
      setAnimSliderTime(0);
    }
  }, [flowsData]);
  useEffect(() => {
    if (selectedNode) animPauseRef.current?.();
  }, [selectedNode]);

  type MlpaLayer = { level: number; areas: { objectTypes: string[] }[] };
  const [mlpaLayers, setMlpaLayers] = useState<MlpaLayer[] | null>(null);
  const [mlpaStatus, setMlpaStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selectedMlpaLevel, setSelectedMlpaLevel] = useState<number | null>(null);
  const useClustersRef = useRef(useClusters);
  useEffect(() => { useClustersRef.current = useClusters; }, [useClusters]);

  const resultsRef = useRef<HTMLDivElement>(null);
  const viewModeRef = useRef(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

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
      hasStartedLoadingRef.current = false;
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

  // Reset results when the method changes
  useEffect(() => {
    setData(null);
    setStatus("idle");
    hasStartedLoadingRef.current = false;
    setHasStartedLoading(false);
    setErrorMsg("");
    setMaxGap(null);
  }, [method]);

  // Reset results when normalization, scope, or parallel filter changes
  useEffect(() => {
    setData(null);
    setStatus("idle");
    hasStartedLoadingRef.current = false;
    setHasStartedLoading(false);
    setErrorMsg("");
  }, [normalization, normalizationScope, parallelFilterEnabled, parallelThreshold, minParallelObs, clusterByOt]);

  // Reset selected node and locked height when data changes
  useEffect(() => { setSelectedNode(null); setLockedHeight(null); setViewMode("graph"); graphPositionsRef.current = {}; graphViewBoxRef.current = null; }, [data]);

  // Reset log data when fileId changes
  useEffect(() => {
    setLogData(null);
    setLogStatus("idle");
    setLogError("");
  }, [fileId]);

  // Reset and fetch MLPA layers when fileId or method changes
  useEffect(() => {
    setMlpaLayers(null);
    setMlpaStatus("idle");
    setSelectedMlpaLevel(null);

    if (!fileId || method !== "oc") return;

    let cancelled = false;
    setMlpaStatus("loading");
    (async () => {
      const token = localStorage.getItem("access_token");
      if (!token) { if (!cancelled) setMlpaStatus("error"); return; }
      try {
        const res = await fetch(`/api/files/${fileId}/discover_mlpa/`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setMlpaLayers(json.layers ?? null);
        setMlpaStatus("ready");
      } catch {
        if (!cancelled) setMlpaStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [fileId, method]);

  // Fetch event log lazily when the Log view is opened
  useEffect(() => {
    if (viewMode !== "log" || !fileId || logStatus !== "idle") return;
    let cancelled = false;
    setLogStatus("loading");
    (async () => {
      const token = localStorage.getItem("access_token");
      if (!token) { setLogStatus("error"); setLogError("Not authenticated"); return; }
      try {
        const res = await fetch(`/api/event-log/?file_id=${fileId}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
        const result: EventLogData = await res.json();
        if (cancelled) return;
        setLogData(result);
        setLogStatus("ready");
      } catch (e: any) {
        if (cancelled) return;
        setLogStatus("error");
        setLogError(e?.message || "Failed to load event log");
      }
    })();
    return () => { cancelled = true; };
  // logStatus intentionally omitted: the guard inside prevents re-entry,
  // and including it would cancel the in-flight fetch on every status change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, fileId]);

  // Measure and lock the results area height 50ms after data loads.
  // viewMode is intentionally NOT in the deps — the timer must not be cancelled
  // if the user switches to table view before it fires.
  // The viewModeRef check inside guards against accidentally locking the table height.
  useEffect(() => {
    if (status !== "ready" || lockedHeight !== null) return;
    const id = setTimeout(() => {
      if (viewModeRef.current !== "graph") return;
      const h = resultsRef.current?.offsetHeight;
      if (h && h > 0) setLockedHeight(h);
    }, 50);
    return () => clearTimeout(id);
  }, [status, lockedHeight]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (nodeSearchRef.current && !nodeSearchRef.current.contains(e.target as Node)) {
        setNodeSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Phase 2: compute handover when triggered
  useEffect(() => {
    if (!fileId || !hasStartedLoadingRef.current) return;
    const currentMethod = method;
    if (currentMethod === "oc" && (resourceTypes.size === 0 || boTypes.size === 0)) return;
    if (currentMethod === "flattened" && (!caseType || !flatResourceType)) return;

    const currentFileId = fileId;
    const params: Record<string, string> = { file_id: String(currentFileId), method: currentMethod };
    if (currentMethod === "oc") {
      params.resource_types = [...resourceTypes].join(",");
      params.businessobject_types = [...boTypes].join(",");
      if (maxGap !== null) params.max_gap = String(maxGap);
      params.normalization = normalization;
      params.normalization_scope = normalizationScope;
      if (parallelFilterEnabled) {
        params.parallel_threshold = String(parallelThreshold);
        params.min_parallel_observations = String(minParallelObs);
      }
      if (clusterByOt) params.cluster_by_ot = "true";
    } else {
      params.case_type = caseType;
      params.resource_type = flatResourceType;
      if (maxGap !== null) params.max_gap = String(maxGap);
    }
    let cancelled = false;

    (async () => {
      if (fileIdRef.current !== currentFileId) return;
      setStatus("loading");
      setErrorMsg("");

      const token = localStorage.getItem("access_token");
      if (!token) { setStatus("error"); setErrorMsg("Not authenticated"); return; }

      try {
        const activeClusterMap = useClustersRef.current && clusterInfo ? clusterInfo.clusterMap : null;
        const res = activeClusterMap
          ? await fetch("/api/handover/", {
              method: "POST",
              credentials: "include",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ ...params, cluster_map: activeClusterMap }),
            })
          : await fetch(`/api/handover/?${new URLSearchParams(params)}`, {
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
  // useClusters intentionally omitted (read via ref): toggling it should not auto-recompute.
  // clusterInfo is included so OrgaMining recomputes propagate when useClusters is on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, hasStartedLoading, onDataLoad, clusterInfo]);

  const handleCompute = () => {
    hasStartedLoadingRef.current = false;
    setHasStartedLoading(false);
    setTimeout(() => { hasStartedLoadingRef.current = true; setHasStartedLoading(true); }, 0);
  };

  // Clear flows + bindings when handover data is recomputed
  useEffect(() => {
    setFlowsData(null);
    setFlowsStatus("idle");
    setBindingsData(null);
    setBindingsStatus("idle");
  }, [data]);

  const fetchFlows = async () => {
    if (!fileId || flowsStatus === "loading") return;
    setFlowsStatus("loading");
    setFlowsData(null);

    const token = localStorage.getItem("access_token");
    if (!token) { setFlowsStatus("error"); return; }

    const params: Record<string, string> = {
      file_id: String(fileId),
      method,
      include_flows: "true",
    };
    if (method === "oc") {
      params.resource_types = [...resourceTypes].join(",");
      params.businessobject_types = [...boTypes].join(",");
      if (maxGap !== null) params.max_gap = String(maxGap);
      params.normalization = normalization;
      params.normalization_scope = normalizationScope;
      if (parallelFilterEnabled) {
        params.parallel_threshold = String(parallelThreshold);
        params.min_parallel_observations = String(minParallelObs);
      }
      if (clusterByOt) params.cluster_by_ot = "true";
    } else {
      params.case_type = caseType;
      params.resource_type = flatResourceType;
      if (maxGap !== null) params.max_gap = String(maxGap);
    }

    try {
      const activeClusterMap = useClusters && clusterInfo ? clusterInfo.clusterMap : null;
      const res = activeClusterMap
        ? await fetch("/api/handover/", {
            method: "POST",
            credentials: "include",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ...params, cluster_map: activeClusterMap }),
          })
        : await fetch(`/api/handover/?${new URLSearchParams(params)}`, {
            credentials: "include",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      if (result.flows && result.timeline) {
        setFlowsData({ flows: result.flows, timeline: result.timeline });
        setFlowsStatus("ready");
      } else {
        setFlowsStatus("error");
      }
    } catch {
      setFlowsStatus("error");
    }
  };

  const fetchBindings = async () => {
    if (!fileId || bindingsStatus === "loading") return;
    setBindingsStatus("loading");
    setBindingsData(null);
    const token = localStorage.getItem("access_token");
    if (!token) { setBindingsStatus("error"); return; }
    const params: Record<string, string> = {
      file_id: String(fileId),
      method,
      include_bindings: "true",
    };
    if (method === "oc") {
      params.resource_types = [...resourceTypes].join(",");
      params.businessobject_types = [...boTypes].join(",");
      if (maxGap !== null) params.max_gap = String(maxGap);
      params.normalization = normalization;
      params.normalization_scope = normalizationScope;
      if (parallelFilterEnabled) {
        params.parallel_threshold = String(parallelThreshold);
        params.min_parallel_observations = String(minParallelObs);
      }
      if (clusterByOt) params.cluster_by_ot = "true";
    } else {
      params.case_type = caseType;
      params.resource_type = flatResourceType;
      if (maxGap !== null) params.max_gap = String(maxGap);
    }
    try {
      const activeClusterMap = useClusters && clusterInfo ? clusterInfo.clusterMap : null;
      const res = activeClusterMap
        ? await fetch("/api/handover/", {
            method: "POST",
            credentials: "include",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ...params, cluster_map: activeClusterMap }),
          })
        : await fetch(`/api/handover/?${new URLSearchParams(params)}`, {
            credentials: "include",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      if (Array.isArray(result.bindings)) {
        setBindingsData(result.bindings);
        setBindingsStatus("ready");
      } else {
        setBindingsStatus("error");
      }
    } catch {
      setBindingsStatus("error");
    }
  };

  // When cluster mode is enabled, auto-select the resource types present in the cluster data.
  useEffect(() => {
    if (useClusters && clusterInfo) {
      const types = new Set(Object.values(clusterInfo.resourceObjectTypes));
      setResourceTypes(types);
      setBoTypes(prev => {
        const hasOverlap = [...types].some(t => prev.has(t));
        if (!hasOverlap) return prev;
        const n = new Set(prev);
        types.forEach(t => n.delete(t));
        return n;
      });
    }
  }, [useClusters, clusterInfo]);

  const toggleResourceType = (t: string) => {
    setResourceTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
    setBoTypes(prev => { if (!prev.has(t)) return prev; const n = new Set(prev); n.delete(t); return n; });
    setSelectedMlpaLevel(null);
  };

  const toggleBoType = (t: string) => {
    setBoTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
    setResourceTypes(prev => { if (!prev.has(t)) return prev; const n = new Set(prev); n.delete(t); return n; });
    setSelectedMlpaLevel(null);
  };

  const typeColorMap = useMemo(() => mapTypesToColors(objectTypes), [objectTypes]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const sortedEdges = useMemo(() => {
    if (!data) return [];
    return [...data.edges].sort((a, b) => {
      let cmp = 0;
      if (sortCol === "source") cmp = a.source.localeCompare(b.source);
      else if (sortCol === "target") cmp = a.target.localeCompare(b.target);
      else if (sortCol === "bo_type") cmp = a.businessobject_type.localeCompare(b.businessobject_type);
      else if (sortCol === "count") cmp = a.raw_weight - b.raw_weight;
      else cmp = a.weight - b.weight;
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [data, sortCol, sortDir]);

  const weightDenominators = useMemo(() => {
    if (normalizationScope === "per_bo_type") {
      const totals: Record<string, number> = {};
      for (const e of sortedEdges) totals[e.businessobject_type] = (totals[e.businessobject_type] ?? 0) + e.weight;
      return totals;
    }
    const total = sortedEdges.reduce((s, e) => s + e.weight, 0);
    return { _global: total };
  }, [sortedEdges, normalizationScope]);

  const Wrapper = embedded ? "div" : Card;

  return (
    <Wrapper className="w-full">
      {!embedded && (
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">OC Handover of Work</CardTitle>
        </CardHeader>
      )}

      <CardContent className="space-y-4">
        {!fileId && (
          <p className="text-sm text-muted-foreground">Select a file to start.</p>
        )}

        {fileId && objectTypes.length > 0 && (
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <Tooltip delayDuration={600}>
                <TooltipTrigger asChild>
                  <span className="text-lg font-semibold cursor-default">Method:</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-xs">
                  Object-Centric uses all object types directly. Flattened projects the log onto a single object type.
                </TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="min-w-[150px] justify-between">
                    {method === "oc" ? "Object-Centric" : "Flattened"}
                    <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[180px]">
                  <DropdownMenuRadioGroup value={method} onValueChange={v => setMethod(v as Method)}>
                    <DropdownMenuRadioItem value="oc">Object-Centric</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="flattened">Flattened</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip delayDuration={600}>
                <TooltipTrigger asChild>
                  <span className="text-lg font-semibold cursor-default">Max Gap:</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-xs">
                  Maximum number of events allowed between two consecutive events of the same object. Leave empty for no limit.
                </TooltipContent>
              </Tooltip>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 flex-shrink-0"
                  disabled={maxGap === null}
                  onClick={() => setMaxGap(prev => prev === 0 ? null : (prev ?? 0) - 1)}
                >
                  <MinusIcon className="h-4 w-4" />
                </Button>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="∞"
                  value={maxGap ?? ""}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === "") { setMaxGap(null); return; }
                    const n = parseInt(v, 10);
                    if (!isNaN(n) && n >= 0) setMaxGap(n);
                  }}
                  className="h-9 w-16 text-sm text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 flex-shrink-0"
                  onClick={() => setMaxGap(prev => prev === null ? 0 : prev + 1)}
                >
                  <PlusIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {method === "oc" && (
              <div className="flex items-center gap-2">
                <Tooltip delayDuration={600}>
                  <TooltipTrigger asChild>
                    <span className="text-lg font-semibold cursor-default">Normalization:</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    Controls how edge weights are scaled. 'None' uses raw counts. 'Relative' divides by total handovers per resource. 'Max' divides by the maximum weight.
                  </TooltipContent>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="min-w-[170px] justify-between">
                      {NORMALIZATION_LABELS[normalization]}
                      <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[200px]">
                    <DropdownMenuRadioGroup value={normalization} onValueChange={v => setNormalization(v as Normalization)}>
                      {(Object.keys(NORMALIZATION_LABELS) as Normalization[]).map(key => (
                        <DropdownMenuRadioItem key={key} value={key}>
                          {NORMALIZATION_LABELS[key]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            {method === "oc" && (
              <div className="flex items-center gap-2">
                <Switch
                  id="norm-scope"
                  checked={normalizationScope === "per_bo_type"}
                  onCheckedChange={v => setNormalizationScope(v ? "per_bo_type" : "global")}
                />
                <Tooltip delayDuration={600}>
                  <TooltipTrigger asChild>
                    <Label htmlFor="norm-scope" className="text-lg font-semibold cursor-pointer">
                      Per Object Type
                    </Label>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    When enabled, normalization is applied separately for each object type instead of across the whole graph.
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
            {method === "oc" && (
              <div className="flex items-center gap-2 flex-wrap">
                <Switch
                  id="parallel-filter"
                  checked={parallelFilterEnabled}
                  onCheckedChange={setParallelFilterEnabled}
                />
                <Tooltip delayDuration={600}>
                  <TooltipTrigger asChild>
                    <Label htmlFor="parallel-filter" className="text-lg font-semibold cursor-pointer">
                      Parallel Filter
                    </Label>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    Removes direct handovers between resources working in parallel. The threshold controls how often two activities must co-occur to be considered parallel.
                  </TooltipContent>
                </Tooltip>
                {parallelFilterEnabled && (
                  <div className="flex items-center gap-4 ml-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Tooltip delayDuration={600}>
                        <TooltipTrigger asChild>
                          <span className="text-sm text-muted-foreground cursor-default">Dependency threshold:</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                          Maximum allowed absolute dependency value. Lower values require more balanced co-occurrence in both directions to be considered parallel.
                        </TooltipContent>
                      </Tooltip>
                      <Slider
                        min={0}
                        max={1}
                        step={0.01}
                        value={[parallelThreshold]}
                        onValueChange={([v]) => setParallelThreshold(v)}
                        className="w-36"
                      />
                      <span className="text-sm font-mono w-10">{parallelThreshold.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Tooltip delayDuration={600}>
                        <TooltipTrigger asChild>
                          <span className="text-sm text-muted-foreground cursor-default">Min observations:</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                          Minimum total number of transitions (in both directions combined) required before a pair is considered parallel. Filters out coincidental reversals in sparse data.
                        </TooltipContent>
                      </Tooltip>
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 flex-shrink-0"
                        disabled={minParallelObs <= 1}
                        onClick={() => {
                          const v = Math.max(1, minParallelObs - 1);
                          setMinParallelObs(v);
                          setMinParallelObsStr(String(v));
                        }}>
                        <MinusIcon className="h-3 w-3" />
                      </Button>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={minParallelObsStr}
                        onChange={e => {
                          const raw = e.target.value;
                          setMinParallelObsStr(raw);
                          const n = parseInt(raw, 10);
                          if (!isNaN(n) && n >= 1) setMinParallelObs(n);
                        }}
                        onBlur={() => setMinParallelObsStr(String(minParallelObs))}
                        className="h-8 w-14 text-sm text-center"
                      />
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 flex-shrink-0"
                        onClick={() => {
                          const v = minParallelObs + 1;
                          setMinParallelObs(v);
                          setMinParallelObsStr(String(v));
                        }}>
                        <PlusIcon className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {fileId && objectTypes.length > 0 && method === "oc" && mlpaStatus === "ready" && mlpaLayers && mlpaLayers.length > 1 && (
          <div className="border rounded-md p-3 self-center">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pre-select from MLPA level</p>
            <div className="flex items-center gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={useClusters && !!clusterInfo}>
                  <Button variant="outline" size="sm" className="min-w-[110px] justify-between" disabled={useClusters && !!clusterInfo}>
                    {selectedMlpaLevel !== null ? `Level ${selectedMlpaLevel}` : "Select level"}
                    <ChevronDown className="ml-2 h-3 w-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuRadioGroup
                    value={selectedMlpaLevel !== null ? String(selectedMlpaLevel) : ""}
                    onValueChange={v => {
                      const level = Number(v);
                      setSelectedMlpaLevel(level);
                      const boSet = new Set(
                        mlpaLayers.filter(l => l.level === level).flatMap(l => l.areas.flatMap(a => a.objectTypes))
                      );
                      const resSet = new Set(
                        mlpaLayers.filter(l => l.level > level).flatMap(l => l.areas.flatMap(a => a.objectTypes))
                      );
                      setBoTypes(boSet);
                      setResourceTypes(resSet);
                    }}
                  >
                    {mlpaLayers.map(l => (
                      <DropdownMenuRadioItem key={l.level} value={String(l.level)}>
                        Level {l.level} — {l.areas.flatMap(a => a.objectTypes).join(", ")}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {useClusters && !!clusterInfo
                ? "OrgaMining clusters are enabled"
                : selectedMlpaLevel !== null
                  ? `Business objects: level ${selectedMlpaLevel} · Resources: levels above`
                  : "Select a level to pre-select object types"}
            </p>
          </div>
        )}

        {fileId && objectTypes.length > 0 && method === "oc" && (
          <div className="flex gap-4 flex-wrap justify-center">
            <TypeSelector title="Resource types" types={objectTypes} selected={resourceTypes} onToggle={toggleResourceType} disabled={useClusters && !!clusterInfo} />
            <TypeSelector title="Business object types" types={objectTypes} selected={boTypes} onToggle={toggleBoType} />
          </div>
        )}

        {fileId && objectTypes.length > 0 && method === "flattened" && (
          <div className="flex gap-4 flex-wrap justify-center">
            <SingleTypeSelector title="Case type" types={objectTypes} selected={caseType} onSelect={setCaseType} />
            <SingleTypeSelector title="Resource type" types={objectTypes} selected={flatResourceType} onSelect={setFlatResourceType} />
          </div>
        )}

        {fileId && objectTypes.length > 0 && (
          <div className="border rounded-md p-3 min-w-[180px] self-center">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Clusters</p>
            <div className={`flex items-center gap-2 ${!clusterInfo ? "opacity-40 pointer-events-none" : ""}`}>
              <Switch
                id="use-clusters"
                checked={useClusters && !!clusterInfo}
                onCheckedChange={v => { setUseClusters(v); if (v) { setClusterByOt(false); setSelectedMlpaLevel(null); } }}
                disabled={!clusterInfo}
              />
              <Label htmlFor="use-clusters" className="text-sm cursor-pointer">
                Use OrgaMining clusters
              </Label>
            </div>
            {clusterInfo && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {clusterInfo.nClusters} cluster{clusterInfo.nClusters !== 1 ? "s" : ""}
                {clusterInfo.hasOutliers ? " + outliers" : ""}
              </p>
            )}
            {!clusterInfo && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Compute clusters in Resource-Activity Matrix first.
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Switch
                id="cluster-by-ot"
                checked={clusterByOt}
                onCheckedChange={v => { setClusterByOt(v); if (v) setUseClusters(false); }}
              />
              <Label htmlFor="cluster-by-ot" className="text-sm cursor-pointer">
                Cluster by Object Type
              </Label>
            </div>
          </div>
        )}

        {fileId && objectTypes.length > 0 && (() => {
          const canCompute = method === "oc"
            ? resourceTypes.size > 0 && boTypes.size > 0
            : caseType !== "" && flatResourceType !== "";
          return (
            <div className="flex flex-col gap-3 items-center py-4">
              <div className="text-sm text-muted-foreground text-center">
                Click below when ready to start the computation.
              </div>
              <Button onClick={handleCompute} disabled={status === "loading" || !canCompute} className="min-w-[200px]">
                {status === "loading" ? "Computing…" : "Compute Handover"}
              </Button>
              {status === "loading" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                  Computing handover graph…
                </div>
              )}
            </div>
          );
        })()}

        {status === "error" && (
          <div className="text-sm text-destructive">Error: {errorMsg}</div>
        )}

        {status === "empty" && (
          <p className="text-sm text-muted-foreground">No handover edges found for this selection.</p>
        )}

        {status === "ready" && data && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant={viewMode === "graph" ? "default" : "outline"} onClick={() => setViewMode("graph")}>
                Graph
              </Button>
              <Button size="sm" variant={viewMode === "table" ? "default" : "outline"} onClick={() => setViewMode("table")}>
                Table
              </Button>
              <Button size="sm" variant={viewMode === "log" ? "default" : "outline"} onClick={() => setViewMode("log")}>
                Log
              </Button>
              </div>
              {viewMode === "graph" && method === "oc" && !selectedNode && (
                <div className="w-px h-5 bg-border self-center shrink-0" />
              )}
              {viewMode === "graph" && method === "oc" && !selectedNode && (
                <div className={`flex items-center border rounded-md overflow-hidden transition-all${flowsData && !selectedNode ? " flex-1 min-w-0" : ""}`}>
                  {/* Animate / Stop button */}
                  <button
                    className="flex items-center gap-1.5 h-8 px-3 text-sm font-medium hover:bg-accent transition-colors shrink-0 disabled:opacity-50"
                    onClick={flowsData
                      ? () => { setFlowsData(null); setFlowsStatus("idle"); }
                      : fetchFlows}
                    disabled={flowsStatus === "loading"}
                  >
                    {flowsStatus === "loading"
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : flowsData
                        ? <Square className="h-3.5 w-3.5" />
                        : <><Play className="h-3.5 w-3.5" /><span>Animate</span></>}
                  </button>
                  {/* Expanded playback controls */}
                  {flowsData && !selectedNode && (
                    <>
                      <div className="w-px h-5 bg-border self-center shrink-0" />
                      <button
                        className="flex items-center justify-center h-8 w-8 hover:bg-accent transition-colors shrink-0"
                        onClick={animIsPlaying ? () => animPauseRef.current?.() : () => animPlayRef.current?.()}
                        title={animIsPlaying ? "Pause" : "Play"}
                      >
                        {animIsPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex items-center text-xs border-l border-r w-20 pl-2 pr-1.5 h-8 hover:bg-accent transition-colors shrink-0 tabular-nums">
                            <span className="flex-1 text-center">{fmtSpeed(animPlaySpeed)}</span>
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuRadioGroup
                            value={String(animPlaySpeed)}
                            onValueChange={v => setAnimPlaySpeed(Number(v))}
                          >
                            {_SPEED_OPTIONS.map(s => (
                              <DropdownMenuRadioItem key={s} value={String(s)}>{s}×</DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex items-center text-xs border-l border-r w-24 pl-2 pr-1.5 h-8 hover:bg-accent transition-colors shrink-0">
                            <span className="flex-1 text-center capitalize">{connectorMode}</span>
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuRadioGroup value={connectorMode} onValueChange={v => setConnectorMode(v as "fade" | "persist" | "none")}>
                            <DropdownMenuRadioItem value="fade">Fade</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="persist">Persist</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <div className="flex-1 min-w-0 px-2 flex items-center">
                        <Slider
                          min={flowsData.timeline.start}
                          max={flowsData.timeline.end}
                          step={Math.max(1, (flowsData.timeline.end - flowsData.timeline.start) / 2000)}
                          value={[animSliderTime]}
                          onValueChange={([v]) => animScrubRef.current?.(v)}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0 whitespace-nowrap pr-2 inline-block w-32">
                        {new Date(animSliderTime * 1000).toLocaleDateString([], { month: "short", day: "2-digit", year: "2-digit" })}
                        {" "}
                        {new Date(animSliderTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 pr-3">
                        ({flowsData.flows.length.toLocaleString()} flows)
                      </span>
                    </>
                  )}
                </div>
              )}
              {viewMode === "graph" && method === "oc" && !selectedNode && (
                <button
                  className={`flex items-center gap-1.5 h-8 px-3 text-sm font-medium border rounded-md hover:bg-accent transition-colors shrink-0 disabled:opacity-50${bindingsData ? " bg-accent" : ""}`}
                  onClick={bindingsData
                    ? () => { setBindingsData(null); setBindingsStatus("idle"); }
                    : fetchBindings}
                  disabled={bindingsStatus === "loading"}
                  title="Show C-net bindings"
                >
                  {bindingsStatus === "loading"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <><Network className="h-3.5 w-3.5" />{!bindingsData && <span>Bindings</span>}</>}
                </button>
              )}
              {viewMode === "graph" && (
                <div ref={nodeSearchRef} className="relative shrink-0 ml-auto">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" style={{ width: 14, height: 14 }} />
                  <Input
                    className="h-8 pl-7 pr-3 text-xs w-72"
                    placeholder="Find resource…"
                    value={nodeSearch}
                    onChange={e => { setNodeSearch(e.target.value); setNodeSearchOpen(true); }}
                    onFocus={() => setNodeSearchOpen(true)}
                  />
                  {nodeSearchOpen && nodeSearch.trim() !== "" && (() => {
                    const q = nodeSearch.trim().toLowerCase();
                    const matches = visibleGraphNodes.filter(n => n.id.toLowerCase().includes(q) || n.object_type.toLowerCase().includes(q));
                    if (matches.length === 0) return null;
                    return (
                      <div className="absolute z-50 top-full mt-1 left-0 w-full rounded-md border bg-popover shadow-md overflow-y-auto" style={{ maxHeight: 260 }}>
                        {matches.map(n => (
                          <button
                            key={n.id}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2 truncate"
                            onMouseDown={e => {
                              e.preventDefault();
                              setSelectedNode(n.id);
                              setNodeSearch("");
                              setNodeSearchOpen(false);
                            }}
                          >
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: typeColorMap[n.object_type] ?? "#aaa" }} />
                            <span className="truncate">{n.id}</span>
                            <span className="ml-auto text-muted-foreground flex-shrink-0">{n.object_type}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div ref={resultsRef} style={lockedHeight ? { height: lockedHeight, overflow: "hidden" } : undefined}>
            {viewMode === "graph" && (
              <>
                <div style={selectedNode ? { display: "none" } : undefined}>
                  <HandoverGraph
                    nodes={data.nodes}
                    edges={data.edges}
                    typeColorMap={typeColorMap}
                    onNodeClick={setSelectedNode}
                    clusterInfo={useClusters ? clusterInfo ?? undefined : undefined}
                    positionsRef={graphPositionsRef}
                    savedViewBoxRef={graphViewBoxRef}
                    onVisibleNodesChange={setVisibleGraphNodes}
                    clustered={(useClusters && !!clusterInfo) || clusterByOt}
                    parallelFilter={{ enabled: parallelFilterEnabled, threshold: parallelThreshold, minObs: minParallelObs }}
                    normalization={normalization}
                    normalizationScope={normalizationScope}
                    maxGap={maxGap}
                    fileName={fileName}
                    flowsData={flowsData}
                    playSpeed={animPlaySpeed}
                    connectorMode={connectorMode}
                    onAnimStateChange={(s) => { setAnimIsPlaying(s.isPlaying); setAnimSliderTime(s.sliderTime); }}
                    playRef={animPlayRef}
                    pauseRef={animPauseRef}
                    scrubRef={animScrubRef}
                    bindingsData={bindingsData}
                  />
                </div>
                {selectedNode && (
                  <NodeDetailView
                    selectedNode={selectedNode}
                    data={data}
                    typeColorMap={typeColorMap}
                    onBack={() => setSelectedNode(null)}
                    clusterInfo={useClusters ? clusterInfo ?? undefined : undefined}
                  />
                )}
              </>
            )}

            {viewMode === "log" && (
              <EventLogTable logData={logData} logStatus={logStatus} logError={logError} typeColorMap={typeColorMap} lockedHeight={lockedHeight} />
            )}

            {viewMode === "table" && (
              <div className="overflow-auto rounded-md border" style={lockedHeight ? { maxHeight: lockedHeight } : undefined}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b bg-muted">
                      {(["source", "target", "bo_type", "count", "weight"] as SortCol[]).map((col, i) => {
                        const labels: Record<SortCol, string> = {
                          source: "Source", target: "Target", bo_type: "Business object type",
                          count: "Count", weight: "Weight",
                        };
                        const active = sortCol === col;
                        const Icon = active ? (sortDir === "desc" ? ArrowDown : ArrowUp) : ArrowUpDown;
                        return (
                          <th
                            key={col}
                            onClick={() => handleSort(col)}
                            className={`px-3 py-2 text-left font-medium cursor-pointer select-none hover:bg-muted/80${i === 4 ? " w-40" : ""}`}
                          >
                            <div className="flex items-center gap-1">
                              {labels[col]}
                              <Icon className={`h-3 w-3 flex-shrink-0${active ? "" : " opacity-30"}`} />
                            </div>
                          </th>
                        );
                      })}
                      <th className="px-3 py-2 text-left font-medium">Avg time</th>
                      <th className="px-3 py-2 text-left font-medium">Min time</th>
                      <th className="px-3 py-2 text-left font-medium">Max time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEdges.map((edge, i) => {
                      const color = typeColorMap[edge.businessobject_type] ?? "#94a3b8";
                      const denom = normalizationScope === "per_bo_type"
                        ? (weightDenominators[edge.businessobject_type] ?? 1)
                        : (weightDenominators._global ?? 1);
                      const barPct = denom > 0 ? (edge.weight / denom) * 100 : 0;
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
                              <span className="tabular-nums text-xs w-12 text-right">{edge.weight.toFixed(4)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 tabular-nums text-xs">{fmtDuration(edge.avg_time)}</td>
                          <td className="px-3 py-2 tabular-nums text-xs">{fmtDuration(edge.min_time)}</td>
                          <td className="px-3 py-2 tabular-nums text-xs">{fmtDuration(edge.max_time)}</td>
                        </tr>
                      );
                    })}
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

/* ── Duration formatter ─────────────────────────────────────── */
function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.round(Math.abs(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/* ── TypeSelector ───────────────────────────────────────────── */
function TypeSelector({
  title, types, selected, onToggle, disabled = false,
}: { title: string; types: string[]; selected: Set<string>; onToggle: (t: string) => void; disabled?: boolean }) {
  return (
    <div className={`border rounded-md p-3 min-w-[180px] ${disabled ? "opacity-60" : ""}`}>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">
        {types.map(t => (
          <div key={t} className="flex items-center gap-2">
            <Switch id={`${title}-${t}`} checked={selected.has(t)} onCheckedChange={() => onToggle(t)} disabled={disabled} />
            <Label htmlFor={`${title}-${t}`} className={`text-sm ${disabled ? "cursor-default" : "cursor-pointer"}`}>{t}</Label>
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

/* ── EventLogTable ──────────────────────────────────────────── */
function EventLogTable({
  logData, logStatus, logError, typeColorMap, lockedHeight,
}: {
  logData: EventLogData | null;
  logStatus: "idle" | "loading" | "ready" | "error";
  logError: string;
  typeColorMap: Record<string, string>;
  lockedHeight: number | null;
}) {
  if (logStatus === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 px-4">
        <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
        Loading event log…
      </div>
    );
  }
  if (logStatus === "error") {
    return <div className="text-sm text-destructive px-4 py-6">Error: {logError}</div>;
  }
  if (!logData) return null;

  const MAX_ROWS = 500;
  const truncated = logData.events.length > MAX_ROWS;
  const visibleEvents = truncated ? logData.events.slice(0, MAX_ROWS) : logData.events;

  const fmt = (ts: number | string) => {
    const d = new Date(typeof ts === "number" ? ts : ts);
    return isNaN(d.getTime()) ? String(ts) : d.toISOString().replace("T", " ").slice(0, 19);
  };

  return (
    <div className="space-y-2">
      {truncated && (
        <div className="text-xs text-muted-foreground px-1">
          Showing first {MAX_ROWS} of {logData.events.length} events — export the file to see the full log.
        </div>
      )}
      <div className="overflow-auto rounded-md border" style={lockedHeight ? { maxHeight: lockedHeight } : undefined}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted">
              <th className="px-3 py-2 text-left font-medium sticky top-0 left-0 bg-muted z-30 border-r whitespace-nowrap">Event</th>
              <th className="px-3 py-2 text-left font-medium sticky top-0 bg-muted z-20 whitespace-nowrap">Activity</th>
              <th className="px-3 py-2 text-left font-medium sticky top-0 bg-muted z-20 whitespace-nowrap">Timestamp</th>
              {logData.object_types.map(t => (
                <th key={t} className="px-3 py-2 text-left font-medium sticky top-0 bg-muted z-20 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ background: typeColorMap[t] ?? "#94a3b8" }} />
                    {t}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleEvents.map((ev, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2 font-mono font-medium sticky left-0 bg-background border-r whitespace-nowrap z-10">{ev.event_id}</td>
                <td className="px-3 py-2 whitespace-nowrap">{ev.activity}</td>
                <td className="px-3 py-2 font-mono text-xs tabular-nums whitespace-nowrap text-muted-foreground">{fmt(ev.timestamp)}</td>
                {logData.object_types.map(t => {
                  const objs = ev.objects[t] ?? [];
                  return (
                    <td key={t} className="px-3 py-2 whitespace-nowrap">
                      {objs.length === 0 ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        <span className="font-mono text-xs">{objs.join(", ")}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── HandoverGraph ──────────────────────────────────────────── */
type SimNode = SimulationNodeDatum & { id: string; object_type: string };
type SimLink = SimulationLinkDatum<SimNode>;

const CLUSTER_COLORS = ["#f43f5e","#f97316","#eab308","#22c55e","#06b6d4","#8b5cf6","#ec4899","#14b8a6"];

function updateDotLayer(
  layer: SVGGElement,
  pathMap: Map<string, SVGPathElement>,
  flows: FlowEvent[],
  currentTime: number,
  colorMap: Record<string, string>,
  connectorMode: "fade" | "persist" | "none",
): void {
  while (layer.firstChild) layer.removeChild(layer.firstChild);

  type DotEntry = { px: number; py: number; t: number; color: string };
  const dots: DotEntry[] = [];
  // Inverted index: bo_id → dot indices that carry it
  const boIndex = connectorMode !== "none" ? new Map<string, number[]>() : null;

  for (const flow of flows) {
    if (flow.start_time > currentTime || currentTime >= flow.start_time + flow.duration) continue;
    const pathEl = pathMap.get(`${flow.source}|${flow.target}|${flow.bo_type}`);
    if (!pathEl || !pathEl.isConnected) continue;
    const t = Math.min(1, (currentTime - flow.start_time) / flow.duration);
    const pt = pathEl.getPointAtLength(t * pathEl.getTotalLength());
    const idx = dots.length;
    dots.push({ px: pt.x, py: pt.y, t, color: colorMap[flow.bo_type] ?? "#94a3b8" });
    if (boIndex) {
      for (const bid of flow.bo_ids) {
        if (!boIndex.has(bid)) boIndex.set(bid, []);
        boIndex.get(bid)!.push(idx);
      }
    }
  }

  // Connected components: dots sharing any bo_id belong to the same group
  const componentOf = boIndex ? new Int32Array(dots.length).fill(-1) : null;
  if (boIndex && componentOf) {
    let nextId = 0;
    const merge = (a: number, b: number) => {
      const ca = componentOf[a], cb = componentOf[b];
      if (ca === -1 && cb === -1) { componentOf[a] = componentOf[b] = nextId++; }
      else if (ca === -1) { componentOf[a] = cb; }
      else if (cb === -1) { componentOf[b] = ca; }
      else if (ca !== cb) { for (let k = 0; k < componentOf.length; k++) if (componentOf[k] === cb) componentOf[k] = ca; }
    };
    for (const indices of boIndex.values()) {
      for (let i = 1; i < indices.length; i++) merge(indices[0], indices[i]);
    }
    for (let k = 0; k < componentOf.length; k++) if (componentOf[k] === -1) componentOf[k] = nextId++;
  }

  // Draw a polyline per connected component (dots sharing any bo_id).
  // Angular sort around the centroid gives a non-crossing open line.
  if (componentOf) {
    const FADE_T = 0.35;
    const groups = new Map<number, number[]>();
    for (let k = 0; k < dots.length; k++) {
      const c = componentOf[k];
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(k);
    }
    for (const indices of groups.values()) {
      if (indices.length < 2) continue;
      const avgT = indices.reduce((s: number, i: number) => s + dots[i].t, 0) / indices.length;
      let opacity: number;
      if (connectorMode === "fade") {
        opacity = Math.max(0, 1 - avgT / FADE_T);
        if (opacity <= 0) continue;
      } else {
        opacity = 0.6;
      }
      const cx = indices.reduce((s: number, i: number) => s + dots[i].px, 0) / indices.length;
      const cy = indices.reduce((s: number, i: number) => s + dots[i].py, 0) / indices.length;
      const byAngle = [...indices]
        .map(i => ({ i, a: Math.atan2(dots[i].py - cy, dots[i].px - cx) }))
        .sort((x, y) => x.a - y.a);
      let maxGap = -1, startIdx = 0;
      for (let k = 0; k < byAngle.length; k++) {
        const gap = ((byAngle[(k + 1) % byAngle.length].a - byAngle[k].a) + 2 * Math.PI) % (2 * Math.PI);
        if (gap > maxGap) { maxGap = gap; startIdx = (k + 1) % byAngle.length; }
      }
      const ordered = [...byAngle.slice(startIdx), ...byAngle.slice(0, startIdx)];
      const d = ordered.map(({ i }, k) => `${k === 0 ? "M" : "L"}${dots[i].px} ${dots[i].py}`).join(" ");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("stroke", dots[indices[0]].color);
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("fill", "none");
      path.setAttribute("opacity", String(opacity));
      path.setAttribute("pointer-events", "none");
      layer.appendChild(path);
    }
  }

  // Draw dots on top of connectors
  for (const { px, py, color } of dots) {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", String(px));
    c.setAttribute("cy", String(py));
    c.setAttribute("r", "6");
    c.setAttribute("fill", color);
    c.setAttribute("stroke", "white");
    c.setAttribute("stroke-width", "1.5");
    c.setAttribute("pointer-events", "none");
    layer.appendChild(c);
  }
}

function HandoverGraph({
  nodes,
  edges,
  typeColorMap,
  onNodeClick,
  clusterInfo,
  positionsRef,
  savedViewBoxRef,
  onVisibleNodesChange,
  clustered,
  parallelFilter,
  normalization,
  normalizationScope,
  maxGap,
  fileName,
  flowsData,
  playSpeed: playSpeedProp = 100,
  connectorMode: connectorModeProp = "fade" as const,
  onAnimStateChange,
  playRef,
  pauseRef,
  scrubRef,
  bindingsData,
}: {
  nodes: HandoverNode[];
  edges: HandoverEdge[];
  typeColorMap: Record<string, string>;
  onNodeClick?: (id: string) => void;
  clusterInfo?: ClusterInfo;
  positionsRef?: { current: Record<string, { x: number; y: number }> };
  savedViewBoxRef?: { current: { x: number; y: number; w: number; h: number } | null };
  onVisibleNodesChange?: (nodes: HandoverNode[]) => void;
  clustered?: boolean;
  parallelFilter?: { enabled: boolean; threshold: number; minObs: number };
  normalization?: Normalization;
  normalizationScope?: "global" | "per_bo_type";
  maxGap?: number | null;
  fileName?: string;
  flowsData?: FlowsData | null;
  playSpeed?: number;
  connectorMode?: "fade" | "persist" | "none";
  onAnimStateChange?: (s: { isPlaying: boolean; sliderTime: number }) => void;
  playRef?: React.RefObject<(() => void) | null>;
  pauseRef?: React.RefObject<(() => void) | null>;
  scrubRef?: React.RefObject<((t: number) => void) | null>;
  bindingsData?: BindingPattern[] | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [size, setSize] = useState({ width: 700, height: 450 });
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 700, h: 450 });
  const [minWeightStr, setMinWeightStr] = useState("0.00");
  const viewBoxRef = useRef(viewBox);
  useEffect(() => { viewBoxRef.current = viewBox; }, [viewBox]);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragHasMoved = useRef(false);
  const mouseDownPos = useRef({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; count: number; weight: number; avg_time: number | null; min_time: number | null; max_time: number | null } | null>(null);
  const [nodeTooltip, setNodeTooltip] = useState<{ x: number; y: number; nodeId: string; pinned: boolean; cw: number; ch: number } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = () => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; } };
  const scheduleHide = () => { hideTimerRef.current = setTimeout(() => setNodeTooltip(t => t?.pinned ? t : null), 150); };

  // ── Animation state & refs ────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [sliderTime, setSliderTime] = useState(0);
  const playSpeedRef = useRef(100);
  useEffect(() => { playSpeedRef.current = playSpeedProp; }, [playSpeedProp]);
  const connectorModeRef = useRef<"fade" | "persist" | "none">(connectorModeProp);
  useEffect(() => { connectorModeRef.current = connectorModeProp; }, [connectorModeProp]);
  const playheadTimeRef = useRef(0);
  const lastWallClockRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const dotsLayerRef = useRef<SVGGElement>(null);
  const bindingsLayerRef = useRef<SVGGElement>(null);
  const pathMapRef = useRef<Map<string, SVGPathElement>>(new Map());
  const frameCountRef = useRef(0);

  // Sync local animation state to parent toolbar
  useEffect(() => { onAnimStateChange?.({ isPlaying, sliderTime }); }, [isPlaying, sliderTime]);

  // Cancel animation on unmount
  useEffect(() => () => { if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current); }, []);

  // Reset animation state when flowsData changes
  useEffect(() => {
    if (animFrameRef.current !== null) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    setIsPlaying(false);
    lastWallClockRef.current = null;
    const start = flowsData?.timeline.start ?? 0;
    playheadTimeRef.current = start;
    setSliderTime(start);
    const layer = dotsLayerRef.current;
    if (layer) while (layer.firstChild) layer.removeChild(layer.firstChild);
  }, [flowsData]);

  // Rebuild path lookup map after edges are re-rendered in the DOM (must run before binding layer)
  useLayoutEffect(() => {
    if (!svgRef.current) return;
    const map = new Map<string, SVGPathElement>();
    svgRef.current.querySelectorAll<SVGPathElement>("[data-flow-edge]").forEach(el => {
      const key = el.getAttribute("data-flow-edge")!;
      map.set(key, el);
    });
    pathMapRef.current = map;
  });

  // Render C-net binding overlay imperatively so we can use getPointAtLength on live SVG paths
  useLayoutEffect(() => {
    const layer = bindingsLayerRef.current;
    if (!layer) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    if (!bindingsData || bindingsData.length === 0) return;

    const NS = "http://www.w3.org/2000/svg";
    const pathMap = pathMapRef.current;
    const BASE = 18;      // px from node boundary along edge path to first slot
    const SLOT_STEP = 11; // px between slots for multiple bindings on same arc
    const DOT_R = 4;      // circle mark radius
    const SQ_SZ = 4.5;   // half-size of square mark

    for (const side of ["output", "input"] as const) {
      // Process solos (arcs.length === 1) first so they occupy the inner slots
      const bindings = [...bindingsData.filter(b => b.type === side)]
        .sort((a, b) => a.arcs.length - b.arcs.length);

      // Per-node slot counter: each binding at a node gets a unique slot → unique radius.
      // This prevents solo dots from landing at the same radius as a multi-arc ring.
      const nodeNextSlot = new Map<string, number>();

      for (const binding of bindings) {
        const isOutput = side === "output";

        const pathKeys = binding.arcs.map(arc =>
          isOutput
            ? `${binding.resource}|${arc.other_resource}|${arc.bo_type}`
            : `${arc.other_resource}|${binding.resource}|${arc.bo_type}`
        );

        const slot = nodeNextSlot.get(binding.resource) ?? 0;
        nodeNextSlot.set(binding.resource, slot + 1);

        // totalR = nodeRadius + BASE + slot*SLOT_STEP, measured from node center.
        // Computed from the first non-self-loop path (self-loop paths can't reliably
        // give node radius since they start and end at the same node).
        const slotOffset = BASE + slot * SLOT_STEP;
        const nodePos = positions[binding.resource];
        let totalR = slotOffset;
        if (nodePos) {
          const { x: cx0, y: cy0 } = nodePos;
          for (let i = 0; i < pathKeys.length; i++) {
            if (binding.arcs[i].other_resource === binding.resource) continue; // skip self-loops
            const p = pathMap.get(pathKeys[i]);
            if (!p) continue;
            const plen = p.getTotalLength();
            const ptB = p.getPointAtLength(isOutput ? 0 : plen);
            totalR = Math.sqrt((ptB.x - cx0) ** 2 + (ptB.y - cy0) ** 2) + slotOffset;
            break;
          }
        }

        // Dot positions.
        // Regular edges: project at fixed totalR from node center along the edge direction,
        //   so every dot is exactly on the arc.
        // Self-loops: follow the path at slotOffset from the endpoint — the path curves
        //   back to the same node so there is no meaningful radial direction to project along.
        const dots: { x: number; y: number; angle: number; color: string; is_gapped: boolean; mark: "dot" | "square" }[] = [];
        for (let i = 0; i < pathKeys.length; i++) {
          const path = pathMap.get(pathKeys[i]);
          if (!path) continue;
          const len = path.getTotalLength();
          const isSelfLoop = binding.arcs[i].other_resource === binding.resource;

          let px: number, py: number, angle: number;
          if (nodePos && !isSelfLoop) {
            const { x: cx, y: cy } = nodePos;
            const ptBoundary = path.getPointAtLength(isOutput ? 0 : len);
            angle = Math.atan2(ptBoundary.y - cy, ptBoundary.x - cx);
            px = cx + totalR * Math.cos(angle);
            py = cy + totalR * Math.sin(angle);
          } else {
            // Self-loop or no node position: place dot on the path
            const offset = Math.min(slotOffset, len * 0.45);
            const pt = path.getPointAtLength(isOutput ? offset : len - offset);
            px = pt.x; py = pt.y;
            angle = nodePos ? Math.atan2(pt.y - nodePos.y, pt.x - nodePos.x) : 0;
          }
          dots.push({ x: px, y: py, angle, color: typeColorMap[binding.arcs[i].bo_type] ?? "#555", is_gapped: binding.arcs[i].is_gapped, mark: binding.arcs[i].mark });
        }
        if (dots.length === 0) continue;

        // Connector: circular arc centred at node at exactly totalR.
        // Largest-gap sort so we sweep the short arc.
        if (dots.length >= 2 && nodePos) {
          const { x: cx, y: cy } = nodePos;
          const sorted = [...dots].sort((a, b) => a.angle - b.angle);
          const n = sorted.length;
          let maxGap = -1, gapIdx = 0;
          for (let i = 0; i < n; i++) {
            const gap = ((sorted[(i + 1) % n].angle - sorted[i].angle) + 2 * Math.PI) % (2 * Math.PI);
            if (gap > maxGap) { maxGap = gap; gapIdx = i; }
          }
          const startIdx = (gapIdx + 1) % n;
          const ordered = [...sorted.slice(startIdx), ...sorted.slice(0, startIdx)];
          const first = ordered[0], last = ordered[ordered.length - 1];
          const sx = cx + totalR * Math.cos(first.angle), sy = cy + totalR * Math.sin(first.angle);
          const ex = cx + totalR * Math.cos(last.angle),  ey = cy + totalR * Math.sin(last.angle);
          const arcSpan = ((last.angle - first.angle) + 2 * Math.PI) % (2 * Math.PI);
          const largeArc = arcSpan > Math.PI ? 1 : 0;
          const color = typeColorMap[binding.arcs[0].bo_type] ?? "#888";
          const arc = document.createElementNS(NS, "path");
          arc.setAttribute("d", `M${sx.toFixed(1)} ${sy.toFixed(1)} A${totalR.toFixed(1)} ${totalR.toFixed(1)} 0 ${largeArc} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`);
          arc.setAttribute("fill", "none");
          arc.setAttribute("stroke", color);
          arc.setAttribute("stroke-width", "1.5");
          arc.setAttribute("stroke-linecap", "round");
          arc.setAttribute("stroke-dasharray", binding.line_type === "dotted" ? "4 3" : "none");
          arc.setAttribute("opacity", "0.9");
          layer.appendChild(arc);
        }

        // Marks: filled = direct, hollow ring = gapped; circle = dot, square = square
        // Each mark is rendered as a white halo first, then the colored shape on top.
        const HALO = 2;
        for (const dot of dots) {
          if (dot.mark === "square") {
            const halo = document.createElementNS(NS, "rect");
            halo.setAttribute("x", (dot.x - SQ_SZ - HALO).toFixed(1));
            halo.setAttribute("y", (dot.y - SQ_SZ - HALO).toFixed(1));
            halo.setAttribute("width", ((SQ_SZ + HALO) * 2).toFixed(1));
            halo.setAttribute("height", ((SQ_SZ + HALO) * 2).toFixed(1));
            halo.setAttribute("fill", "white");
            halo.setAttribute("opacity", "0.85");
            layer.appendChild(halo);
            const rect = document.createElementNS(NS, "rect");
            rect.setAttribute("x", (dot.x - SQ_SZ).toFixed(1));
            rect.setAttribute("y", (dot.y - SQ_SZ).toFixed(1));
            rect.setAttribute("width", (SQ_SZ * 2).toFixed(1));
            rect.setAttribute("height", (SQ_SZ * 2).toFixed(1));
            rect.setAttribute("fill", dot.is_gapped ? "white" : dot.color);
            rect.setAttribute("stroke", dot.color);
            rect.setAttribute("stroke-width", dot.is_gapped ? "1.5" : "1");
            rect.setAttribute("opacity", "0.95");
            layer.appendChild(rect);
          } else {
            const halo = document.createElementNS(NS, "circle");
            halo.setAttribute("cx", dot.x.toFixed(1));
            halo.setAttribute("cy", dot.y.toFixed(1));
            halo.setAttribute("r", String(DOT_R + HALO));
            halo.setAttribute("fill", "white");
            halo.setAttribute("opacity", "0.85");
            layer.appendChild(halo);
            const circle = document.createElementNS(NS, "circle");
            circle.setAttribute("cx", dot.x.toFixed(1));
            circle.setAttribute("cy", dot.y.toFixed(1));
            circle.setAttribute("r", String(DOT_R));
            circle.setAttribute("fill", dot.is_gapped ? "white" : dot.color);
            circle.setAttribute("stroke", dot.color);
            circle.setAttribute("stroke-width", dot.is_gapped ? "1.5" : "1");
            circle.setAttribute("opacity", "0.95");
            layer.appendChild(circle);
          }
        }
      }
    }
  });

  const playAnimation = () => {
    if (!flowsData || isPlaying) return;
    if (playheadTimeRef.current >= flowsData.timeline.end) {
      playheadTimeRef.current = flowsData.timeline.start;
      setSliderTime(flowsData.timeline.start);
    }
    setIsPlaying(true);
    lastWallClockRef.current = null;
    const fd = flowsData;
    const tcm = typeColorMap;
    const tick = (wallNow: number) => {
      if (lastWallClockRef.current === null) lastWallClockRef.current = wallNow;
      const wallDelta = (wallNow - lastWallClockRef.current) / 1000;
      lastWallClockRef.current = wallNow;
      const newTime = Math.min(playheadTimeRef.current + wallDelta * playSpeedRef.current, fd.timeline.end);
      playheadTimeRef.current = newTime;
      const layer = dotsLayerRef.current;
      if (layer) updateDotLayer(layer, pathMapRef.current, fd.flows, newTime, tcm, connectorModeRef.current);
      frameCountRef.current = (frameCountRef.current + 1) % 4;
      if (frameCountRef.current === 0) setSliderTime(newTime);
      if (newTime < fd.timeline.end) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
        setSliderTime(newTime);
      }
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const pauseAnimation = () => {
    if (animFrameRef.current !== null) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    setIsPlaying(false);
    lastWallClockRef.current = null;
  };

  const scrubTo = (time: number) => {
    playheadTimeRef.current = time;
    setSliderTime(time);
    const layer = dotsLayerRef.current;
    if (layer && flowsData) updateDotLayer(layer, pathMapRef.current, flowsData.flows, time, typeColorMap, connectorModeRef.current);
  };

  // Expose animation functions to parent toolbar via refs
  if (playRef) playRef.current = playAnimation;
  if (pauseRef) pauseRef.current = pauseAnimation;
  if (scrubRef) scrubRef.current = scrubTo;
  // ─────────────────────────────────────────────────────────────

  const [filterOpen, setFilterOpen] = useState(false);
  const [centralityOpen, setCentralityOpen] = useState(false);
  const [selectedCentrality, setSelectedCentrality] = useState<"in-degree" | "out-degree" | "both-degree" | "closeness" | "betweenness" | null>(null);
  const [timeMetricOpen, setTimeMetricOpen] = useState(false);
  const [selectedTimeMetric, setSelectedTimeMetric] = useState<"max" | "min" | "avg" | "range" | null>(null);
  const [highlightedObjectType, setHighlightedObjectType] = useState<string | null>(null);
  const [typePercentages, setTypePercentages] = useState<Record<string, number>>({});
  const [nodeSearch, setNodeSearch] = useState("");
  const [checkedNodes, setCheckedNodes] = useState<Set<string>>(() => new Set(nodes.map(n => n.id)));
  const [selectedTypeFilters, setSelectedTypeFilters] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCheckedNodes(new Set(nodes.map(n => n.id)));
    setTypePercentages({});
    setSelectedTypeFilters(new Set());
  }, [nodes]);

  const percentagePassingIds = useMemo(() => {
    const byType: Record<string, HandoverNode[]> = {};
    for (const node of nodes) {
      if (!byType[node.object_type]) byType[node.object_type] = [];
      byType[node.object_type].push(node);
    }
    const passing = new Set<string>();
    for (const [ot, typeNodes] of Object.entries(byType)) {
      const pct = typePercentages[ot] ?? 100;
      if (pct >= 100) { typeNodes.forEach(n => passing.add(n.id)); continue; }
      const k = Math.max(0, Math.ceil(pct / 100 * typeNodes.length));
      if (k === 0) continue;
      const sorted = [...typeNodes].sort((a, b) => b.event_count - a.event_count);
      const threshold = sorted[k - 1].event_count;
      typeNodes.forEach(n => { if (n.event_count >= threshold) passing.add(n.id); });
    }
    return passing;
  }, [nodes, typePercentages]);

  const filteredNodeIds = useMemo(
    () => new Set([...percentagePassingIds].filter(id => checkedNodes.has(id))),
    [percentagePassingIds, checkedNodes],
  );

  const filterActive = filteredNodeIds.size < nodes.length;
  const hiddenCount = nodes.length - filteredNodeIds.size;

  useEffect(() => {
    if (onVisibleNodesChange) onVisibleNodesChange(nodes.filter(n => filteredNodeIds.has(n.id)));
  }, [filteredNodeIds, nodes, onVisibleNodesChange]);

  const searchedNodes = useMemo(
    () => nodes.filter(n =>
      percentagePassingIds.has(n.id) &&
      (selectedTypeFilters.size === 0 || selectedTypeFilters.has(n.object_type)) &&
      (!nodeSearch.trim() || n.id.toLowerCase().includes(nodeSearch.toLowerCase()))
    ),
    [nodes, nodeSearch, percentagePassingIds, selectedTypeFilters],
  );



  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setNodeTooltip(null); setFilterOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); cancelHide(); };
  }, []);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.getBoundingClientRect().width || 700;
    setSize({ width: w, height: Math.max(400, w * 0.62) });
  }, []);

  // Sync dragged positions back to the ref so they survive unmount
  useEffect(() => {
    if (positionsRef && Object.keys(positions).length > 0) positionsRef.current = positions;
  }, [positions, positionsRef]);

  // Force simulation — re-run when nodes/edges/size change
  useEffect(() => {
    if (nodes.length === 0) return;

    // Restore saved positions if they cover all current nodes (e.g. returning from ego view)
    const saved = positionsRef?.current ?? {};
    if (nodes.every(n => saved[n.id])) {
      setPositions({ ...saved });
      // Restore the viewBox the user had before unmounting (preserves zoom/pan)
      if (savedViewBoxRef?.current) setViewBox(savedViewBoxRef.current);
      return;
    }

    const { width, height } = size;
    const cx = width / 2, cy = height / 2;

    // Weighted degree: sum of edge weights incident to each node
    const degree: Record<string, number> = {};
    nodes.forEach(n => { degree[n.id] = 0; });
    edges.forEach(e => {
      degree[e.source] = (degree[e.source] ?? 0) + e.raw_weight;
      degree[e.target] = (degree[e.target] ?? 0) + e.raw_weight;
    });
    const maxDeg = Math.max(...Object.values(degree), 1);

    // Initialise high-degree nodes near centre, low-degree near perimeter
    const maxR = Math.min(width, height) * 0.54;
    const simNodes: SimNode[] = nodes.map(n => {
      const norm = degree[n.id] / maxDeg;         // 0 = leaf, 1 = hub
      const r = (1 - norm) * maxR;
      const angle = Math.random() * 2 * Math.PI;
      return {
        id: n.id,
        object_type: n.object_type,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      };
    });

    const nodeById: Record<string, SimNode> = {};
    simNodes.forEach(n => { nodeById[n.id] = n; });

    const simLinks: SimLink[] = edges
      .filter(e => nodeById[e.source] && nodeById[e.target])
      .map(e => ({ source: nodeById[e.source], target: nodeById[e.target] }));

    const sim = forceSimulation<SimNode>(simNodes)
      .force("link", forceLink<SimNode, SimLink>(simLinks).distance(190).strength(0.4))
      .force("charge", forceManyBody<SimNode>().strength(-900))
      .force("center", forceCenter(cx, cy))
      .force("collide", forceCollide<SimNode>(NODE_R + 18))
      // Pull each node toward a radius proportional to (1 - normDegree):
      // hubs → r≈0 (centre), leaves → r≈maxR (perimeter)
      .force("radial", forceRadial<SimNode>(
        n => (1 - degree[n.id] / maxDeg) * maxR,
        cx, cy,
      ).strength(0.25));

    for (let i = 0; i < 500; i++) sim.tick();
    sim.stop();

    const pos: Record<string, { x: number; y: number }> = {};
    simNodes.forEach(n => {
      pos[n.id] = {
        x: Math.max(NODE_R + 4, Math.min(width - NODE_R - 4, n.x ?? width / 2)),
        y: Math.max(NODE_R + 4, Math.min(height - NODE_R - 4, n.y ?? height / 2)),
      };
    });
    if (positionsRef) positionsRef.current = pos;
    setPositions(pos);
    const fxs = Object.values(pos).map(p => p.x);
    const fys = Object.values(pos).map(p => p.y);
    const fpad = NODE_R + 20;
    const fminX = Math.min(...fxs) - fpad, fmaxX = Math.max(...fxs) + fpad;
    const fminY = Math.min(...fys) - fpad, fmaxY = Math.max(...fys) + fpad;
    const MIN_VB = NODE_R * 10;
    let fw = Math.max((fmaxX - fminX) * 1.15, MIN_VB), fh = Math.max((fmaxY - fminY) * 1.15, MIN_VB);
    const ratio = size.width / (size.height || 1);
    if (fw / fh < ratio) fw = fh * ratio; else fh = fw / ratio;
    const computedVb = { x: fminX - (fw - (fmaxX - fminX)) / 2, y: fminY - (fh - (fmaxY - fminY)) / 2, w: fw, h: fh };
    setViewBox(computedVb);
    if (savedViewBoxRef) savedViewBoxRef.current = computedVb;
  }, [nodes, edges, size]);

  const minWeightVal = useMemo(() => Math.max(0, parseFloat(minWeightStr.replace(",", ".")) || 0), [minWeightStr]);
  const visibleEdges = useMemo(() => {
    let result = minWeightVal <= 0 ? edges : edges.filter(e => Math.round(e.weight * 10000) / 10000 >= minWeightVal);
    if (filteredNodeIds.size < nodes.length) result = result.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target));
    return result;
  }, [edges, minWeightVal, filteredNodeIds, nodes.length]);

  // Centrality scores — only computed when the user selects a measure
  const centralityScores = useMemo<Map<string, number> | null>(() => {
    if (!selectedCentrality) return null;
    const nodeIds = Array.from(filteredNodeIds);
    const n = nodeIds.length;
    if (n < 2) return null;

    const adj = new Map<string, Set<string>>();   // out-edges
    const inAdj = new Map<string, Set<string>>(); // in-edges
    nodeIds.forEach(id => { adj.set(id, new Set()); inAdj.set(id, new Set()); });
    const seen = new Set<string>();
    visibleEdges.forEach(e => {
      if (e.source === e.target) return;
      const key = `${e.source}\x00${e.target}`;
      if (seen.has(key)) return;
      seen.add(key);
      adj.get(e.source)?.add(e.target);
      inAdj.get(e.target)?.add(e.source);
    });

    const scores = new Map<string, number>();

    if (selectedCentrality === "in-degree") {
      nodeIds.forEach(id => scores.set(id, (inAdj.get(id)?.size ?? 0) / (n - 1)));
    } else if (selectedCentrality === "out-degree") {
      nodeIds.forEach(id => scores.set(id, (adj.get(id)?.size ?? 0) / (n - 1)));
    } else if (selectedCentrality === "both-degree") {
      nodeIds.forEach(id => {
        const both = new Set([...inAdj.get(id)!, ...adj.get(id)!]);
        scores.set(id, both.size / (n - 1));
      });

    } else if (selectedCentrality === "closeness") {
      nodeIds.forEach(src => {
        const dist = new Map<string, number>([[src, 0]]);
        const queue = [src]; let i = 0;
        while (i < queue.length) {
          const u = queue[i++];
          adj.get(u)!.forEach(v => { if (!dist.has(v)) { dist.set(v, dist.get(u)! + 1); queue.push(v); } });
        }
        const reachable = dist.size - 1;
        if (reachable === 0) { scores.set(src, 0); return; }
        const sumDist = Array.from(dist.values()).reduce((a, b) => a + b, 0);
        scores.set(src, (reachable / (n - 1)) * (reachable / sumDist));
      });

    } else {
      // Brandes betweenness (undirected)
      nodeIds.forEach(id => scores.set(id, 0));
      nodeIds.forEach(src => {
        const stack: string[] = [];
        const pred = new Map<string, string[]>(); nodeIds.forEach(id => pred.set(id, []));
        const sigma = new Map<string, number>([[src, 1]]);
        const dist = new Map<string, number>([[src, 0]]);
        const queue = [src]; let i = 0;
        while (i < queue.length) {
          const v = queue[i++]; stack.push(v);
          adj.get(v)!.forEach(w => {
            if (!dist.has(w)) { dist.set(w, dist.get(v)! + 1); queue.push(w); }
            if (dist.get(w) === dist.get(v)! + 1) {
              sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 0));
              pred.get(w)!.push(v);
            }
          });
        }
        const delta = new Map<string, number>();
        while (stack.length) {
          const w = stack.pop()!;
          pred.get(w)!.forEach(v => {
            delta.set(v, (delta.get(v) ?? 0) + ((sigma.get(v) ?? 0) / (sigma.get(w) ?? 1)) * (1 + (delta.get(w) ?? 0)));
          });
          if (w !== src) scores.set(w, scores.get(w)! + (delta.get(w) ?? 0));
        }
      });
      const norm = n > 2 ? 1 / ((n - 1) * (n - 2)) : 1;
      nodeIds.forEach(id => scores.set(id, scores.get(id)! * norm));
    }

    const maxVal = Math.max(...Array.from(scores.values()));
    if (maxVal > 0) nodeIds.forEach(id => scores.set(id, scores.get(id)! / maxVal));
    return scores;
  }, [selectedCentrality, filteredNodeIds, visibleEdges]);

  // Edge time scores — only computed when the user selects a time metric
  const edgeTimeScores = useMemo<Map<string, number> | null>(() => {
    if (!selectedTimeMetric) return null;
    const getRaw = (e: HandoverEdge): number | null => {
      if (selectedTimeMetric === "max") return e.max_time;
      if (selectedTimeMetric === "min") return e.min_time;
      if (selectedTimeMetric === "avg") return e.avg_time;
      if (e.max_time != null && e.min_time != null) return e.max_time - e.min_time;
      return null;
    };
    const raw = new Map<string, number>();
    visibleEdges.forEach(e => {
      const key = `${e.source}\x00${e.target}\x00${e.businessobject_type}`;
      const v = getRaw(e);
      if (v != null) raw.set(key, v);
    });
    const maxVal = Math.max(0, ...Array.from(raw.values()));
    const scores = new Map<string, number>();
    visibleEdges.forEach(e => {
      const key = `${e.source}\x00${e.target}\x00${e.businessobject_type}`;
      scores.set(key, maxVal > 0 ? (raw.get(key) ?? 0) / maxVal : 0);
    });
    return scores;
  }, [selectedTimeMetric, visibleEdges]);

  // Detect which pairs have a reverse edge
  const reverseSet = useMemo(() => {
    const s = new Set(visibleEdges.map(e => `${e.source}\x00${e.target}`));
    return (u: string, v: string) => s.has(`${v}\x00${u}`);
  }, [visibleEdges]);

  // Group edges by directed pair
  const edgeGroups = useMemo(() => {
    const g = new Map<string, HandoverEdge[]>();
    visibleEdges.forEach(e => {
      const key = `${e.source}\x00${e.target}`;
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(e);
    });
    return g;
  }, [visibleEdges]);

  const maxWeight = useMemo(() => Math.max(...edges.map(e => e.weight), 0.0001), [edges]);

  const maxWeightPerType = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of edges) m[e.businessobject_type] = Math.max(m[e.businessobject_type] ?? 0.0001, e.weight);
    return m;
  }, [edges]);

  const boTypes = useMemo(() => [...new Set(edges.map(e => e.businessobject_type))], [edges]);
  const nodeTypes = useMemo(() => [...new Set(nodes.map(n => n.object_type))], [nodes]);
  // header ~37px, slider row ~30px, slider overhead ~37px, bottom (search+chips+all/none+checklist) ~290px
  const filterPanelHeight = 37 + (clustered ? 0 : 37 + nodeTypes.length * 30) + 290;

  // Pre-compute all edge paths
  const edgePaths = useMemo(() => {
    if (Object.keys(positions).length === 0) return [];

    const result: Array<{
      key: string;
      d: string;
      color: string;
      strokeWidth: number;
      markerId: string;
      count: number;
      weight: number;
      avg_time: number | null;
      min_time: number | null;
      max_time: number | null;
      businessobject_type: string;
      source: string;
      target: string;
    }> = [];

    const strokeFor = (w: number, boType?: string) => {
      const denom = normalizationScope === "per_bo_type" && boType
        ? (maxWeightPerType[boType] ?? maxWeight)
        : maxWeight;
      return Math.max(0.3, (w / denom) * 6);
    };

    edgeGroups.forEach((groupEdges, pairKey) => {
      const [srcId, tgtId] = pairKey.split("\x00");
      const src = positions[srcId];
      const tgt = positions[tgtId];
      if (!src || !tgt) return;

      // ── Self-loop ──────────────────────────────────────────
      if (srcId === tgtId) {
        groupEdges.forEach((edge, idx) => {
          const color = typeColorMap[edge.businessobject_type] ?? "#94a3b8";
          const markerId = `arrow-${edge.businessobject_type.replace(/[^a-zA-Z0-9]/g, "_")}`;
          const strokeWidth = strokeFor(edge.weight, edge.businessobject_type);

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
            color, strokeWidth, markerId, count: edge.raw_weight, weight: edge.weight,
            avg_time: edge.avg_time, min_time: edge.min_time, max_time: edge.max_time,
            businessobject_type: edge.businessobject_type, source: srcId, target: tgtId,
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
        const color = typeColorMap[edge.businessobject_type] ?? "#94a3b8";
        const markerId = `arrow-${edge.businessobject_type.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const strokeWidth = strokeFor(edge.weight, edge.businessobject_type);

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

        result.push({ key: `${pairKey}-${edge.businessobject_type}-${idx}`, d, color, strokeWidth, markerId, count: edge.raw_weight, weight: edge.weight, avg_time: edge.avg_time, min_time: edge.min_time, max_time: edge.max_time, businessobject_type: edge.businessobject_type, source: srcId, target: tgtId });
      });
    });

    return result;
  }, [positions, edgeGroups, reverseSet, typeColorMap, maxWeight, maxWeightPerType, normalizationScope]);

  const zoomIn = () => {
    const vb = viewBoxRef.current;
    const nw = vb.w / 1.25, nh = vb.h / 1.25;
    const newVb = { x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - nh) / 2, w: nw, h: nh };
    setViewBox(newVb);
    if (savedViewBoxRef) savedViewBoxRef.current = newVb;
  };

  const zoomOut = () => {
    const vb = viewBoxRef.current;
    const nw = vb.w * 1.25, nh = vb.h * 1.25;
    const newVb = { x: vb.x - (nw - vb.w) / 2, y: vb.y - (nh - vb.h) / 2, w: nw, h: nh };
    setViewBox(newVb);
    if (savedViewBoxRef) savedViewBoxRef.current = newVb;
  };

  const fitToView = () => {
    let newVb: { x: number; y: number; w: number; h: number };
    if (Object.keys(positions).length === 0) {
      newVb = { x: 0, y: 0, w: size.width, h: size.height };
    } else {
      const xs = Object.values(positions).map(p => p.x);
      const ys = Object.values(positions).map(p => p.y);
      const pad = NODE_R + 20;
      const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
      const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      // Minimum size ensures self-loops (which arch ~NODE_R*2.4 above the node) remain visible.
      const MIN_VB = NODE_R * 10;
      let w = Math.max((maxX - minX) * 1.15, MIN_VB);
      let h = Math.max((maxY - minY) * 1.15, MIN_VB);
      const ratio = size.width / (size.height || 1);
      if (w / h < ratio) w = h * ratio; else h = w / ratio;
      newVb = { x: cx - w / 2, y: cy - h / 2, w, h };
    }
    setViewBox(newVb);
    if (savedViewBoxRef) savedViewBoxRef.current = newVb;
  };

  // Node drag handlers
  const handleNodeMouseDown = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    setNodeTooltip(null);
    const pos = positions[id];
    if (!pos) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vb = viewBoxRef.current;
    const userX = (e.clientX - rect.left) * (vb.w / rect.width) + vb.x;
    const userY = (e.clientY - rect.top) * (vb.h / rect.height) + vb.y;
    dragOffset.current = { x: userX - pos.x, y: userY - pos.y };
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
    dragHasMoved.current = false;
    setDragId(id);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragId) return;
    if (Math.hypot(e.clientX - mouseDownPos.current.x, e.clientY - mouseDownPos.current.y) > 4)
      dragHasMoved.current = true;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vb = viewBoxRef.current;
    const userX = (e.clientX - rect.left) * (vb.w / rect.width) + vb.x;
    const userY = (e.clientY - rect.top) * (vb.h / rect.height) + vb.y;
    setPositions(prev => ({
      ...prev,
      [dragId]: {
        x: Math.max(vb.x + NODE_R, Math.min(vb.x + vb.w - NODE_R, userX - dragOffset.current.x)),
        y: Math.max(vb.y + NODE_R, Math.min(vb.y + vb.h - NODE_R, userY - dragOffset.current.y)),
      },
    }));
  };

  const handleMouseUp = () => setDragId(null);

  const downloadGraph = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const EXPORT_W = 1600;
    const vb = viewBoxRef.current;
    const GRAPH_H = Math.round(EXPORT_W * (vb.h / vb.w));

    const PAD = 28;
    const ROW_H = 20;
    const HEADER_H = 32;

    // Three-column boundaries
    const LEG_END = Math.round(EXPORT_W * 0.37);   // ~592
    const SET_X   = LEG_END + 24;                   // ~616
    const SET_END  = Math.round(EXPORT_W * 0.60);   // ~960
    const FILT_X   = SET_END + 24;                  // ~984

    // Dynamic panel height: header + max(legend, settings, filters) rows
    const scaleRows = normalizationScope === "per_bo_type" ? boTypes.length : 1;
    const LEGEND_ROWS = 1 + nodeTypes.length + 0.5 + 1 + boTypes.length + 0.5 + 1 + scaleRows; // res header + items + gap + bot header + items + gap + scale header + scale row(s)
    const SETTINGS_ROWS = 5;  // header + 4 items
    const FILTER_ROWS   = 9;  // header + 8 items
    const CONTENT_ROWS  = Math.ceil(Math.max(LEGEND_ROWS, SETTINGS_ROWS, FILTER_ROWS));
    const PANEL_H = HEADER_H + PAD + CONTENT_ROWS * ROW_H + PAD;
    const TOTAL_H = GRAPH_H + PANEL_H;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(EXPORT_W));
    clone.setAttribute("height", String(GRAPH_H));
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", String(vb.x)); bg.setAttribute("y", String(vb.y));
    bg.setAttribute("width", String(vb.w)); bg.setAttribute("height", String(vb.h));
    bg.setAttribute("fill", "white");
    clone.insertBefore(bg, clone.firstChild);

    const svgStr = new XMLSerializer().serializeToString(clone);
    const svgUrl = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));

    const img = new Image();
    img.onload = () => {
      const DPR = 2;
      const canvas = document.createElement("canvas");
      canvas.width = EXPORT_W * DPR; canvas.height = TOTAL_H * DPR;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(DPR, DPR);

      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, EXPORT_W, TOTAL_H);
      ctx.drawImage(img, 0, 0, EXPORT_W, GRAPH_H);
      URL.revokeObjectURL(svgUrl);

      const FONT = "-apple-system, BlinkMacSystemFont, sans-serif";

      // ── Header strip ──
      ctx.fillStyle = "#F1F5F9";
      ctx.fillRect(0, GRAPH_H, EXPORT_W, HEADER_H);
      ctx.strokeStyle = "#E2E8F0"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, GRAPH_H); ctx.lineTo(EXPORT_W, GRAPH_H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, GRAPH_H + HEADER_H); ctx.lineTo(EXPORT_W, GRAPH_H + HEADER_H); ctx.stroke();

      const hMid = GRAPH_H + HEADER_H / 2 + 4;
      if (fileName) {
        ctx.font = `bold 13px ${FONT}`; ctx.fillStyle = "#0F172A";
        ctx.fillText(fileName, PAD, hMid);
      }
      ctx.font = `12px ${FONT}`; ctx.fillStyle = "#94a3b8";
      const dateStr = `Exported: ${new Date().toLocaleDateString()}`;
      ctx.fillText(dateStr, EXPORT_W - PAD - ctx.measureText(dateStr).width, hMid);

      // ── Content panel ──
      ctx.fillStyle = "#F8FAFC";
      ctx.fillRect(0, GRAPH_H + HEADER_H, EXPORT_W, PANEL_H - HEADER_H);

      // Vertical dividers
      const divTop = GRAPH_H + HEADER_H + 8;
      const divBot = GRAPH_H + PANEL_H - 8;
      ctx.strokeStyle = "#E2E8F0"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(LEG_END + 12, divTop); ctx.lineTo(LEG_END + 12, divBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(SET_END + 12, divTop); ctx.lineTo(SET_END + 12, divBot); ctx.stroke();

      const pTop = GRAPH_H + HEADER_H + PAD;

      // ── LEGEND ──
      let ly = pTop;
      ctx.font = `bold 10px ${FONT}`; ctx.fillStyle = "#94a3b8";
      ctx.fillText("RESOURCES", PAD, ly + 9); ly += ROW_H;
      nodeTypes.forEach(ot => {
        const cy = ly + ROW_H / 2 - 2;
        ctx.beginPath(); ctx.arc(PAD + 6, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = typeColorMap[ot] ?? "#94a3b8"; ctx.fill();
        ctx.font = `13px ${FONT}`; ctx.fillStyle = "#0F172A";
        ctx.fillText(ot, PAD + 18, cy + 4);
        ly += ROW_H;
      });
      ly += ROW_H * 0.5;

      ctx.font = `bold 10px ${FONT}`; ctx.fillStyle = "#94a3b8";
      ctx.fillText("HANDOVER OBJECT TYPE", PAD, ly + 9); ly += ROW_H;
      boTypes.forEach(bt => {
        const cy = ly + ROW_H / 2 - 2;
        ctx.fillStyle = typeColorMap[bt] ?? "#94a3b8";
        ctx.fillRect(PAD, cy - 4, 16, 8);
        ctx.font = `13px ${FONT}`; ctx.fillStyle = "#0F172A";
        ctx.fillText(bt, PAD + 22, cy + 4);
        ly += ROW_H;
      });
      ly += ROW_H * 0.5;

      ctx.font = `bold 10px ${FONT}`; ctx.fillStyle = "#94a3b8";
      ctx.fillText("SCALE (WEIGHT OF THICKEST ARC)", PAD, ly + 9); ly += ROW_H;
      if (normalizationScope === "per_bo_type") {
        boTypes.forEach(bt => {
          const scaleCy = ly + ROW_H / 2 - 2;
          ctx.save();
          ctx.strokeStyle = typeColorMap[bt] ?? "#94a3b8"; ctx.lineWidth = 6; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(PAD, scaleCy); ctx.lineTo(PAD + 30, scaleCy); ctx.stroke();
          ctx.restore();
          ctx.font = `13px ${FONT}`; ctx.fillStyle = "#0F172A";
          ctx.fillText(`${bt}  = ${(maxWeightPerType[bt] ?? 0).toFixed(4)}`, PAD + 38, scaleCy + 4);
          ly += ROW_H;
        });
      } else {
        const scaleCy = ly + ROW_H / 2 - 2;
        ctx.save();
        ctx.strokeStyle = "#374151"; ctx.lineWidth = 6; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(PAD, scaleCy); ctx.lineTo(PAD + 30, scaleCy); ctx.stroke();
        ctx.restore();
        ctx.font = `13px ${FONT}`; ctx.fillStyle = "#0F172A";
        ctx.fillText(`= ${maxWeight.toFixed(4)}`, PAD + 38, scaleCy + 4);
        ly += ROW_H;
      }

      // ── GRAPH SETTINGS ──
      const normLabel = normalization ? (NORMALIZATION_LABELS[normalization] ?? normalization) : "—";
      const settingsItems: Array<{ label: string; value: string }> = [
        { label: "Norm method",     value: normLabel },
        { label: "Per object type", value: normalizationScope === "per_bo_type" ? "Yes" : "No" },
        { label: "Max gap",         value: maxGap != null ? String(maxGap) : "None" },
      ];

      let sy = pTop;
      ctx.font = `bold 10px ${FONT}`; ctx.fillStyle = "#94a3b8";
      ctx.fillText("GRAPH SETTINGS", SET_X, sy + 9); sy += ROW_H;
      settingsItems.forEach(({ label, value }) => {
        const cy = sy + ROW_H / 2 - 2;
        ctx.font = `bold 12px ${FONT}`; ctx.fillStyle = "#64748b";
        ctx.fillText(`${label}:`, SET_X, cy + 4);
        const lw = ctx.measureText(`${label}:  `).width;
        const isNone = value === "None" || value === "—";
        ctx.font = `12px ${FONT}`; ctx.fillStyle = isNone ? "#94a3b8" : "#0F172A";
        ctx.fillText(value, SET_X + lw, cy + 4);
        sy += ROW_H;
      });

      // ── FILTERS ──
      const centralityLabels: Record<string, string> = { "in-degree": "In-Degree", "out-degree": "Out-Degree", "both-degree": "Degree", closeness: "Closeness", betweenness: "Betweenness" };
      const timeLabels: Record<string, string> = { max: "Max Time", min: "Min Time", avg: "Avg Time", range: "Range" };
      const activePerc = Object.entries(typePercentages).filter(([, v]) => v < 100);
      const minW = parseFloat(minWeightStr.replace(",", "."));

      const filterItems: Array<{ label: string; value: string | null }> = [
        { label: "Hidden nodes",    value: hiddenCount > 0 ? `${hiddenCount} of ${nodes.length} hidden` : null },
        { label: "Type percentage", value: activePerc.length > 0 ? activePerc.map(([ot, v]) => `${ot}: top ${v}%`).join(", ") : null },
        { label: "Min edge weight", value: minW > 0 ? minWeightStr : null },
        { label: "Parallel filter", value: parallelFilter?.enabled ? `threshold ${parallelFilter.threshold.toFixed(2)}, min obs ${parallelFilter.minObs}` : null },
        { label: "Centrality",      value: selectedCentrality ? (centralityLabels[selectedCentrality] ?? selectedCentrality) : null },
        { label: "Time metric",     value: selectedTimeMetric ? (timeLabels[selectedTimeMetric] ?? selectedTimeMetric) : null },
        { label: "Highlighted type",value: highlightedObjectType ?? null },
        { label: "Clustering",      value: clustered ? "Active" : null },
      ];

      let fy = pTop;
      ctx.font = `bold 10px ${FONT}`; ctx.fillStyle = "#94a3b8";
      ctx.fillText("FILTERS", FILT_X, fy + 9); fy += ROW_H;
      filterItems.forEach(({ label, value }) => {
        const cy = fy + ROW_H / 2 - 2;
        ctx.font = `bold 12px ${FONT}`; ctx.fillStyle = "#64748b";
        ctx.fillText(`${label}:`, FILT_X, cy + 4);
        const lw = ctx.measureText(`${label}:  `).width;
        ctx.font = `12px ${FONT}`; ctx.fillStyle = value ? "#0F172A" : "#94a3b8";
        ctx.fillText(value ?? "None", FILT_X + lw, cy + 4);
        fy += ROW_H;
      });

      canvas.toBlob(blob => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `handover-graph-${new Date().toISOString().slice(0, 10)}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }, "image/png");
    };
    img.src = svgUrl;
  };

  return (
    <div className="space-y-3">
      <div className="relative">
      <div ref={containerRef} className="w-full border rounded-md overflow-hidden bg-background">
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={() => { setNodeTooltip(t => t?.pinned ? null : t); setHighlightedObjectType(null); }}
          style={{ cursor: dragId ? "grabbing" : "default", display: "block" }}
        >
          <defs>
            {boTypes.map(bt => {
              const color = typeColorMap[bt] ?? "#94a3b8";
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
            <g key={ep.key}>
              <path
                data-flow-edge={`${ep.source}|${ep.target}|${ep.businessobject_type}`}
                d={ep.d}
                fill="none"
                markerEnd={`url(#${ep.markerId})`}
                style={{
                  stroke: ep.color,
                  strokeWidth: ep.strokeWidth,
                  opacity: (() => {
                    const isHighlighted = !highlightedObjectType || ep.businessobject_type === highlightedObjectType;
                    const timeScore = edgeTimeScores ? (0.1 + 0.75 * (edgeTimeScores.get(`${ep.source}\x00${ep.target}\x00${ep.businessobject_type}`) ?? 0)) : null;
                    let base: number;
                    if (highlightedObjectType) {
                      base = !isHighlighted ? 0.12 : (timeScore ?? 0.85);
                    } else if (timeScore !== null) {
                      base = timeScore;
                    } else if (centralityScores) {
                      base = 0.2;
                    } else {
                      base = 0.85;
                    }
                    const hasMetric = edgeTimeScores !== null || centralityScores !== null;
                    return (flowsData && !hasMetric) ? base * 0.25 : base;
                  })(),
                  pointerEvents: "none",
                }}
              />
              <path
                d={ep.d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                style={{ cursor: "pointer" }}
                onClick={e => {
                  e.stopPropagation();
                  setHighlightedObjectType(t => t === ep.businessobject_type ? null : ep.businessobject_type);
                }}
                onMouseEnter={e => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect || dragId) return;
                  setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, count: ep.count, weight: ep.weight, avg_time: ep.avg_time, min_time: ep.min_time, max_time: ep.max_time });
                }}
                onMouseMove={e => {
                  if (dragId) return;
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTooltip(t => t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          ))}

          {/* Nodes */}
          {(() => {
            const highlightedNodeIds = highlightedObjectType
              ? new Set(edgePaths.filter(ep => ep.businessobject_type === highlightedObjectType).flatMap(ep => [ep.source, ep.target]))
              : null;
            return nodes.filter(n => filteredNodeIds.has(n.id)).map(node => {
            const pos = positions[node.id];
            if (!pos) return null;
            const baseColor = typeColorMap[node.object_type] ?? "#94a3b8";
            const color = centralityScores
              ? mixHex(baseColor, centralityScores.get(node.id) ?? 0)
              : baseColor;
            const nodeOpacity = highlightedNodeIds
              ? (highlightedNodeIds.has(node.id) ? 1 : 0.15)
              : 1;
            const label = node.id.length > 11 ? node.id.slice(0, 11) + "…" : node.id;
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x},${pos.y})`}
                style={{ cursor: onNodeClick ? "pointer" : "grab", opacity: nodeOpacity }}
                onMouseDown={e => handleNodeMouseDown(node.id, e)}
                onClick={e => {
                  e.stopPropagation();
                  if (dragHasMoved.current) return;
                  if (nodeTooltip?.nodeId === node.id) {
                    setNodeTooltip(t => t ? { ...t, pinned: !t.pinned } : null);
                  } else {
                    onNodeClick?.(node.id);
                  }
                }}
                onMouseEnter={e => {
                  if (dragId) return;
                  cancelHide();
                  const el = containerRef.current;
                  if (!el) return;
                  const rect = el.getBoundingClientRect();
                  setNodeTooltip(prev => prev?.pinned ? prev : {
                    x: e.clientX - rect.left, y: e.clientY - rect.top,
                    nodeId: node.id, pinned: false,
                    cw: el.offsetWidth, ch: el.offsetHeight,
                  });
                }}
                onMouseMove={e => {
                  if (dragId) return;
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setNodeTooltip(t => t && !t.pinned ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : t);
                }}
                onMouseLeave={() => scheduleHide()}
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
          });
          })()}

          {/* C-net binding overlay — populated imperatively */}
          <g ref={bindingsLayerRef} />
          {/* Animation dots layer — populated imperatively by updateDotLayer */}
          <g ref={dotsLayerRef} />
        </svg>

        {highlightedObjectType && (
          <div style={{
            position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 10,
            display: "flex", alignItems: "center", gap: 7,
            background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 9999,
            padding: "5px 12px 5px 10px",
            boxShadow: "0 2px 6px rgba(15,23,42,0.10)",
            fontSize: 12, fontWeight: 600, color: "#92400E",
            pointerEvents: "none",
          }}>
            <AlertTriangle style={{ width: 13, height: 13, color: "#D97706", flexShrink: 0 }} />
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: typeColorMap[highlightedObjectType] ?? "#94a3b8", flexShrink: 0 }} />
            <span>{highlightedObjectType} <span style={{ fontWeight: 400, opacity: 0.7 }}>is highlighted</span></span>
            <button
              type="button"
              onClick={() => setHighlightedObjectType(null)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: "#D97706", marginLeft: 2, pointerEvents: "auto" }}
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
        )}

        {(filterOpen || centralityOpen || timeMetricOpen) && (
          <div
            style={{ position: "absolute", inset: 0, zIndex: 19 }}
            onClick={() => { setFilterOpen(false); setCentralityOpen(false); setTimeMetricOpen(false); }}
          />
        )}

        {/* Button bar */}
        <div style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 9999,
          padding: "6px 12px",
          boxShadow: "0 10px 24px rgba(15, 23, 42, 0.14)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            height: 36, padding: "0 12px",
            border: "1px solid #E2E8F0", borderRadius: 9999,
            background: "white",
          }}>
            <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>min weight</span>
            <input
              type="text"
              inputMode="decimal"
              value={minWeightStr}
              onChange={e => setMinWeightStr(e.target.value)}
              onBlur={e => {
                const n = Math.max(0, parseFloat(e.target.value.replace(",", ".")) || 0);
                let s = n.toFixed(4);
                while (s.endsWith("0") && s.split(".")[1].length > 2) s = s.slice(0, -1);
                setMinWeightStr(s);
              }}
              onKeyDown={e => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const cur = Math.max(0, parseFloat(minWeightStr.replace(",", ".")) || 0);
                  const next = Math.max(0, Math.round((cur + (e.key === "ArrowUp" ? 0.01 : -0.01)) * 100) / 100);
                  setMinWeightStr(next.toFixed(2));
                }
              }}
              style={{ width: 44, border: "none", fontSize: 12, textAlign: "center", outline: "none", background: "transparent" }}
            />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <button type="button" tabIndex={-1}
                onClick={() => setMinWeightStr(s => (Math.round((Math.max(0, parseFloat(s.replace(",", ".")) || 0) + 0.01) * 100) / 100).toFixed(2))}
                style={{ background: "none", border: "none", padding: "1px 0", cursor: "pointer", color: "#64748b", lineHeight: 1, fontSize: 8 }}
              >▲</button>
              <button type="button" tabIndex={-1}
                onClick={() => setMinWeightStr(s => (Math.max(0, Math.round((Math.max(0, parseFloat(s.replace(",", ".")) || 0) - 0.01) * 100) / 100)).toFixed(2))}
                style={{ background: "none", border: "none", padding: "1px 0", cursor: "pointer", color: "#64748b", lineHeight: 1, fontSize: 8 }}
              >▼</button>
            </div>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={zoomIn} className="rounded-full h-9 w-9">
            <PlusIcon className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={zoomOut} className="rounded-full h-9 w-9">
            <MinusIcon className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={fitToView} className="rounded-full h-9 w-9">
            <ScanIcon className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={downloadGraph} className="rounded-full h-9 w-9" title="Download graph as PNG">
            <Download className="h-4 w-4" />
          </Button>
          <div style={{ position: "relative" }}>
            <Button
              type="button"
              variant={selectedCentrality ? "secondary" : "outline"}
              size="icon"
              onClick={() => { setCentralityOpen(o => !o); setFilterOpen(false); setTimeMetricOpen(false); }}
              className="rounded-full h-9 w-9"
              title="Centrality measure"
            >
              <Network className="h-4 w-4" />
            </Button>
            {selectedCentrality && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "#2563eb", color: "white",
                borderRadius: 9999, fontSize: 9, fontWeight: 700,
                minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 3px", lineHeight: 1, pointerEvents: "none",
              }} />
            )}
          </div>
          <div style={{ position: "relative" }}>
            <Button
              type="button"
              variant={selectedTimeMetric ? "secondary" : "outline"}
              size="icon"
              onClick={() => { setTimeMetricOpen(o => !o); setCentralityOpen(false); setFilterOpen(false); }}
              className="rounded-full h-9 w-9"
              title="Time metric"
            >
              <Timer className="h-4 w-4" />
            </Button>
            {selectedTimeMetric && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "#d97706", color: "white",
                borderRadius: 9999, fontSize: 9, fontWeight: 700,
                minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 3px", lineHeight: 1, pointerEvents: "none",
              }} />
            )}
          </div>
          <div style={{ position: "relative" }}>
            <Button
              type="button"
              variant={filterActive ? "secondary" : "outline"}
              size="icon"
              onClick={() => { setFilterOpen(o => !o); setCentralityOpen(false); setTimeMetricOpen(false); }}
              className="rounded-full h-9 w-9"
              title="Filter nodes"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
            {filterActive && hiddenCount > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "#ef4444", color: "white",
                borderRadius: 9999, fontSize: 9, fontWeight: 700,
                minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 3px", lineHeight: 1, pointerEvents: "none",
              }}>
                {hiddenCount}
              </span>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {filterOpen && (
          <div
            style={{
              position: "absolute", bottom: 68, right: 12, width: 272, height: filterPanelHeight, zIndex: 20,
              background: "white", border: "1px solid #E2E8F0", borderRadius: 12,
              boxShadow: "0 10px 24px rgba(15,23,42,0.14)", overflow: "hidden",
              display: "flex", flexDirection: "column",
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 8px", borderBottom: "1px solid #F1F5F9" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>Node Filter</span>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#64748b", display: "flex", alignItems: "center" }}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>

            {/* Top % by type */}
            {!clustered && (
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Top % by type</span>
                  {Object.values(typePercentages).some(v => v < 100) && (
                    <button
                      type="button"
                      onClick={() => setTypePercentages({})}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#64748b", textDecoration: "underline", padding: 0 }}
                    >
                      Reset all
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {nodeTypes.map(ot => {
                    const pct = typePercentages[ot] ?? 100;
                    const color = typeColorMap[ot] ?? "#94a3b8";
                    return (
                      <div key={ot} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: "#334155", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ot}</span>
                        <Slider
                          min={0} max={100} step={1}
                          value={[pct]}
                          onValueChange={([v]) => setTypePercentages(prev => ({ ...prev, [ot]: v }))}
                          className="w-20"
                        />
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#334155", width: 30, textAlign: "right", flexShrink: 0 }}>{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Node search + checklist */}
            <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ position: "relative", marginBottom: 8 }}>
                <Search style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, color: "#94a3b8", pointerEvents: "none" }} />
                <input
                  type="text"
                  placeholder="Search resources…"
                  value={nodeSearch}
                  onChange={e => setNodeSearch(e.target.value)}
                  style={{
                    width: "100%", boxSizing: "border-box", paddingLeft: 26, paddingRight: 8,
                    height: 30, border: "1px solid #E2E8F0", borderRadius: 6,
                    fontSize: 12, outline: "none", background: "#F8FAFC",
                  }}
                />
              </div>
              {/* Object type chips */}
              <div style={{ display: "flex", gap: 4, overflowX: "auto", marginBottom: 8, paddingBottom: 2, scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}>
                {nodeTypes
                  .filter(ot => nodes.some(n => n.object_type === ot && percentagePassingIds.has(n.id)))
                  .map(ot => {
                    const color = typeColorMap[ot] ?? "#94a3b8";
                    const active = selectedTypeFilters.has(ot);
                    return (
                      <div
                        key={ot}
                        onClick={() => setSelectedTypeFilters(prev => { const next = new Set(prev); active ? next.delete(ot) : next.add(ot); return next; })}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 3,
                          padding: active ? "2px 4px 2px 8px" : "2px 8px",
                          borderRadius: 9999, flexShrink: 0, cursor: "pointer", userSelect: "none",
                          border: `1.5px solid ${color}`,
                          background: active ? color : "white",
                          color: active ? "white" : "#64748b",
                          fontSize: 11, fontWeight: active ? 600 : 400,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ot}
                        {active && (
                          <span
                            onClick={e => { e.stopPropagation(); setSelectedTypeFilters(prev => { const next = new Set(prev); next.delete(ot); return next; }); }}
                            style={{ display: "flex", alignItems: "center", opacity: 0.8, cursor: "pointer" }}
                          >
                            <X style={{ width: 10, height: 10 }} />
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <button
                  type="button"
                  onClick={() => setCheckedNodes(prev => { const next = new Set(prev); searchedNodes.forEach(n => next.add(n.id)); return next; })}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#64748b", textDecoration: "underline", padding: 0 }}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setCheckedNodes(prev => { const next = new Set(prev); searchedNodes.forEach(n => next.delete(n.id)); return next; })}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#64748b", textDecoration: "underline", padding: 0 }}
                >
                  None
                </button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                {searchedNodes.map(n => {
                  const checked = checkedNodes.has(n.id);
                  const color = typeColorMap[n.object_type] ?? "#94a3b8";
                  return (
                    <label key={n.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "2px 4px", borderRadius: 4 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setCheckedNodes(prev => {
                          const next = new Set(prev);
                          checked ? next.delete(n.id) : next.add(n.id);
                          return next;
                        })}
                        style={{ width: 13, height: 13, accentColor: color, flexShrink: 0 }}
                      />
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.id}</span>
                    </label>
                  );
                })}
                {searchedNodes.length === 0 && (
                  <span style={{ fontSize: 11, color: "#94a3b8", padding: "4px 0" }}>No nodes match.</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Time metric panel */}
        {timeMetricOpen && (
          <div
            style={{
              position: "absolute", bottom: 68, right: 12, width: 272, zIndex: 20,
              background: "white", border: "1px solid #E2E8F0", borderRadius: 12,
              boxShadow: "0 10px 24px rgba(15,23,42,0.14)", overflow: "hidden",
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 8px", borderBottom: "1px solid #F1F5F9" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>Time Metric</span>
              <button type="button" onClick={() => setTimeMetricOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#64748b", display: "flex", alignItems: "center" }}>
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
            {([
              { key: "max",   label: "Max Time",   desc: "Longest handover time observed for each arc" },
              { key: "min",   label: "Min Time",   desc: "Shortest handover time observed for each arc" },
              { key: "avg",   label: "Avg Time",   desc: "Average handover time for each arc" },
              { key: "range", label: "Range",      desc: "Spread between longest and shortest handover (max − min)" },
            ] as const).map(({ key, label, desc }) => {
              const active = selectedTimeMetric === key;
              return (
                <div
                  key={key}
                  onClick={() => {
                    const next = active ? null : key;
                    setSelectedTimeMetric(next);
                  }}
                  style={{
                    padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #F1F5F9",
                    background: active ? "#FFF7ED" : "white",
                    display: "flex", alignItems: "flex-start", gap: 10,
                  }}
                >
                  <div style={{
                    marginTop: 2, width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                    border: active ? "4px solid #D97706" : "1.5px solid #CBD5E1",
                    boxSizing: "border-box",
                  }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: active ? "#92400E" : "#0F172A" }}>{label}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
                  </div>
                </div>
              );
            })}
            <div style={{ padding: "8px 14px", background: "#FFFBEB", borderTop: "1px solid #FDE68A", display: "flex", alignItems: "flex-start", gap: 6 }}>
              <Info style={{ width: 11, height: 11, color: "#92400E", flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 10, color: "#92400E", lineHeight: 1.4 }}>
                Brighter arcs always indicate a higher value. For Min Time, a bright arc means even the shortest observed handover was long.
              </span>
            </div>
          </div>
        )}

        {/* Centrality panel */}
        {centralityOpen && (
          <div
            style={{
              position: "absolute", bottom: 68, right: 12, width: 272, zIndex: 20,
              background: "white", border: "1px solid #E2E8F0", borderRadius: 12,
              boxShadow: "0 10px 24px rgba(15,23,42,0.14)", overflow: "hidden",
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 8px", borderBottom: "1px solid #F1F5F9" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>Centrality Measure</span>
              <button
                type="button"
                onClick={() => setCentralityOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#64748b", display: "flex", alignItems: "center" }}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
            {([
              { key: "in-degree",   label: "In-Degree Centrality",   desc: "Number of unique resources that hand work to this one" },
              { key: "out-degree",  label: "Out-Degree Centrality",  desc: "Number of unique resources this one hands work to" },
              { key: "both-degree", label: "Degree Centrality",      desc: "Total unique partners (in and out combined)" },
              { key: "closeness",   label: "Closeness Centrality",   desc: "How quickly this resource can reach all others via directed handovers" },
              { key: "betweenness", label: "Betweenness Centrality", desc: "Fraction of directed shortest paths between any two resources passing through this one" },
            ] as const).map(({ key, label, desc }) => {
              const active = selectedCentrality === key;
              return (
                <div
                  key={key}
                  onClick={() => { setSelectedCentrality(active ? null : key); }}
                  style={{
                    padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #F1F5F9",
                    background: active ? "#EFF6FF" : "white",
                    display: "flex", alignItems: "flex-start", gap: 10,
                  }}
                >
                  <div style={{
                    marginTop: 2, width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                    border: active ? "4px solid #2563EB" : "1.5px solid #CBD5E1",
                    boxSizing: "border-box",
                  }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: active ? "#1D4ED8" : "#0F172A" }}>{label}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tooltip && (
          <div style={{
            position: "absolute",
            left: tooltip.x + 14,
            top: tooltip.y - 10,
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12,
            boxShadow: "0 4px 12px rgba(15,23,42,0.12)",
            pointerEvents: "none",
            zIndex: 10,
            whiteSpace: "nowrap",
          }}>
            <div><span style={{ fontWeight: 600 }}>Count:</span> {tooltip.count}</div>
            <div><span style={{ fontWeight: 600 }}>Weight:</span> {tooltip.weight.toFixed(4)}</div>
            {tooltip.avg_time != null && (
              <>
                <div style={{ borderTop: "1px solid #E2E8F0", margin: "5px 0" }} />
                <div><span style={{ fontWeight: 600 }}>Avg time:</span> {fmtDuration(tooltip.avg_time)}</div>
                <div style={{ color: "#64748b" }}>Range: {fmtDuration(tooltip.min_time)} – {fmtDuration(tooltip.max_time)}</div>
              </>
            )}
          </div>
        )}
      </div>
      {nodeTooltip && (() => {
          const nId = nodeTooltip.nodeId;
          const cw = nodeTooltip.cw;
          const ch = nodeTooltip.ch;
          if (clusterInfo) {
            const isCluster = nId.startsWith("Cluster ");
            const clusterLabel = isCluster ? parseInt(nId.split(" ")[1]) - 1 : 0;
            const members = isCluster
              ? clusterInfo.resources.filter(r => clusterInfo.clusterMap[r] === nId)
              : [nId];
            const resourceColorMap = Object.fromEntries(
              clusterInfo.resources.map(r => [r, typeColorMap[clusterInfo.resourceObjectTypes[r] ?? ""] ?? "#94a3b8"])
            );
            const activityColorMap = mapTypesToColors(clusterInfo.activities);
            return (
              <TooltipBox
                tooltip={{ x: nodeTooltip.x, y: nodeTooltip.y, resources: members, profile: [], isCluster, clusterLabel, pinned: nodeTooltip.pinned, cw, ch }}
                activities={clusterInfo.activities}
                cooccurringResources={clusterInfo.cooccurringResources}
                collaboratingResources={clusterInfo.collaboratingResources}
                timeBins={clusterInfo.timeBins}
                weekdayBins={clusterInfo.weekdayBins}
                portfolioObjectTypes={clusterInfo.portfolioObjectTypes}
                resourceObjectTypes={clusterInfo.resourceObjectTypes}
                typeTotals={clusterInfo.typeTotals}
                coocTypeN={clusterInfo.coocTypeN}
                collabTypeN={clusterInfo.collabTypeN}
                activityColorMap={activityColorMap}
                resourceColorMap={resourceColorMap}
                typeColorMap={typeColorMap}
                clusterColors={CLUSTER_COLORS}
                allProfiles={{}}
                tooltipProfiles={clusterInfo.tooltipProfiles}
                showDropdown={false}
                highlightedActivity={null}
                onPin={() => setNodeTooltip(t => t ? { ...t, pinned: true } : null)}
                onClose={() => setNodeTooltip(null)}
                onTooltipMouseEnter={cancelHide}
                onTooltipMouseLeave={scheduleHide}
              />
            );
          }
          const node = nodes.find(n => n.id === nId);
          const TW = 180, TH = 52;
          const left = Math.min(nodeTooltip.x + 14, cw - TW - 4);
          const top = Math.max(4, Math.min(nodeTooltip.y - TH - 8, ch - TH - 4));
          return (
            <div style={{ position: "absolute", left, top, background: "white", border: "1px solid #E2E8F0", borderRadius: 8, padding: "6px 10px", fontSize: 12, boxShadow: "0 4px 12px rgba(15,23,42,0.12)", pointerEvents: "none", zIndex: 11, whiteSpace: "nowrap", maxWidth: TW }}>
              <div style={{ fontWeight: 600 }}>{nId}</div>
              {node != null && <div style={{ color: "#64748b", marginTop: 2 }}>Events: {node.event_count}</div>}
            </div>
          );
        })()}
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
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: typeColorMap[t] ?? "#94a3b8" }} />
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
                <div className="w-4 h-2 rounded-sm flex-shrink-0" style={{ background: typeColorMap[t] ?? "#94a3b8" }} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide" style={{ fontSize: 10 }}>
            Scale (weight of thickest arc)
          </p>
          {normalizationScope === "per_bo_type" ? (
            <div className="flex flex-col gap-1">
              {boTypes.map(bt => (
                <div key={bt} className="flex items-center gap-2">
                  <svg width="32" height="10" className="flex-shrink-0">
                    <line x1="3" y1="5" x2="29" y2="5" stroke={typeColorMap[bt] ?? "#94a3b8"} strokeWidth={6} strokeLinecap="round" />
                  </svg>
                  <Tooltip delayDuration={600}>
                    <TooltipTrigger asChild>
                      <span className="tabular-nums text-muted-foreground cursor-default text-xs">{(maxWeightPerType[bt] ?? 0).toFixed(4)}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[200px] text-xs">
                      Maximum normalized weight for "{bt}" arcs. Arc thicknesses within this type are relative to this value.
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <svg width="32" height="10" className="flex-shrink-0">
                <line x1="3" y1="5" x2="29" y2="5" stroke="#374151" strokeWidth={6} strokeLinecap="round" />
              </svg>
              <Tooltip delayDuration={600}>
                <TooltipTrigger asChild>
                  <span className="tabular-nums text-muted-foreground cursor-default">{maxWeight.toFixed(4)}</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[200px] text-xs">
                  Maximum normalized handover weight in this graph. The thickest arc corresponds to this value.
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── NodeDetailView ─────────────────────────────────────────── */
function NodeDetailView({
  selectedNode,
  data,
  typeColorMap,
  onBack,
  clusterInfo,
}: {
  selectedNode: string;
  data: HandoverData;
  typeColorMap: Record<string, string>;
  onBack: () => void;
  clusterInfo?: ClusterInfo;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [detailH, setDetailH] = useState(400);
  const [egoNorm, setEgoNorm] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; count: number; weight: number; avg_time: number | null; min_time: number | null; max_time: number | null } | null>(null);
  const [nodeTooltip, setNodeTooltip] = useState<{ x: number; y: number; nodeId: string; pinned: boolean; cw: number; ch: number } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = () => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; } };
  const scheduleHide = () => { hideTimerRef.current = setTimeout(() => setNodeTooltip(t => t?.pinned ? t : null), 150); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNodeTooltip(null); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); cancelHide(); };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setWidth(r.width || 700);
      setDetailH(r.height || 400);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset scroll to top when the selected node changes
  useEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    setScrollTop(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode]);

  const outEdges = data.edges.filter(e => e.source === selectedNode && e.target !== selectedNode);
  const inEdges = data.edges.filter(e => e.target === selectedNode && e.source !== selectedNode);
  const selfEdges = data.edges.filter(e => e.source === selectedNode && e.target === selectedNode);

  const counterpartIds = [...new Set([
    ...outEdges.map(e => e.target),
    ...inEdges.map(e => e.source),
  ])];

  const nodeById: Record<string, HandoverNode> = {};
  data.nodes.forEach(n => { nodeById[n.id] = n; });

  const selectedColor = typeColorMap[nodeById[selectedNode]?.object_type ?? ""] ?? "#94a3b8";

  const LEFT_X = 90;
  const RIGHT_X = width - 90;
  const MID_X = width / 2;
  const ROW_H = 72;
  const PADDING_V = 80;
  const OFFSET_STEP = 11;

  const nc = counterpartIds.length;
  // Full SVG is tall enough for all counterparts; container clips to detailH and scrolls
  const svgHeight = Math.max(detailH, (nc === 0 ? 0 : nc - 1) * ROW_H + PADDING_V * 2);
  const egoY = svgHeight / 2;

  const midYOf = (i: number) => {
    if (nc === 0) return egoY;
    return egoY + (i - (nc - 1) / 2) * ROW_H;
  };

  const allBoTypes = [...new Set([
    ...outEdges.map(e => e.businessobject_type),
    ...inEdges.map(e => e.businessobject_type),
    ...selfEdges.map(e => e.businessobject_type),
  ])];

  const arrowId = (bt: string) => `detail-arrow-${bt.replace(/[^a-zA-Z0-9]/g, "_")}`;

  const allEdgesTotal = [...outEdges, ...inEdges, ...selfEdges].reduce((s, e) => s + e.raw_weight, 0);

  const getW = (edge: HandoverEdge) => {
    if (!egoNorm) return edge.weight;
    return allEdgesTotal > 0 ? edge.raw_weight / allEdgesTotal : 0;
  };

  const displayWeights = egoNorm
    ? [...outEdges, ...inEdges, ...selfEdges].map(e => getW(e))
    : data.edges.map(e => e.weight);

  const maxW = Math.max(0.0001, ...displayWeights);
  const strokeFor = (w: number) => Math.max(0.3, (w / maxW) * 6);

  // Ego is fixed at the vertical center of the visible container (overlay coordinate space)
  const OEY = detailH / 2;

  const paths: Array<{ key: string; d: string; color: string; strokeWidth: number; markerId: string; count: number; weight: number; avg_time: number | null; min_time: number | null; max_time: number | null }> = [];

  const pushEdge = (key: string, srcX: number, srcY: number, tgtX: number, tgtY: number,
    edge: HandoverEdge, lat: number) => {
    const dx = tgtX - srcX, dy = tgtY - srcY;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const perpX = -uy, perpY = ux;
    const sx = srcX + ux * NODE_R + perpX * lat;
    const sy = srcY + uy * NODE_R + perpY * lat;
    const ex = tgtX - ux * (NODE_R + ARROW_LEN) + perpX * lat;
    const ey = tgtY - uy * (NODE_R + ARROW_LEN) + perpY * lat;
    paths.push({
      key,
      d: `M ${sx} ${sy} L ${ex} ${ey}`,
      color: typeColorMap[edge.businessobject_type] ?? "#94a3b8",
      strokeWidth: strokeFor(getW(edge)),
      markerId: arrowId(edge.businessobject_type),
      count: edge.raw_weight,
      weight: getW(edge),
      avg_time: edge.avg_time,
      min_time: edge.min_time,
      max_time: edge.max_time,
    });
  };

  // Arc endpoints use OEY (fixed overlay center) for ego, and midYOf(i)-scrollTop for counterparts
  counterpartIds.forEach((cpId, i) => {
    const cy = midYOf(i) - scrollTop;
    outEdges.filter(e => e.target === cpId).forEach((edge, j, arr) => {
      pushEdge(`out-${cpId}-${j}`, MID_X, OEY, RIGHT_X, cy, edge,
        (j - (arr.length - 1) / 2) * OFFSET_STEP);
    });
    inEdges.filter(e => e.source === cpId).forEach((edge, j, arr) => {
      pushEdge(`in-${cpId}-${j}`, LEFT_X, cy, MID_X, OEY, edge,
        (j - (arr.length - 1) / 2) * OFFSET_STEP);
    });
  });

  // Self-loop on ego node, arcing above the fixed overlay ego position
  selfEdges.forEach((edge, j) => {
    const spread = j * NODE_R * 0.9;
    const loopH = NODE_R * 2.4 + spread;
    const loopW = NODE_R * 1.6 + spread;
    const startA = -Math.PI * 0.72;
    const startX = MID_X + NODE_R * Math.cos(startA);
    const startY = OEY + NODE_R * Math.sin(startA);
    const cp1x = MID_X - loopW, cp1y = OEY - loopH;
    const cp2x = MID_X + loopW, cp2y = OEY - loopH;
    const endA = -Math.PI * 0.28;
    const endTX = MID_X + NODE_R * Math.cos(endA);
    const endTY = OEY + NODE_R * Math.sin(endA);
    const edx = endTX - cp2x, edy = endTY - cp2y;
    const eLen = Math.hypot(edx, edy) || 1;
    const endX = endTX - (edx / eLen) * ARROW_LEN;
    const endY = endTY - (edy / eLen) * ARROW_LEN;
    paths.push({
      key: `self-${j}`,
      d: `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`,
      color: typeColorMap[edge.businessobject_type] ?? "#94a3b8",
      strokeWidth: strokeFor(getW(edge)),
      markerId: arrowId(edge.businessobject_type),
      count: edge.raw_weight,
      weight: getW(edge),
      avg_time: edge.avg_time,
      min_time: edge.min_time,
      max_time: edge.max_time,
    });
  });

  const lbl = (id: string) => id.length > 11 ? id.slice(0, 11) + "…" : id;

  const nodeHandlers = (nodeId: string) => ({
    onMouseEnter: (e: React.MouseEvent<SVGGElement>) => {
      cancelHide();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setNodeTooltip(prev => prev?.pinned ? prev : {
        x: e.clientX - rect.left, y: e.clientY - rect.top,
        nodeId, pinned: false, cw: el.offsetWidth, ch: el.offsetHeight,
      });
    },
    onMouseMove: (e: React.MouseEvent<SVGGElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setNodeTooltip(t => t && !t.pinned ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : t);
    },
    onMouseLeave: () => scheduleHide(),
    onClick: (e: React.MouseEvent<SVGGElement>) => {
      e.stopPropagation();
      setNodeTooltip(t => t?.nodeId === nodeId ? { ...t, pinned: !t.pinned } : t);
    },
  });

  const nodeTypesPresent = [...new Set([
    nodeById[selectedNode]?.object_type,
    ...counterpartIds.map(id => nodeById[id]?.object_type),
  ].filter(Boolean) as string[])];

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onBack}>← Back</Button>
          <span className="text-sm text-muted-foreground">
            Handover detail for{" "}
            <span className="font-mono font-semibold text-foreground">{selectedNode}</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="ego-norm" checked={egoNorm} onCheckedChange={setEgoNorm} />
            <Label htmlFor="ego-norm" className="text-sm cursor-pointer">Normalize</Label>
          </div>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
      <div ref={containerRef} className="w-full border rounded-md bg-background h-full"
           style={{ position: "relative" }}>

        {/* Scrollable layer — counterpart nodes only, no arcs, no ego */}
        <div
          ref={scrollContainerRef}
          style={{ overflowY: "auto", overflowX: "hidden", height: "100%" }}
          onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
        >
          <svg width={width} height={svgHeight} style={{ display: "block" }}>
            {counterpartIds.map((cpId, i) => {
              const cy = midYOf(i);
              const color = typeColorMap[nodeById[cpId]?.object_type ?? ""] ?? "#94a3b8";
              return (
                <g key={`cp-${cpId}`}>
                  <g transform={`translate(${LEFT_X},${cy})`} {...nodeHandlers(cpId)}>
                    <circle r={NODE_R} fill={color} stroke="white" strokeWidth={2} />
                    <text textAnchor="middle" dominantBaseline="central" fontSize={9} fill="white" fontWeight="600"
                      style={{ pointerEvents: "none", userSelect: "none" }}>{lbl(cpId)}</text>
                  </g>
                  <g transform={`translate(${RIGHT_X},${cy})`} {...nodeHandlers(cpId)}>
                    <circle r={NODE_R} fill={color} stroke="white" strokeWidth={2} />
                    <text textAnchor="middle" dominantBaseline="central" fontSize={9} fill="white" fontWeight="600"
                      style={{ pointerEvents: "none", userSelect: "none" }}>{lbl(cpId)}</text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Fixed overlay — ego node + arcs + column labels; positioned absolute so it never scrolls */}
        <svg
          width={width} height={detailH}
          style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", overflow: "hidden" }}
          onClick={() => setNodeTooltip(t => t?.pinned ? null : t)}
        >
          <defs>
            {allBoTypes.map(bt => {
              const color = typeColorMap[bt] ?? "#94a3b8";
              const id = arrowId(bt);
              return (
                <marker key={id} id={id}
                  markerWidth={ARROW_LEN} markerHeight={ARROW_H}
                  refX={0} refY={ARROW_H / 2}
                  orient="auto" markerUnits="userSpaceOnUse">
                  <polygon points={`0 0, ${ARROW_LEN} ${ARROW_H / 2}, 0 ${ARROW_H}`} fill={color} />
                </marker>
              );
            })}
          </defs>

          {/* Column labels — always visible at top */}
          <text x={LEFT_X} y={22} textAnchor="middle" fontSize={10} fill="gray" opacity={0.7} fontWeight="600">Sender</text>
          <text x={MID_X} y={22} textAnchor="middle" fontSize={10} fill="gray" opacity={0.7} fontWeight="600">Ego</text>
          <text x={RIGHT_X} y={22} textAnchor="middle" fontSize={10} fill="gray" opacity={0.7} fontWeight="600">Receiver</text>

          {/* Arcs */}
          {paths.map(p => (
            <g key={p.key}>
              <path d={p.d} fill="none"
                markerEnd={`url(#${p.markerId})`}
                style={{ stroke: p.color, strokeWidth: p.strokeWidth, opacity: 0.85, pointerEvents: "none" }} />
              <path d={p.d} fill="none" stroke="transparent" strokeWidth={12}
                style={{ pointerEvents: "auto" }}
                onMouseEnter={e => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, count: p.count, weight: p.weight, avg_time: p.avg_time, min_time: p.min_time, max_time: p.max_time });
                }}
                onMouseMove={e => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTooltip(t => t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          ))}

          {/* Ego node — fixed at vertical center of the overlay */}
          <g transform={`translate(${MID_X},${OEY})`} style={{ pointerEvents: "auto" }} {...nodeHandlers(selectedNode)}>
            <circle r={NODE_R} fill={selectedColor} stroke="white" strokeWidth={2} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={9} fill="white" fontWeight="600"
              style={{ pointerEvents: "none", userSelect: "none" }}>{lbl(selectedNode)}</text>
          </g>
        </svg>

        {tooltip && (
          <div style={{
            position: "absolute",
            left: tooltip.x + 14,
            top: tooltip.y - 10,
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12,
            boxShadow: "0 4px 12px rgba(15,23,42,0.12)",
            pointerEvents: "none",
            zIndex: 10,
            whiteSpace: "nowrap",
          }}>
            <div><span style={{ fontWeight: 600 }}>Count:</span> {tooltip.count}</div>
            <div><span style={{ fontWeight: 600 }}>Weight:</span> {tooltip.weight.toFixed(4)}</div>
            {tooltip.avg_time != null && (
              <>
                <div style={{ borderTop: "1px solid #E2E8F0", margin: "5px 0" }} />
                <div><span style={{ fontWeight: 600 }}>Avg time:</span> {fmtDuration(tooltip.avg_time)}</div>
                <div style={{ color: "#64748b" }}>Range: {fmtDuration(tooltip.min_time)} – {fmtDuration(tooltip.max_time)}</div>
              </>
            )}
          </div>
        )}
      </div>
      {nodeTooltip && (() => {
          const nId = nodeTooltip.nodeId;
          const cw = nodeTooltip.cw;
          const ch = nodeTooltip.ch;
          if (clusterInfo) {
            const isCluster = nId.startsWith("Cluster ");
            const clusterLabel = isCluster ? parseInt(nId.split(" ")[1]) - 1 : 0;
            const members = isCluster
              ? clusterInfo.resources.filter(r => clusterInfo.clusterMap[r] === nId)
              : [nId];
            const resourceColorMap = Object.fromEntries(
              clusterInfo.resources.map(r => [r, typeColorMap[clusterInfo.resourceObjectTypes[r] ?? ""] ?? "#94a3b8"])
            );
            const activityColorMap = mapTypesToColors(clusterInfo.activities);
            return (
              <TooltipBox
                tooltip={{ x: nodeTooltip.x, y: nodeTooltip.y, resources: members, profile: [], isCluster, clusterLabel, pinned: nodeTooltip.pinned, cw, ch }}
                activities={clusterInfo.activities}
                cooccurringResources={clusterInfo.cooccurringResources}
                collaboratingResources={clusterInfo.collaboratingResources}
                timeBins={clusterInfo.timeBins}
                weekdayBins={clusterInfo.weekdayBins}
                portfolioObjectTypes={clusterInfo.portfolioObjectTypes}
                resourceObjectTypes={clusterInfo.resourceObjectTypes}
                typeTotals={clusterInfo.typeTotals}
                coocTypeN={clusterInfo.coocTypeN}
                collabTypeN={clusterInfo.collabTypeN}
                activityColorMap={activityColorMap}
                resourceColorMap={resourceColorMap}
                typeColorMap={typeColorMap}
                clusterColors={CLUSTER_COLORS}
                allProfiles={{}}
                tooltipProfiles={clusterInfo.tooltipProfiles}
                showDropdown={false}
                highlightedActivity={null}
                onPin={() => setNodeTooltip(t => t ? { ...t, pinned: true } : null)}
                onClose={() => setNodeTooltip(null)}
                onTooltipMouseEnter={cancelHide}
                onTooltipMouseLeave={scheduleHide}
              />
            );
          }
          const TW = 180, TH = 32;
          const left = Math.min(nodeTooltip.x + 14, cw - TW - 4);
          const top = Math.max(4, Math.min(nodeTooltip.y - TH - 8, ch - TH - 4));
          return (
            <div style={{ position: "absolute", left, top, background: "white", border: "1px solid #E2E8F0", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(15,23,42,0.12)", pointerEvents: "none", zIndex: 11, whiteSpace: "nowrap", maxWidth: TW }}>
              {nId}
            </div>
          );
        })()}
      </div>

      {/* Legend */}
      <div className="flex gap-8 text-xs flex-wrap flex-shrink-0">
        <div>
          <p className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide" style={{ fontSize: 10 }}>Resources</p>
          <div className="space-y-1">
            {nodeTypesPresent.map(t => (
              <div key={t} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: typeColorMap[t] ?? "#94a3b8" }} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide" style={{ fontSize: 10 }}>Handover object type</p>
          <div className="space-y-1">
            {allBoTypes.map(t => (
              <div key={t} className="flex items-center gap-2">
                <div className="w-4 h-2 rounded-sm flex-shrink-0" style={{ background: typeColorMap[t] ?? "#94a3b8" }} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
