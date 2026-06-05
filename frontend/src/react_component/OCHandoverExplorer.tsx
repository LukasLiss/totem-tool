import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, LockIcon, MinusIcon, PlusIcon, ScanIcon, UnlockIcon } from "lucide-react";
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
type DetailLayout = "counterpart-center" | "ego-center";

const NORMALIZATION_LABELS: Record<Normalization, string> = {
  by_source:       "By Source",
  by_target:       "By Target",
  by_arcs_in_eog:  "By Arcs in EOG",
  by_total_weight: "By Total Weight",
};

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
  const [logData, setLogData] = useState<EventLogData | null>(null);
  const [logStatus, setLogStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [logError, setLogError] = useState("");
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
  }, [normalization, normalizationScope, parallelFilterEnabled, parallelThreshold, minParallelObs]);

  // Reset selected node and locked height when data changes
  useEffect(() => { setSelectedNode(null); setLockedHeight(null); setViewMode("graph"); }, [data]);

  // Reset log data when fileId changes
  useEffect(() => {
    setLogData(null);
    setLogStatus("idle");
    setLogError("");
  }, [fileId]);

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
    hasStartedLoadingRef.current = false;
    setHasStartedLoading(false);
    setTimeout(() => { hasStartedLoadingRef.current = true; setHasStartedLoading(true); }, 0);
  };

  const toggleResourceType = (t: string) =>
    setResourceTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const toggleBoType = (t: string) =>
    setBoTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

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
  const maxRaw = useMemo(
    () => sortedEdges.reduce((m, e) => Math.max(m, e.raw_weight), 1),
    [sortedEdges],
  );

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

        {fileId && objectTypes.length > 0 && method === "oc" && (
          <div className="flex gap-4 flex-wrap justify-center">
            <TypeSelector title="Resource types" types={objectTypes} selected={resourceTypes} onToggle={toggleResourceType} />
            <TypeSelector title="Business object types" types={objectTypes} selected={boTypes} onToggle={toggleBoType} />
          </div>
        )}

        {fileId && objectTypes.length > 0 && method === "flattened" && (
          <div className="flex gap-4 flex-wrap justify-center">
            <SingleTypeSelector title="Case type" types={objectTypes} selected={caseType} onSelect={setCaseType} />
            <SingleTypeSelector title="Resource type" types={objectTypes} selected={flatResourceType} onSelect={setFlatResourceType} />
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
            <div className="flex gap-2">
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

            <div ref={resultsRef} style={lockedHeight ? { height: lockedHeight, overflow: "hidden" } : undefined}>
            {viewMode === "graph" && (
              selectedNode ? (
                <NodeDetailView
                  selectedNode={selectedNode}
                  data={data}
                  typeColorMap={typeColorMap}
                  onBack={() => setSelectedNode(null)}
                />
              ) : (
                <HandoverGraph
                  nodes={data.nodes}
                  edges={data.edges}
                  typeColorMap={typeColorMap}
                  onNodeClick={setSelectedNode}
                />
              )
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
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEdges.map((edge, i) => {
                      const color = typeColorMap[edge.businessobject_type] ?? "#94a3b8";
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
            </div>
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

function HandoverGraph({
  nodes,
  edges,
  typeColorMap,
  onNodeClick,
}: {
  nodes: HandoverNode[];
  edges: HandoverEdge[];
  typeColorMap: Record<string, string>;
  onNodeClick?: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [size, setSize] = useState({ width: 700, height: 450 });
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 700, h: 450 });
  const [isLocked, setIsLocked] = useState(false);
  const viewBoxRef = useRef(viewBox);
  useEffect(() => { viewBoxRef.current = viewBox; }, [viewBox]);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragHasMoved = useRef(false);
  const mouseDownPos = useRef({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; count: number; weight: number } | null>(null);
  const [nodeTooltip, setNodeTooltip] = useState<{ x: number; y: number; label: string } | null>(null);

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
    setPositions(pos);
    setViewBox({ x: 0, y: 0, w: size.width, h: size.height });
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

  const maxWeight = useMemo(() => Math.max(...edges.map(e => e.weight), 0.0001), [edges]);

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
      count: number;
      weight: number;
    }> = [];

    const strokeFor = (w: number) => Math.max(0.3, (w / maxWeight) * 6);

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
            color, strokeWidth, markerId, count: edge.raw_weight, weight: edge.weight,
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

        result.push({ key: `${pairKey}-${edge.businessobject_type}-${idx}`, d, color, strokeWidth, markerId, count: edge.raw_weight, weight: edge.weight });
      });
    });

    return result;
  }, [positions, edgeGroups, reverseSet, typeColorMap, maxWeight]);

  const zoomIn = () => {
    setViewBox(vb => {
      const nw = vb.w / 1.25, nh = vb.h / 1.25;
      return { x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - nh) / 2, w: nw, h: nh };
    });
  };

  const zoomOut = () => {
    setViewBox(vb => {
      const nw = vb.w * 1.25, nh = vb.h * 1.25;
      return { x: vb.x - (nw - vb.w) / 2, y: vb.y - (nh - vb.h) / 2, w: nw, h: nh };
    });
  };

  const fitToView = () => {
    if (Object.keys(positions).length === 0) {
      setViewBox({ x: 0, y: 0, w: size.width, h: size.height });
      return;
    }
    const xs = Object.values(positions).map(p => p.x);
    const ys = Object.values(positions).map(p => p.y);
    const pad = NODE_R + 20;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    setViewBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  };

  // Node drag handlers
  const handleNodeMouseDown = (id: string, e: React.MouseEvent) => {
    if (isLocked) return;
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
    if (!dragId || isLocked) return;
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
        x: Math.max(NODE_R, Math.min(size.width - NODE_R, userX - dragOffset.current.x)),
        y: Math.max(NODE_R, Math.min(size.height - NODE_R, userY - dragOffset.current.y)),
      },
    }));
  };

  const handleMouseUp = () => setDragId(null);

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="w-full border rounded-md overflow-hidden bg-background relative">
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
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
                d={ep.d}
                fill="none"
                markerEnd={`url(#${ep.markerId})`}
                style={{ stroke: ep.color, strokeWidth: ep.strokeWidth, opacity: 0.85, pointerEvents: "none" }}
              />
              <path
                d={ep.d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                onMouseEnter={e => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect || dragId) return;
                  setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, count: ep.count, weight: ep.weight });
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
          {nodes.map(node => {
            const pos = positions[node.id];
            if (!pos) return null;
            const color = typeColorMap[node.object_type] ?? "#94a3b8";
            const label = node.id.length > 11 ? node.id.slice(0, 11) + "…" : node.id;
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x},${pos.y})`}
                style={{ cursor: onNodeClick ? "pointer" : "grab" }}
                onMouseDown={e => handleNodeMouseDown(node.id, e)}
                onClick={() => { if (!dragHasMoved.current) onNodeClick?.(node.id); }}
                onMouseEnter={e => {
                  if (dragId) return;
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setNodeTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, label: node.id });
                }}
                onMouseMove={e => {
                  if (dragId) return;
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setNodeTooltip(t => t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
                }}
                onMouseLeave={() => setNodeTooltip(null)}
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
          <Button type="button" variant="outline" size="icon" onClick={zoomIn} className="rounded-full h-9 w-9">
            <PlusIcon className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={zoomOut} className="rounded-full h-9 w-9">
            <MinusIcon className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={fitToView} className="rounded-full h-9 w-9">
            <ScanIcon className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={isLocked ? "secondary" : "outline"}
            size="icon"
            onClick={() => setIsLocked(prev => !prev)}
            className="rounded-full h-9 w-9"
            title={isLocked ? "Unlock interactions" : "Lock interactions"}
          >
            {isLocked ? <UnlockIcon className="h-4 w-4" /> : <LockIcon className="h-4 w-4" />}
          </Button>
        </div>

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
          </div>
        )}
        {nodeTooltip && (() => {
          const TW = 180, TH = 32;
          const cw = containerRef.current?.offsetWidth ?? size.width;
          const ch = containerRef.current?.offsetHeight ?? size.height;
          const left = Math.min(nodeTooltip.x + 14, cw - TW - 4);
          const top = Math.max(4, Math.min(nodeTooltip.y - TH - 8, ch - TH - 4));
          return (
            <div style={{
              position: "absolute", left, top,
              background: "white", border: "1px solid #E2E8F0",
              borderRadius: 8, padding: "5px 10px",
              fontSize: 12, fontWeight: 600,
              boxShadow: "0 4px 12px rgba(15,23,42,0.12)",
              pointerEvents: "none", zIndex: 11, whiteSpace: "nowrap",
              maxWidth: TW,
            }}>
              {nodeTooltip.label}
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
}: {
  selectedNode: string;
  data: HandoverData;
  typeColorMap: Record<string, string>;
  onBack: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [egoNorm, setEgoNorm] = useState(false);
  const [detailLayout, setDetailLayout] = useState<DetailLayout>("counterpart-center");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; count: number; weight: number } | null>(null);
  const [nodeTooltip, setNodeTooltip] = useState<{ x: number; y: number; label: string } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    setWidth(containerRef.current.getBoundingClientRect().width || 700);
  }, []);

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
  const rawSvgH = Math.max(260, (nc === 0 ? 1 : nc) * ROW_H + PADDING_V * 2);
  const centerY = rawSvgH / 2;

  const midYOf = (i: number) => {
    if (nc === 0) return centerY;
    const totalH = (nc - 1) * ROW_H;
    return centerY - totalH / 2 + i * ROW_H;
  };

  // Self-arc routes BELOW all counterparts: compute the arc height needed to
  // clear the bottommost counterpart by 30px, then expand svgHeight to fit.
  const bottomNodeY = nc > 0 ? midYOf(nc - 1) : centerY;
  const selfArcBaseH = (detailLayout === "counterpart-center" && selfEdges.length > 0)
    ? Math.max(60, Math.ceil(((bottomNodeY + NODE_R - centerY) + 30) * 4 / 3))
    : 0;
  const svgHeight = (detailLayout === "counterpart-center" && selfEdges.length > 0)
    ? Math.max(rawSvgH, Math.ceil(centerY + selfArcBaseH + (selfEdges.length - 1) * 22 + 30))
    : rawSvgH;

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

  const paths: Array<{ key: string; d: string; color: string; strokeWidth: number; markerId: string; count: number; weight: number }> = [];

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
    });
  };

  if (detailLayout === "counterpart-center") {
    // Out edges: ego (left) → counterpart (center)
    counterpartIds.forEach((cpId, i) => {
      const cy = midYOf(i);
      outEdges.filter(e => e.target === cpId).forEach((edge, j, arr) => {
        pushEdge(`out-${cpId}-${j}`, LEFT_X, centerY, MID_X, cy, edge,
          (j - (arr.length - 1) / 2) * OFFSET_STEP);
      });
    });

    // In edges: counterpart (center) → ego (right)
    counterpartIds.forEach((cpId, i) => {
      const cy = midYOf(i);
      inEdges.filter(e => e.source === cpId).forEach((edge, j, arr) => {
        pushEdge(`in-${cpId}-${j}`, MID_X, cy, RIGHT_X, centerY, edge,
          (j - (arr.length - 1) / 2) * OFFSET_STEP);
      });
    });

    // Self-arc: ego (left) → ego (right), curved below all counterparts
    selfEdges.forEach((edge, j) => {
      const arcH = selfArcBaseH + j * 22;
      const c1x = LEFT_X, c1y = centerY + arcH;
      const c2x = RIGHT_X, c2y = centerY + arcH;
      const tipX = RIGHT_X, tipY = centerY + NODE_R;
      const ddx = tipX - c2x, ddy = tipY - c2y;
      const ddLen = Math.hypot(ddx, ddy) || 1;
      const ex = tipX - (ddx / ddLen) * ARROW_LEN;
      const ey = tipY - (ddy / ddLen) * ARROW_LEN;
      paths.push({
        key: `self-${j}`,
        d: `M ${LEFT_X} ${centerY + NODE_R} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`,
        color: typeColorMap[edge.businessobject_type] ?? "#94a3b8",
        strokeWidth: strokeFor(getW(edge)),
        markerId: arrowId(edge.businessobject_type),
        count: edge.raw_weight,
        weight: getW(edge),
      });
    });
  } else {
    // Out edges: ego (center) → counterpart (right)
    counterpartIds.forEach((cpId, i) => {
      const cy = midYOf(i);
      outEdges.filter(e => e.target === cpId).forEach((edge, j, arr) => {
        pushEdge(`out-${cpId}-${j}`, MID_X, centerY, RIGHT_X, cy, edge,
          (j - (arr.length - 1) / 2) * OFFSET_STEP);
      });
    });

    // In edges: counterpart (left) → ego (center)
    counterpartIds.forEach((cpId, i) => {
      const cy = midYOf(i);
      inEdges.filter(e => e.source === cpId).forEach((edge, j, arr) => {
        pushEdge(`in-${cpId}-${j}`, LEFT_X, cy, MID_X, centerY, edge,
          (j - (arr.length - 1) / 2) * OFFSET_STEP);
      });
    });

    // Self-loop on ego node (center), arcing above
    selfEdges.forEach((edge, j) => {
      const spread = j * NODE_R * 0.9;
      const loopH = NODE_R * 2.4 + spread;
      const loopW = NODE_R * 1.6 + spread;
      const startA = -Math.PI * 0.72;
      const startX = MID_X + NODE_R * Math.cos(startA);
      const startY = centerY + NODE_R * Math.sin(startA);
      const cp1x = MID_X - loopW, cp1y = centerY - loopH;
      const cp2x = MID_X + loopW, cp2y = centerY - loopH;
      const endA = -Math.PI * 0.28;
      const endTX = MID_X + NODE_R * Math.cos(endA);
      const endTY = centerY + NODE_R * Math.sin(endA);
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
      });
    });
  }

  const lbl = (id: string) => id.length > 11 ? id.slice(0, 11) + "…" : id;

  const nodeHandlers = (label: string) => ({
    onMouseEnter: (e: React.MouseEvent<SVGGElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setNodeTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, label });
    },
    onMouseMove: (e: React.MouseEvent<SVGGElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setNodeTooltip(t => t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
    },
    onMouseLeave: () => setNodeTooltip(null),
  });

  const nodeTypesPresent = [...new Set([
    nodeById[selectedNode]?.object_type,
    ...counterpartIds.map(id => nodeById[id]?.object_type),
  ].filter(Boolean) as string[])];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onBack}>← Back</Button>
          <span className="text-sm text-muted-foreground">
            Handover detail for{" "}
            <span className="font-mono font-semibold text-foreground">{selectedNode}</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="detail-layout" checked={detailLayout === "ego-center"} onCheckedChange={v => setDetailLayout(v ? "ego-center" : "counterpart-center")} />
            <Label htmlFor="detail-layout" className="text-sm cursor-pointer">Ego center</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="ego-norm" checked={egoNorm} onCheckedChange={setEgoNorm} />
            <Label htmlFor="ego-norm" className="text-sm cursor-pointer">Ego normalization</Label>
          </div>
        </div>
      </div>

      <div ref={containerRef} className="w-full border rounded-md overflow-hidden bg-background relative">
        <svg width={width} height={svgHeight} style={{ display: "block" }}>
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

          {/* Column labels */}
          {detailLayout === "counterpart-center" ? <>
            <text x={LEFT_X} y={22} textAnchor="middle" fontSize={10} fill="gray" opacity={0.7} fontWeight="600">Sender</text>
            <text x={MID_X} y={22} textAnchor="middle" fontSize={10} fill="gray" opacity={0.7} fontWeight="600">Counterparts</text>
            <text x={RIGHT_X} y={22} textAnchor="middle" fontSize={10} fill="gray" opacity={0.7} fontWeight="600">Receiver</text>
          </> : <>
            <text x={LEFT_X} y={22} textAnchor="middle" fontSize={10} fill="gray" opacity={0.7} fontWeight="600">Sender</text>
            <text x={MID_X} y={22} textAnchor="middle" fontSize={10} fill="gray" opacity={0.7} fontWeight="600">Ego</text>
            <text x={RIGHT_X} y={22} textAnchor="middle" fontSize={10} fill="gray" opacity={0.7} fontWeight="600">Receiver</text>
          </>}

          {/* Edges */}
          {paths.map(p => (
            <g key={p.key}>
              <path d={p.d} fill="none"
                markerEnd={`url(#${p.markerId})`}
                style={{ stroke: p.color, strokeWidth: p.strokeWidth, opacity: 0.85, pointerEvents: "none" }} />
              <path d={p.d} fill="none" stroke="transparent" strokeWidth={12}
                onMouseEnter={e => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, count: p.count, weight: p.weight });
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

          {detailLayout === "counterpart-center" ? <>
            {/* Left: ego as sender */}
            <g transform={`translate(${LEFT_X},${centerY})`} {...nodeHandlers(selectedNode)}>
              <circle r={NODE_R} fill={selectedColor} stroke="white" strokeWidth={2} />
              <text textAnchor="middle" dominantBaseline="central" fontSize={9} fill="white" fontWeight="600"
                style={{ pointerEvents: "none", userSelect: "none" }}>{lbl(selectedNode)}</text>
            </g>
            {/* Center: counterpart nodes */}
            {counterpartIds.map((cpId, i) => {
              const cy = midYOf(i);
              const color = typeColorMap[nodeById[cpId]?.object_type ?? ""] ?? "#94a3b8";
              return (
                <g key={cpId} transform={`translate(${MID_X},${cy})`} {...nodeHandlers(cpId)}>
                  <circle r={NODE_R} fill={color} stroke="white" strokeWidth={2} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={9} fill="white" fontWeight="600"
                    style={{ pointerEvents: "none", userSelect: "none" }}>{lbl(cpId)}</text>
                </g>
              );
            })}
            {/* Right: ego as receiver */}
            <g transform={`translate(${RIGHT_X},${centerY})`} {...nodeHandlers(selectedNode)}>
              <circle r={NODE_R} fill={selectedColor} stroke="white" strokeWidth={2} />
              <text textAnchor="middle" dominantBaseline="central" fontSize={9} fill="white" fontWeight="600"
                style={{ pointerEvents: "none", userSelect: "none" }}>{lbl(selectedNode)}</text>
            </g>
          </> : <>
            {/* Left: counterpart nodes (as senders) */}
            {counterpartIds.map((cpId, i) => {
              const cy = midYOf(i);
              const color = typeColorMap[nodeById[cpId]?.object_type ?? ""] ?? "#94a3b8";
              return (
                <g key={`left-${cpId}`} transform={`translate(${LEFT_X},${cy})`} {...nodeHandlers(cpId)}>
                  <circle r={NODE_R} fill={color} stroke="white" strokeWidth={2} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={9} fill="white" fontWeight="600"
                    style={{ pointerEvents: "none", userSelect: "none" }}>{lbl(cpId)}</text>
                </g>
              );
            })}
            {/* Center: ego node */}
            <g transform={`translate(${MID_X},${centerY})`} {...nodeHandlers(selectedNode)}>
              <circle r={NODE_R} fill={selectedColor} stroke="white" strokeWidth={2} />
              <text textAnchor="middle" dominantBaseline="central" fontSize={9} fill="white" fontWeight="600"
                style={{ pointerEvents: "none", userSelect: "none" }}>{lbl(selectedNode)}</text>
            </g>
            {/* Right: counterpart nodes (as receivers) */}
            {counterpartIds.map((cpId, i) => {
              const cy = midYOf(i);
              const color = typeColorMap[nodeById[cpId]?.object_type ?? ""] ?? "#94a3b8";
              return (
                <g key={`right-${cpId}`} transform={`translate(${RIGHT_X},${cy})`} {...nodeHandlers(cpId)}>
                  <circle r={NODE_R} fill={color} stroke="white" strokeWidth={2} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={9} fill="white" fontWeight="600"
                    style={{ pointerEvents: "none", userSelect: "none" }}>{lbl(cpId)}</text>
                </g>
              );
            })}
          </>}
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
          </div>
        )}
        {nodeTooltip && (() => {
          const TW = 180, TH = 32;
          const cw = containerRef.current?.offsetWidth ?? width;
          const ch = containerRef.current?.offsetHeight ?? svgHeight;
          const left = Math.min(nodeTooltip.x + 14, cw - TW - 4);
          const top = Math.max(4, Math.min(nodeTooltip.y - TH - 8, ch - TH - 4));
          return (
            <div style={{
              position: "absolute", left, top,
              background: "white", border: "1px solid #E2E8F0",
              borderRadius: 8, padding: "5px 10px",
              fontSize: 12, fontWeight: 600,
              boxShadow: "0 4px 12px rgba(15,23,42,0.12)",
              pointerEvents: "none", zIndex: 11, whiteSpace: "nowrap",
              maxWidth: TW,
            }}>
              {nodeTooltip.label}
            </div>
          );
        })()}
      </div>

      {/* Legend */}
      <div className="flex gap-8 text-xs flex-wrap">
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
