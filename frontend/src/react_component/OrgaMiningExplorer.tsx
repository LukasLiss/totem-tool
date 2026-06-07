import { useEffect, useMemo, useRef, useState, useContext } from "react";
import TooltipBox, { pieSlicePath } from "@/react_component/ResourceTooltip";
import { ClusterContext, type TypeNMap } from "@/contexts/ClusterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { mapTypesToColors } from "@/utils/objectColors";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CircleDashed, ScanIcon, Share2 } from "lucide-react";

/* ── Types ─────────────────────────────────────────────────── */

type ProfileMatrixData = {
  resources: string[];
  activities: string[];
  values: number[][];
  resource_object_types: Record<string, string>;
  feature_groups: string[];
  cooccurring_resources?: string[];
  collaborating_resources?: string[];
  time_bins?: number[];
  weekday_bins?: number[];
  portfolio_object_types?: string[];
  mds_positions: { x: number; y: number }[];
  mds_stress: number;
  mds_explained_variance: number;
  mds_scale?: number;
  cluster_labels?: number[];
  n_clusters?: number;
  type_totals?: Record<string, number>;
  cooc_type_n?: TypeNMap;
  collab_type_n?: TypeNMap;
  // activities / time / weekday / portfolio fractions per resource and cluster avg
  tooltip_profiles?: Record<string, { activities?: number[]; time?: number[]; weekday?: number[]; portfolio?: number[] }>;
};

type OrgaMiningExplorerProps = {
  fileId?: number;
  embedded?: boolean;
};

type ViewMode = "table" | "graph";

const NODE_R = 8;

// Cluster colour palette — intentionally different hues from ACTIVITY_COLORS
const CLUSTER_COLORS = [
  "#f43f5e", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#8b5cf6", "#ec4899", "#14b8a6",
];

const ACTIVITY_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
  "#06b6d4", "#a855f7", "#d946ef", "#0ea5e9", "#22c55e",
  "#fb923c", "#e879f9", "#34d399", "#60a5fa", "#facc15",
];


/* ── Main component ─────────────────────────────────────────── */
export default function OrgaMiningExplorer({
  fileId,
  embedded = false,
}: OrgaMiningExplorerProps) {
  const [objectTypes, setObjectTypes] = useState<string[]>([]);
  const [resourceTypes, setResourceTypes] = useState<Set<string>>(new Set());
  const [data, setData] = useState<ProfileMatrixData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [hasStartedLoading, setHasStartedLoading] = useState(false);
  const hasStartedLoadingRef = useRef(false);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [featureGroups, setFeatureGroups] = useState<Set<string>>(new Set(["activity_fractions"]));
  const [businessObjectTypes, setBusinessObjectTypes] = useState<Set<string>>(new Set());
  const [clustersEnabled, setClustersEnabled] = useState(true);
  const [nClusters, setNClusters] = useState(3);
  const [nClustersStr, setNClustersStr] = useState("3");
  const [clusterMethod, setClusterMethod] = useState<"kmeans" | "agglomerative" | "hdbscan">("hdbscan");
  const [distanceMetric, setDistanceMetric] = useState<"euclidean" | "hellinger">("euclidean");
  const [minClusterSize, setMinClusterSize] = useState(2);
  const [minClusterSizeStr, setMinClusterSizeStr] = useState("2");
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const { setClusterInfo } = useContext(ClusterContext);
  const [graphSize, setGraphSize] = useState({ width: 700, height: 450 });
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const viewModeRef = useRef(viewMode);
  const statusRef = useRef(status);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { statusRef.current = status; }, [status]);
  const fileIdRef = useRef<number | undefined>(fileId);
  useEffect(() => { fileIdRef.current = fileId; }, [fileId]);

  // Measure the graph container; reset results if the width changes after data loaded.
  // Skip zero-width measurements (element hidden, e.g. in an inactive tab) so we
  // don't fall back to the 700 px default and then compute with the wrong width.
  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const measure = () => {
      const raw = Math.round(el.getBoundingClientRect().width);
      if (raw === 0) return;                       // not visible yet — wait for next event
      const w = raw;
      setGraphSize(prev => {
        if (prev.width === w) return prev;
        if (statusRef.current !== "idle") {        // reset even during "loading"
          setData(null);
          setStatus("idle");
          hasStartedLoadingRef.current = false;
          setHasStartedLoading(false);
        }
        return { width: w, height: Math.min(1000, Math.max(400, Math.round(w * 0.62))) };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        // Default: all types are potential business objects; the selector will
        // show only the non-resource subset, all pre-selected.
        setBusinessObjectTypes(new Set(types));
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
    params.width      = String(graphSize.width);
    params.height     = String(graphSize.height);
    params.feature_groups = [...featureGroups].join(",");

    if (featureGroups.has("object_collaboration_fractions")) {
      // Send only business object types that are not currently resource types.
      const activeBizTypes = [...businessObjectTypes].filter(t => !resourceTypes.has(t));
      if (activeBizTypes.length > 0)
        params.business_object_types = activeBizTypes.join(",");
    }

    params.distance_metric = distanceMetric;

    if (clustersEnabled) {
      params.cluster_method = clusterMethod;
      if (clusterMethod === "hdbscan") {
        params.min_cluster_size = String(minClusterSize);
      } else {
        params.n_clusters = String(nClusters);
      }
    } else {
      params.compute_clusters = "false";
    }

    let cancelled = false;

    (async () => {
      if (fileIdRef.current !== currentFileId) return;
      setStatus("loading");
      setErrorMsg("");

      const token = localStorage.getItem("access_token");
      if (!token) { setStatus("error"); setErrorMsg("Not authenticated"); return; }

      try {
        const res = await fetch(`/api/profile-matrix/?${new URLSearchParams(params)}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (fileIdRef.current !== currentFileId || cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const result: ProfileMatrixData = await res.json();
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

  useEffect(() => { setLockedHeight(null); setViewMode("graph"); }, [data]);

  // Sync cluster assignments into ClusterContext whenever a new result arrives.
  // Clears the context when data is reset or clustering was disabled.
  useEffect(() => {
    if (!data?.cluster_labels) { setClusterInfo(null); return; }
    const labels = data.cluster_labels;
    const clusterMap: Record<string, string> = {};
    data.resources.forEach((r, i) => {
      if (labels[i] >= 0) clusterMap[r] = `Cluster ${labels[i] + 1}`;
    });
    setClusterInfo({
      resources: data.resources,
      resourceObjectTypes: data.resource_object_types,
      clusterLabels: labels,
      nClusters: data.n_clusters ?? 0,
      hasOutliers: labels.includes(-1),
      clusterMap,
      activities: data.activities,
      cooccurringResources: data.cooccurring_resources ?? [],
      collaboratingResources: data.collaborating_resources ?? [],
      timeBins: data.time_bins ?? [],
      weekdayBins: data.weekday_bins ?? [],
      portfolioObjectTypes: data.portfolio_object_types ?? [],
      tooltipProfiles: data.tooltip_profiles ?? {},
      typeTotals: data.type_totals ?? {},
      coocTypeN: data.cooc_type_n ?? {},
      collabTypeN: data.collab_type_n ?? {},
    });
  }, [data, setClusterInfo]);

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
          <CardTitle className="text-lg">Profile Matrix</CardTitle>
        </CardHeader>
      )}

      <CardContent className="space-y-4">
        {!fileId && (
          <p className="text-sm text-muted-foreground">Select a file to start.</p>
        )}

        {fileId && <div ref={graphContainerRef} className="w-full" />}

        {fileId && objectTypes.length > 0 && (
          <div className="flex gap-4 flex-wrap items-start">
            <TypeSelector
              title="Resource types"
              types={objectTypes}
              selected={resourceTypes}
              onToggle={toggleResourceType}
              colorMap={typeColorMap}
            />
            {/* Feature group selector */}
            <div className="border rounded-md p-3 min-w-[180px]">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Features</p>
              <div className="space-y-1.5">
                {([
                  { key: "activity_fractions",          label: "Activity fractions" },
                  { key: "cooccurrence_fractions",      label: "Co-occurrence" },
                  { key: "object_collaboration_fractions", label: "Object collaboration" },
                  { key: "object_portfolio_fractions",   label: "BO type fractions" },
                  { key: "time_fractions",              label: "Time binning (hourly)" },
                  { key: "weekday_fractions",           label: "Time binning (weekly)" },
                ] as const).map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Switch
                      id={`pm-fg-${key}`}
                      checked={featureGroups.has(key)}
                      onCheckedChange={() =>
                        setFeatureGroups(prev => {
                          const n = new Set(prev);
                          n.has(key) ? n.delete(key) : n.add(key);
                          return n;
                        })
                      }
                    />
                    <Label htmlFor={`pm-fg-${key}`} className="text-sm cursor-pointer">{label}</Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Business object type selector — only when object collaboration is active */}
            {featureGroups.has("object_collaboration_fractions") && (() => {
              const nonResourceTypes = objectTypes.filter(t => !resourceTypes.has(t));
              if (nonResourceTypes.length === 0) return null;
              return (
                <TypeSelector
                  title="Case object types"
                  types={nonResourceTypes}
                  selected={businessObjectTypes}
                  onToggle={t => setBusinessObjectTypes(prev => {
                    const n = new Set(prev);
                    n.has(t) ? n.delete(t) : n.add(t);
                    return n;
                  })}
                  colorMap={typeColorMap}
                />
              );
            })()}

            {/* Cluster settings control */}
            <div className="border rounded-md p-3 min-w-[160px] space-y-3">
              {/* Enable/disable toggle */}
              <div className="flex items-center gap-2">
                <Switch
                  id="pm-clusters-enabled"
                  checked={clustersEnabled}
                  onCheckedChange={setClustersEnabled}
                />
                <Label htmlFor="pm-clusters-enabled" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer">
                  Clustering
                </Label>
              </div>

              {/* k / min-cluster-size and method — dimmed when clustering is off */}
              <div className={clustersEnabled ? "" : "opacity-40 pointer-events-none"}>
                {clusterMethod !== "hdbscan" ? (
                  <>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Clusters (k)</p>
                    <div className="flex items-center gap-1">
                      <button
                        className="h-7 w-7 rounded border text-sm flex items-center justify-center hover:bg-muted"
                        onClick={() => { const v = Math.max(1, nClusters - 1); setNClusters(v); setNClustersStr(String(v)); }}
                      >−</button>
                      <input
                        type="text" inputMode="numeric" pattern="[0-9]*"
                        value={nClustersStr}
                        onChange={e => {
                          const raw = e.target.value;
                          setNClustersStr(raw);
                          const n = parseInt(raw, 10);
                          if (!isNaN(n) && n >= 1) setNClusters(n);
                        }}
                        onBlur={() => setNClustersStr(String(nClusters))}
                        className="h-7 w-10 text-sm text-center border rounded"
                      />
                      <button
                        className="h-7 w-7 rounded border text-sm flex items-center justify-center hover:bg-muted"
                        onClick={() => { const v = nClusters + 1; setNClusters(v); setNClustersStr(String(v)); }}
                      >+</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Min. cluster size</p>
                    <div className="flex items-center gap-1">
                      <button
                        className="h-7 w-7 rounded border text-sm flex items-center justify-center hover:bg-muted"
                        onClick={() => { const v = Math.max(2, minClusterSize - 1); setMinClusterSize(v); setMinClusterSizeStr(String(v)); }}
                      >−</button>
                      <input
                        type="text" inputMode="numeric" pattern="[0-9]*"
                        value={minClusterSizeStr}
                        onChange={e => {
                          const raw = e.target.value;
                          setMinClusterSizeStr(raw);
                          const n = parseInt(raw, 10);
                          if (!isNaN(n) && n >= 2) setMinClusterSize(n);
                        }}
                        onBlur={() => setMinClusterSizeStr(String(minClusterSize))}
                        className="h-7 w-10 text-sm text-center border rounded"
                      />
                      <button
                        className="h-7 w-7 rounded border text-sm flex items-center justify-center hover:bg-muted"
                        onClick={() => { const v = minClusterSize + 1; setMinClusterSize(v); setMinClusterSizeStr(String(v)); }}
                      >+</button>
                    </div>
                  </>
                )}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-3">Method</p>
                <div className="flex rounded border overflow-hidden text-xs">
                  {(["kmeans", "agglomerative", "hdbscan"] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setClusterMethod(m)}
                      className={`flex-1 py-1 px-2 ${clusterMethod === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                    >
                      {m === "kmeans" ? "K-Means" : m === "agglomerative" ? "Agglom." : "HDBSCAN"}
                    </button>
                  ))}
                </div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-3">Distance</p>
                <div className="flex rounded border overflow-hidden text-xs">
                  {(["euclidean", "hellinger"] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => setDistanceMetric(d)}
                      className={`flex-1 py-1 px-2 ${distanceMetric === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                    >
                      {d === "euclidean" ? "Euclidean" : "Hellinger"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
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
              {status === "loading" ? "Computing…" : "Compute Profile Matrix"}
            </Button>
            {status === "loading" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                Computing profile matrix…
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
                <ResourceGraph data={data} typeColorMap={typeColorMap} size={graphSize} clusterColors={CLUSTER_COLORS} showClusters={data.cluster_labels !== undefined} />
              )}

              {viewMode === "table" && (() => {
                const MAX_ROWS = 500;
                const truncated = data.resources.length > MAX_ROWS;
                const visibleResources = truncated ? data.resources.slice(0, MAX_ROWS) : data.resources;
                return (
                  <div className="space-y-2">
                    {truncated && (
                      <div className="text-xs text-muted-foreground px-1">
                        Showing first {MAX_ROWS} of {data.resources.length} resources.
                      </div>
                    )}
                    <div
                      className="overflow-auto rounded-md border"
                      style={lockedHeight ? { maxHeight: lockedHeight } : undefined}
                    >
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          {/* Group header row — only shown when multiple feature groups exist */}
                          {((data.cooccurring_resources?.length ?? 0) > 0 || (data.collaborating_resources?.length ?? 0) > 0 || (data.time_bins?.length ?? 0) > 0 || (data.weekday_bins?.length ?? 0) > 0 || (data.portfolio_object_types?.length ?? 0) > 0) && (
                            <tr className="bg-muted/60 border-b">
                              <th className="sticky top-0 left-0 bg-muted/60 z-30 border-r" />
                              {data.activities.length > 0 && (
                                <th colSpan={data.activities.length}
                                  className="px-3 py-1 text-left text-xs font-semibold text-muted-foreground sticky top-0 bg-muted/60 z-20 border-r whitespace-nowrap">
                                  Activity fractions
                                </th>
                              )}
                              {(data.cooccurring_resources?.length ?? 0) > 0 && (
                                <th colSpan={data.cooccurring_resources!.length}
                                  className="px-3 py-1 text-left text-xs font-semibold text-muted-foreground sticky top-0 bg-muted/60 z-20 border-r whitespace-nowrap">
                                  Co-occurrence
                                </th>
                              )}
                              {(data.collaborating_resources?.length ?? 0) > 0 && (
                                <th colSpan={data.collaborating_resources!.length}
                                  className="px-3 py-1 text-left text-xs font-semibold text-muted-foreground sticky top-0 bg-muted/60 z-20 border-r whitespace-nowrap">
                                  Object collaboration
                                </th>
                              )}
                              {(data.time_bins?.length ?? 0) > 0 && (
                                <th colSpan={data.time_bins!.length}
                                  className="px-3 py-1 text-left text-xs font-semibold text-muted-foreground sticky top-0 bg-muted/60 z-20 border-r whitespace-nowrap">
                                  Time (hourly)
                                </th>
                              )}
                              {(data.weekday_bins?.length ?? 0) > 0 && (
                                <th colSpan={data.weekday_bins!.length}
                                  className="px-3 py-1 text-left text-xs font-semibold text-muted-foreground sticky top-0 bg-muted/60 z-20 border-r whitespace-nowrap">
                                  Time (weekly)
                                </th>
                              )}
                              {(data.portfolio_object_types?.length ?? 0) > 0 && (
                                <th colSpan={data.portfolio_object_types!.length}
                                  className="px-3 py-1 text-left text-xs font-semibold text-muted-foreground sticky top-0 bg-muted/60 z-20 border-r whitespace-nowrap">
                                  BO type fractions
                                </th>
                              )}
                            </tr>
                          )}
                          <tr className="border-b bg-muted">
                            <th className="px-3 py-2 text-left font-medium sticky top-0 left-0 bg-muted z-30 border-r whitespace-nowrap">
                              Resource
                            </th>
                            {data.activities.map(act => (
                              <th key={act} className="px-3 py-2 text-left font-medium sticky top-0 bg-muted z-20 whitespace-nowrap">
                                {act}
                              </th>
                            ))}
                            {(data.cooccurring_resources ?? []).map(r => (
                              <th key={`cooc-${r}`} className="px-3 py-2 text-left font-medium sticky top-0 bg-muted z-20 whitespace-nowrap border-l font-mono text-xs">
                                {r}
                              </th>
                            ))}
                            {(data.collaborating_resources ?? []).map(r => (
                              <th key={`collab-${r}`} className="px-3 py-2 text-left font-medium sticky top-0 bg-muted z-20 whitespace-nowrap border-l font-mono text-xs">
                                {r}
                              </th>
                            ))}
                            {(data.time_bins ?? []).map(h => (
                              <th key={`time-${h}`} className="px-3 py-2 text-left font-medium sticky top-0 bg-muted z-20 whitespace-nowrap border-l font-mono text-xs">
                                {String(h).padStart(2, "0")}h
                              </th>
                            ))}
                            {(data.weekday_bins ?? []).map(d => (
                              <th key={`wd-${d}`} className="px-3 py-2 text-left font-medium sticky top-0 bg-muted z-20 whitespace-nowrap border-l font-mono text-xs">
                                {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][d]}
                              </th>
                            ))}
                            {(data.portfolio_object_types ?? []).map(t => (
                              <th key={`po-${t}`} className="px-3 py-2 text-left font-medium sticky top-0 bg-muted z-20 whitespace-nowrap border-l font-mono text-xs">
                                {t}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleResources.map((resource, ri) => (
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
                  </div>
                );
              })()}
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

/* ── Convex hull helpers ────────────────────────────────────── */
type Pt = { x: number; y: number };

/** Gift-wrapping convex hull. Returns vertices in CCW order. */
function convexHull(pts: Pt[]): Pt[] {
  if (pts.length <= 2) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Expand each hull vertex outward from the centroid by `pad` pixels. */
function expandHull(hull: Pt[], pad: number): Pt[] {
  if (hull.length === 0) return hull;
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
  return hull.map(p => {
    const dx = p.x - cx, dy = p.y - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: p.x + (dx / len) * pad, y: p.y + (dy / len) * pad };
  });
}

/* ── PieNode ────────────────────────────────────────────────── */

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

/** Perpendicular distance from point P to line segment AB (in the same coordinate space). */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/* ── ResourceGraph ──────────────────────────────────────────── */
type ZoomedView = { x: number; y: number; w: number; h: number };

function ResourceGraph({
  data,
  typeColorMap,
  size,
  clusterColors,
  showClusters,
}: {
  data: ProfileMatrixData;
  typeColorMap: Record<string, string>;
  size: { width: number; height: number };
  clusterColors: string[];
  showClusters: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rbRef = useRef<SVGRectElement>(null);
  const [zoomed, setZoomed] = useState<ZoomedView | null>(null);
  const [showClusterOverlay, setShowClusterOverlay] = useState(true);
  // null = off; "cooccurrence" | "collaboration" = edge overlay mode
  const [edgeMode, setEdgeMode] = useState<null | "cooccurrence" | "collaboration">(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number;
    resources: string[];
    profile: number[];
    clusterLabel: number;
    isCluster: boolean;   // true = cluster hull tooltip, false = individual node tooltip
    pinned: boolean;
    cw: number; ch: number;
  } | null>(null);
  const [highlightedActivity, setHighlightedActivity] = useState<string | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<{
    x: number; y: number;
    nearby: { ai: number; bi: number; wij: number; wji: number; weight: number }[];
    cw: number; ch: number;
  } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activityColorMap = useMemo(() =>
    Object.fromEntries(data.activities.map((act, i) => [act, ACTIVITY_COLORS[i % ACTIVITY_COLORS.length]])),
  [data.activities]);

  const resourceColorMap = useMemo(() =>
    Object.fromEntries(
      Object.entries(data.resource_object_types).map(([rid, typ]) => [rid, typeColorMap[typ] ?? "#94a3b8"])
    ),
  [data.resource_object_types, typeColorMap]);

  // Individual profile vector per resource — needed by the cluster tooltip
  // to compute avg-n (average count of collaborators per type across cluster members).
  const allProfiles = useMemo(() =>
    Object.fromEntries(data.resources.map((r, i) => [r, data.values[i]])),
  [data.resources, data.values]);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const scheduleHide = () => {
    hideTimerRef.current = setTimeout(
      () => setTooltip(t => (t?.pinned ? t : null)),
      150,
    );
  };
  const cancelHide = () => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
  };

  // Escape to close tooltip / clear highlight
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setTooltip(null); setHighlightedActivity(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); cancelHide(); };
  }, []);

  // Current viewBox — always normalized to the container aspect ratio so
  // preserveAspectRatio="meet" never letterboxes and toUser stays a simple linear map.
  const BADGE_R = 5;
  const vb = zoomed ?? { x: 0, y: 0, w: size.width, h: size.height };
  // Because vb is always aspect-ratio-matched, both axes have the same scale factor.
  const effectiveScale = size.width / vb.w;
  const nodeR  = NODE_R  / effectiveScale;
  const badgeR = BADGE_R / effectiveScale;

  // Convert screen coords → SVG user coords using the current viewBox.
  // Works at every zoom level because vb is always aspect-matched to the SVG element.
  const toUser = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width  * vb.w + vb.x,
      y: (clientY - rect.top)  / rect.height * vb.h + vb.y,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const { x, y } = toUser(e.clientX, e.clientY);
    dragStart.current = { x, y };
    // Dismiss any unpinned tooltip the moment a drag begins
    setTooltip(t => (t?.pinned ? t : null));
    const el = rbRef.current;
    if (el) { el.setAttribute("x", String(x)); el.setAttribute("y", String(y)); el.setAttribute("width", "0"); el.setAttribute("height", "0"); el.setAttribute("display", "block"); }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragStart.current) {
      const { x, y } = toUser(e.clientX, e.clientY);
      const rx = Math.min(dragStart.current.x, x), ry = Math.min(dragStart.current.y, y);
      const rw = Math.abs(x - dragStart.current.x), rh = Math.abs(y - dragStart.current.y);
      const el = rbRef.current;
      if (el) { el.setAttribute("x", String(rx)); el.setAttribute("y", String(ry)); el.setAttribute("width", String(rw)); el.setAttribute("height", String(rh)); }
      setEdgeTooltip(null);
      return;
    }
    // Edge proximity: collect all edges within 8 screen-px of the cursor.
    if (edgeMode && edges.length > 0) {
      const { x, y } = toUser(e.clientX, e.clientY);
      // Suppress edge tooltip while hovering any node — nodeR is already in user-space.
      const onNode = data.mds_positions.some(
        pos => Math.hypot(x - pos.x, y - pos.y) <= nodeR + 4 / effectiveScale,
      );
      if (onNode) { setEdgeTooltip(null); return; }
      const threshold = 8 / effectiveScale;
      const nearby = edges.filter(edge => {
        const pa = data.mds_positions[edge.ai];
        const pb = data.mds_positions[edge.bi];
        return pa && pb && distToSegment(x, y, pa.x, pa.y, pb.x, pb.y) <= threshold;
      });
      const el = containerRef.current;
      if (!el) { setEdgeTooltip(null); return; }
      const rect = el.getBoundingClientRect();
      setEdgeTooltip(nearby.length > 0 ? {
        x: e.clientX - rect.left, y: e.clientY - rect.top,
        nearby, cw: el.offsetWidth, ch: el.offsetHeight,
      } : null);
    } else {
      setEdgeTooltip(null);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const { x, y } = toUser(e.clientX, e.clientY);
    const x0 = dragStart.current.x, y0 = dragStart.current.y;
    dragStart.current = null;
    rbRef.current?.setAttribute("display", "none");
    let rw = Math.abs(x - x0), rh = Math.abs(y - y0);
    // Minimum selection of 10 screen pixels in each direction
    if (rw * effectiveScale < 10 || rh * effectiveScale < 10) return;
    // Expand the shorter side to match the container aspect ratio so the next
    // viewBox is also aspect-matched → no letterboxing at any zoom depth.
    const aspect = size.width / size.height;
    const cx = Math.min(x0, x) + rw / 2;
    const cy = Math.min(y0, y) + rh / 2;
    if (rw / rh > aspect) { rh = rw / aspect; } else { rw = rh * aspect; }
    setZoomed({ x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh });
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

  // Map each group to its MDS position using the first resource in the group.
  // All resources in a group share an identical profile so their positions are identical.
  const positions = useMemo(() =>
    groups.map(g => {
      const idx = data.resources.indexOf(g.resources[0]);
      return idx >= 0 ? data.mds_positions[idx] : { x: size.width / 2, y: size.height / 2 };
    }),
  [groups, data.resources, data.mds_positions, size]);

  // Map each group key → cluster label (via first resource index)
  const groupClusterLabel = useMemo(() => {
    const map = new Map<string, number>();
    const labels = data.cluster_labels;
    if (!labels) return map;
    groups.forEach(g => {
      const idx = data.resources.indexOf(g.resources[0]);
      if (idx >= 0) map.set(g.key, labels[idx] ?? 0);
    });
    return map;
  }, [groups, data.resources, data.cluster_labels]);

  // Average profile + full resource list per cluster
  const clusterData = useMemo(() => {
    // Use the full profile length (activities + cooccurrence + collaboration columns).
    const nFeatures = data.values[0]?.length ?? data.activities.length;
    const acc = new Map<number, { sum: number[]; resources: string[] }>();
    groups.forEach(g => {
      const label = groupClusterLabel.get(g.key) ?? -1;
      if (label < 0) return;   // skip noise points
      if (!acc.has(label)) acc.set(label, { sum: new Array(nFeatures).fill(0), resources: [] });
      const c = acc.get(label)!;
      g.resources.forEach(() => g.profile.forEach((v, i) => { c.sum[i] += v; }));
      c.resources.push(...g.resources);
    });
    return new Map([...acc.entries()].map(([label, { sum, resources }]) => [
      label,
      { avgProfile: sum.map(v => v / resources.length), resources },
    ]));
  }, [groups, groupClusterLabel, data.values, data.activities.length]);

  // Compute an expanded convex hull (in SVG pixel space) for each cluster
  const clusterHulls = useMemo(() => {
    const k = data.n_clusters;
    if (!k) return [];
    const buckets: Pt[][] = Array.from({ length: k }, () => []);
    groups.forEach((g, i) => {
      const label = groupClusterLabel.get(g.key) ?? -1;
      const pos   = positions[i];
      if (label >= 0 && pos) buckets[label].push(pos);   // skip noise (label -1)
    });
    return buckets.map(pts => {
      if (pts.length === 0) return null;
      const pad = NODE_R + 16;
      if (pts.length === 1) return { type: "circle" as const, cx: pts[0].x, cy: pts[0].y, r: pad };
      if (pts.length === 2) {
        // Capsule: return expanded hull of the two points
        const hull = expandHull(convexHull([
          { x: pts[0].x - 1, y: pts[0].y },
          { x: pts[0].x + 1, y: pts[0].y },
          { x: pts[1].x - 1, y: pts[1].y },
          { x: pts[1].x + 1, y: pts[1].y },
        ]), pad);
        return { type: "polygon" as const, pts: hull };
      }
      return { type: "polygon" as const, pts: expandHull(convexHull(pts), pad) };
    });
  }, [groups, positions, groupClusterLabel, data.n_clusters]);

  // Whether co-occurrence / collaboration edge data is available
  const hasCoocEdges   = (data.cooccurring_resources?.length  ?? 0) > 0;
  const hasCollabEdges = (data.collaborating_resources?.length ?? 0) > 0;

  // Pairwise edges: average(fraction A→B, fraction B→A) for the active overlay mode.
  // Self-pairs are skipped. Only pairs whose average fraction ≥ MIN_WEIGHT are kept,
  // and results are capped at 300 to avoid rendering thousands of lines.
  const edges = useMemo(() => {
    if (!edgeMode) return [];
    const nAct  = data.activities.length;
    const nCooc = (data.cooccurring_resources ?? []).length;

    const isCooc      = edgeMode === "cooccurrence";
    const resourceList = isCooc
      ? (data.cooccurring_resources ?? [])
      : (data.collaborating_resources ?? []);
    const offset = isCooc ? nAct : nAct + nCooc;

    if (resourceList.length === 0) return [];

    // Column index within this feature block for each resource name
    const listIdx = new Map(resourceList.map((r, i) => [r, i]));
    const MIN_WEIGHT = 0.02;

    const result: { ai: number; bi: number; weight: number; wij: number; wji: number }[] = [];
    const n = data.resources.length;
    for (let i = 0; i < n; i++) {
      const ci = listIdx.get(data.resources[i]);
      if (ci === undefined) continue;
      for (let j = i + 1; j < n; j++) {
        const cj = listIdx.get(data.resources[j]);
        if (cj === undefined) continue;
        const wij = (data.values[i]?.[offset + cj]) ?? 0; // fraction i→j
        const wji = (data.values[j]?.[offset + ci]) ?? 0; // fraction j→i
        const avg = (wij + wji) / 2;
        if (avg >= MIN_WEIGHT) result.push({ ai: i, bi: j, weight: avg, wij, wji });
      }
    }

    result.sort((a, b) => b.weight - a.weight);
    return result.slice(0, 300);
  }, [edgeMode, data]);

  // Scale bar: pick the nicest round distance whose pixel length is closest to 80 px
  const scaleBar = useMemo(() => {
    const s = data.mds_scale;
    if (!s || s <= 0) return null;
    const niceSteps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0];
    const target = 80; // desired length in pixels (SVG user space at zoom 1)
    const best = niceSteps.reduce((b, v) =>
      Math.abs(v * s - target) < Math.abs(b * s - target) ? v : b, niceSteps[0]);
    const pixels = best * s;
    const label = best < 0.1 ? best.toFixed(2) : best < 1 ? best.toFixed(1) : best.toFixed(0);
    return { pixels, label };
  }, [data.mds_scale]);

  // Whether the current data contains any HDBSCAN noise points
  const hasOutliers = useMemo(
    () => data.cluster_labels?.includes(-1) ?? false,
    [data.cluster_labels],
  );

  // Legend: unique resource object types present in this data
  const legendTypes = useMemo(() => {
    const types = new Set(Object.values(data.resource_object_types));
    return [...types].sort();
  }, [data.resource_object_types]);

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="w-full border rounded-md bg-background relative flex justify-center">
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          style={{ cursor: "crosshair", userSelect: "none", display: "block" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={e => { if (dragStart.current) handleMouseUp(e); setEdgeTooltip(null); }}
          onClick={() => { setTooltip(t => t?.pinned ? null : t); setHighlightedActivity(null); }}
        >
          {/* Cluster hulls — rendered behind all nodes; hovering/clicking shows cluster tooltip */}
          {showClusters && showClusterOverlay && clusterHulls.map((hull, ci) => {
            if (!hull) return null;
            const color = clusterColors[ci % clusterColors.length];

            const onHullClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              const el = containerRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              setTooltip(prev => {
                // Second click on same cluster → dismiss
                if (prev?.pinned && prev.isCluster && prev.clusterLabel === ci) return null;
                const cluster = clusterData.get(ci);
                return {
                  x: e.clientX - rect.left, y: e.clientY - rect.top,
                  resources: cluster?.resources ?? [],
                  profile: cluster?.avgProfile ?? [],
                  clusterLabel: ci,
                  isCluster: true,
                  pinned: true,
                  cw: el.offsetWidth, ch: el.offsetHeight,
                };
              });
            };

            const sharedProps = {
              fill: `${color}18`, stroke: color,
              strokeWidth: 1 / effectiveScale,
              strokeDasharray: `${6 / effectiveScale} ${3 / effectiveScale}`,
              style: { cursor: "pointer" } as React.CSSProperties,
              onClick: onHullClick,
            };

            if (hull.type === "circle") {
              return <circle key={ci} cx={hull.cx} cy={hull.cy} r={hull.r} {...sharedProps} />;
            }
            return (
              <polygon key={ci} points={hull.pts.map(p => `${p.x},${p.y}`).join(" ")} {...sharedProps} />
            );
          })}

          {/* Edge overlay — drawn behind nodes, above cluster hulls.
              Hover detection is handled by the SVG's onMouseMove (distToSegment),
              so these lines are purely visual (pointerEvents: none). */}
          {edgeMode && edges.map((edge, ei) => {
            const pa = data.mds_positions[edge.ai];
            const pb = data.mds_positions[edge.bi];
            if (!pa || !pb) return null;
            const maxSW = 7 / effectiveScale;
            const sw    = Math.max(0.5 / effectiveScale, edge.weight * maxSW);
            const opacity = Math.max(0.2, Math.min(0.7, edge.weight * 1.5));
            return (
              <line
                key={ei}
                x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke="#94a3b8" strokeWidth={sw} strokeOpacity={opacity}
                style={{ pointerEvents: "none" }}
              />
            );
          })}

          {groups.map((group, i) => {
            const pos = positions[i];
            if (!pos) return null;
            const count = group.resources.length;
            const actIdx = highlightedActivity ? data.activities.indexOf(highlightedActivity) : -1;
            const dimmed = actIdx >= 0 && (group.profile[actIdx] ?? 0) === 0;
            return (
              <g
                key={group.key}
                transform={`translate(${pos.x},${pos.y})`}
                opacity={dimmed ? 0.15 : 1}
                style={{ cursor: "pointer" }}
                onMouseEnter={e => {
                  if (dragStart.current) return;   // suppress during rubber-band drag
                  setEdgeTooltip(null);
                  cancelHide();
                  const el = containerRef.current;
                  if (!el) return;
                  const rect = el.getBoundingClientRect();
                  setTooltip(prev => {
                    if (prev?.pinned) return prev;
                    const label = groupClusterLabel.get(group.key) ?? 0;
                    return {
                      x: e.clientX - rect.left, y: e.clientY - rect.top,
                      resources: group.resources,
                      profile: group.profile,
                      clusterLabel: label,
                      isCluster: false,
                      pinned: false,
                      cw: el.offsetWidth, ch: el.offsetHeight,
                    };
                  });
                }}
                onMouseMove={e => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTooltip(t => t && !t.pinned ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : t);
                }}
                onMouseLeave={() => scheduleHide()}
                onClick={e => {
                  e.stopPropagation();
                  setTooltip(t => t ? { ...t, pinned: !t.pinned } : null);
                }}
              >
                {/* Cluster ring — solid+coloured for cluster members, dashed+grey for outliers */}
                {showClusters && showClusterOverlay && (() => {
                  const label = groupClusterLabel.get(group.key) ?? -1;
                  const r = nodeR + 2.5 / effectiveScale;
                  const sw = 2 / effectiveScale;
                  if (label < 0) {
                    return (
                      <circle r={r} fill="none" stroke="#94a3b8" strokeWidth={sw}
                        strokeDasharray={`${4 / effectiveScale} ${3 / effectiveScale}`}
                        style={{ pointerEvents: "none" }} />
                    );
                  }
                  const color = clusterColors[label % clusterColors.length];
                  return <circle r={r} fill="none" stroke={color} strokeWidth={sw} style={{ pointerEvents: "none" }} />;
                })()}
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

          {/* Scale bar — anchored to bottom-left of the visible viewBox */}
          {scaleBar && (() => {
            const margin = 20 / effectiveScale;
            const bx = vb.x + margin;
            const by = vb.y + vb.h - margin;
            const len = scaleBar.pixels / effectiveScale;
            const tick = 5 / effectiveScale;
            const sw = 1 / effectiveScale;
            const fs = 9 / effectiveScale;
            return (
              <g style={{ pointerEvents: "none" }}>
                <line x1={bx} y1={by} x2={bx + len} y2={by} stroke="#94a3b8" strokeWidth={sw} />
                <line x1={bx} y1={by - tick} x2={bx} y2={by + tick} stroke="#94a3b8" strokeWidth={sw} />
                <line x1={bx + len} y1={by - tick} x2={bx + len} y2={by + tick} stroke="#94a3b8" strokeWidth={sw} />
                <text x={bx + len / 2} y={by - tick - 3 / effectiveScale}
                  textAnchor="middle" fontSize={fs} fill="#94a3b8"
                  style={{ fontFamily: "sans-serif", userSelect: "none" }}>
                  {scaleBar.label}
                </text>
              </g>
            );
          })()}

          {/* Rubber band — DOM-mutated directly, no React state */}
          <rect ref={rbRef} display="none" fill="rgba(99,102,241,0.08)"
            stroke="#6366f1" strokeWidth={1 / effectiveScale} strokeDasharray={`${4 / effectiveScale} ${2 / effectiveScale}`}
            style={{ pointerEvents: "none" }} />
        </svg>

        {/* Control pill — bottom-right of the graph canvas */}
        <div style={{
          position: "absolute", bottom: 12, right: 12,
          display: "flex", gap: 8, alignItems: "center",
          background: "#FFFFFF", border: "1px solid #E2E8F0",
          borderRadius: 9999, padding: "6px 10px",
          boxShadow: "0 10px 24px rgba(15,23,42,0.14)",
          flexWrap: "wrap", maxWidth: "calc(100% - 24px)",
        }}>
          {zoomed && (
            <Button type="button" variant="outline" size="icon" onClick={() => setZoomed(null)}
              className="rounded-full h-9 w-9" title="Reset zoom">
              <ScanIcon className="h-4 w-4" />
            </Button>
          )}
          {showClusters && (
            <Button
              type="button"
              variant={showClusterOverlay ? "secondary" : "outline"}
              size="icon"
              onClick={() => setShowClusterOverlay(v => !v)}
              className="rounded-full h-9 w-9"
              title={showClusterOverlay ? "Hide cluster overlay" : "Show cluster overlay"}
            >
              <CircleDashed className="h-4 w-4" />
            </Button>
          )}
          {/* Edge overlay toggle — only shown when co-occurrence or collaboration data is present */}
          {(hasCoocEdges || hasCollabEdges) && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Button
                type="button"
                variant={edgeMode !== null ? "secondary" : "outline"}
                size="icon"
                onClick={() => {
                  if (edgeMode !== null) {
                    setEdgeMode(null);
                  } else {
                    setEdgeMode(hasCoocEdges ? "cooccurrence" : "collaboration");
                  }
                }}
                className="rounded-full h-9 w-9"
                title={edgeMode !== null ? "Hide relationship edges" : "Show relationship edges"}
              >
                <Share2 className="h-4 w-4" />
              </Button>
              {edgeMode !== null && (
                <div style={{ display: "flex", gap: 3 }}>
                  {hasCoocEdges && (
                    <button
                      onClick={() => setEdgeMode("cooccurrence")}
                      style={{
                        padding: "2px 8px", fontSize: 10, borderRadius: 9999,
                        border: "1px solid #6366f1", cursor: "pointer", lineHeight: "16px",
                        background: edgeMode === "cooccurrence" ? "#6366f1" : "transparent",
                        color:      edgeMode === "cooccurrence" ? "white"   : "#6366f1",
                      }}
                    >
                      Co-occ
                    </button>
                  )}
                  {hasCollabEdges && (
                    <button
                      onClick={() => setEdgeMode("collaboration")}
                      style={{
                        padding: "2px 8px", fontSize: 10, borderRadius: 9999,
                        border: "1px solid #6366f1", cursor: "pointer", lineHeight: "16px",
                        background: edgeMode === "collaboration" ? "#6366f1" : "transparent",
                        color:      edgeMode === "collaboration" ? "white"   : "#6366f1",
                      }}
                    >
                      Collab
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {edgeTooltip && (() => {
          const isCooc = edgeMode === "cooccurrence";
          const label  = isCooc ? "Co-occurrence" : "Object collaboration";
          const n      = edgeTooltip.nearby.length;
          // Each edge: ~52px (2 resource rows + avg row); header: 26px
          const estW = 230, estH = 26 + n * 58;
          const left = Math.min(edgeTooltip.x + 14, edgeTooltip.cw - estW - 4);
          const top  = Math.max(4, Math.min(edgeTooltip.y - estH / 2, edgeTooltip.ch - estH - 4));
          return (
            <div style={{
              position: "absolute", left, top, pointerEvents: "none",
              background: "white", borderRadius: 8, zIndex: 10,
              border: "1px solid #e2e8f0",
              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
              padding: "8px 10px", minWidth: estW, maxWidth: estW,
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 6 }}>
                {label}{n > 1 ? ` — ${n} pairs` : ""}
              </div>
              {edgeTooltip.nearby.map((edge, idx) => {
                const rA = data.resources[edge.ai];
                const rB = data.resources[edge.bi];
                const colorA = resourceColorMap[rA] ?? "#94a3b8";
                const colorB = resourceColorMap[rB] ?? "#94a3b8";
                return (
                  <div key={idx} style={{
                    borderTop: idx > 0 ? "1px solid #f1f5f9" : "none",
                    paddingTop: idx > 0 ? 6 : 0,
                    marginTop: idx > 0 ? 4 : 0,
                  }}>
                    {([
                      { color: colorA, from: rA, to: rB, val: edge.wij },
                      { color: colorB, from: rB, to: rA, val: edge.wji },
                    ] as const).map(({ color, from, to, val }) => (
                      <div key={from} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3, fontSize: 11 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
                        <span style={{ fontFamily: "monospace", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={from}>
                          {from}
                        </span>
                        <span style={{ color: "#cbd5e1", fontSize: 11, flexShrink: 0, lineHeight: 1 }}>│</span>
                        <span style={{ fontFamily: "monospace", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: 55 }} title={to}>
                          {to}
                        </span>
                        <span style={{ marginLeft: 4, fontVariantNumeric: "tabular-nums", color: "#334155", flexShrink: 0, fontSize: 11 }}>
                          {(val * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {tooltip && (
          <TooltipBox
            tooltip={tooltip}
            activities={data.activities}
            cooccurringResources={data.cooccurring_resources ?? []}
            collaboratingResources={data.collaborating_resources ?? []}
            timeBins={data.time_bins ?? []}
            weekdayBins={data.weekday_bins ?? []}
            portfolioObjectTypes={data.portfolio_object_types ?? []}
            resourceObjectTypes={data.resource_object_types}
            typeTotals={data.type_totals ?? {}}
            coocTypeN={data.cooc_type_n ?? {}}
            collabTypeN={data.collab_type_n ?? {}}
            activityColorMap={activityColorMap}
            resourceColorMap={resourceColorMap}
            typeColorMap={typeColorMap}
            clusterColors={clusterColors}
            allProfiles={allProfiles}
            highlightedActivity={highlightedActivity}
            onActivityClick={act => setHighlightedActivity(prev => prev === act ? null : act)}
            onPin={() => setTooltip(t => t ? { ...t, pinned: true } : null)}
            onTooltipMouseEnter={cancelHide}
            onTooltipMouseLeave={scheduleHide}
            onClose={() => { setTooltip(null); setHighlightedActivity(null); }}
          />
        )}
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
        {showClusters && (data.n_clusters || hasOutliers) && (
          <div>
            <p className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide" style={{ fontSize: 10 }}>
              Clusters
            </p>
            <div className="space-y-1">
              {Array.from({ length: data.n_clusters ?? 0 }, (_, ci) => (
                <div key={ci} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: clusterColors[ci % clusterColors.length] }} />
                  <span>Cluster {ci + 1}</span>
                </div>
              ))}
              {hasOutliers && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0 border-2 border-dashed" style={{ borderColor: "#94a3b8" }} />
                  <span>Outlier</span>
                </div>
              )}
            </div>
          </div>
        )}
        <div>
          <p className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide" style={{ fontSize: 10 }}>
            MDS Stress
          </p>
          <Tooltip delayDuration={600}>
            <TooltipTrigger asChild>
              <span className="tabular-nums cursor-default">{data.mds_stress.toFixed(3)}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs">
              Normalised stress-1 — measures how much the 2D embedding distorts the original distances.
              0 = perfect preservation, 1 = complete distortion. Values below 0.1 are good, above 0.2 are poor.
              Computed on unique profiles only; resources sharing an identical profile are deduplicated before
              MDS so their trivial zero distance does not artificially lower the stress.
            </TooltipContent>
          </Tooltip>
        </div>
        <div>
          <p className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide" style={{ fontSize: 10 }}>
            Explained Variance
          </p>
          <Tooltip delayDuration={600}>
            <TooltipTrigger asChild>
              <span className="tabular-nums cursor-default">{(data.mds_explained_variance * 100).toFixed(1)}%</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs">
              Fraction of total variance captured by the 2D projection, computed from the eigenvalue spectrum
              of the distance matrix — independent of the MDS result. High values mean the 2D layout
              faithfully represents the data's structure; low values indicate the data has more intrinsic
              dimensions than 2 can show. Computed on unique profiles only; duplicate resources do not affect
              this value because identical profiles contribute zero eigenvalues.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
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
              id={`pm-${title}-${t}`}
              checked={selected.has(t)}
              onCheckedChange={() => onToggle(t)}
              style={{ backgroundColor: colorMap[t] ?? "#94a3b8", opacity: selected.has(t) ? 1 : 0.35 }}
            />
            <Label htmlFor={`pm-${title}-${t}`} className="text-sm cursor-pointer">
              {t}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}
