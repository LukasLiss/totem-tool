/**
 * OCPN flattened replay — token-based replay of every object type of a stored
 * object-centric Petri net on its own projection of the net (each object is a
 * case), shown on the combined net.
 *
 * Places with missing or remaining tokens get a red halo whose strength
 * follows their deviation; hovering a place shows its produced / consumed /
 * missing / remaining token counts. The fitness of each object type and the
 * average over the object types are shown above the net.
 *
 * Used by the Analysis view and the dashboard widget.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, Loader2, Play, RefreshCw } from "lucide-react";

import { listAssets, extractAssetApiError, type ProjectAsset } from "@/api/assetsApi";
import {
  extractReplayError,
  runOcpnFlattenedReplay,
  type OcpnFlattenedReplayResponse,
  type OcpnReplayObjectTypeResult,
} from "@/api/ocpnFlattenedReplayApi";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { VisualizerEmptyState } from "@/components/ui/VisualizerEmptyState";
import { parseOcpnModelFile } from "@/editors/shared/model-types";
import { modelToFlow } from "@/editors/ocpn/model";
import { layoutOcpn } from "@/editors/ocpn/layout";
import { toDisplay } from "@/editors/ocpn/display";
import { TransitionNode } from "@/editors/ocpn/nodes";
import { edgeTypes } from "@/editors/ocpn/ArcEdge";
import { isPlaceNode, type ArcFlowEdge, type OcpnFlowNode, type OcpnObjectType } from "@/editors/ocpn/types";
import { getEffectiveFilterConfig, useFilterVersion } from "@/store/filterStore";

import { ReplayPlaceNode } from "./ReplayPlaceNode";
import {
  DEVIATION_RGB,
  fitnessTone,
  formatFitness,
  placeStatsById,
  unmappedEventCount,
} from "./replayPresentation";

const nodeTypes = {
  place: ReplayPlaceNode,
  transition: TransitionNode,
};

export interface OcpnFlattenedReplayProps {
  fileId?: number | null;
  projectId?: number | null;
  /** Preselected OCPN asset (e.g. persisted by a dashboard widget). */
  initialAssetId?: number | null;
  /** Called when the user picks another OCPN asset. */
  onAssetChange?: (assetId: number | null) => void;
  /** Run the replay as soon as log and model are available. */
  autoStart?: boolean;
  filterEnabled?: boolean;
  localFilterParams?: Record<string, string>;
  height?: number | string;
  /** Opens the Model Assets view (shown when the project has no OCPN). */
  onOpenModelAssets?: () => void;
}

type ReplayState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "error"; message: string }
  | { status: "done"; result: OcpnFlattenedReplayResponse };

async function buildFlow(result: OcpnFlattenedReplayResponse) {
  const parsed = parseOcpnModelFile(result.model);
  if (parsed.ok === false) throw new Error(parsed.error);
  const flow = modelToFlow(parsed.model);
  // Keep a hand-made layout (every node positioned); otherwise lay out.
  const positioned =
    parsed.model.places.every((p) => p.position) &&
    parsed.model.transitions.every((t) => t.position);
  const nodes = positioned ? flow.nodes : await layoutOcpn(flow.nodes, flow.edges);
  const display = toDisplay({ ...flow, nodes });
  const stats = placeStatsById(result.places);
  const withStats = display.nodes.map((node) =>
    isPlaceNode(node)
      ? { ...node, data: { ...node.data, stats: stats.get(node.id) } }
      : node
  ) as OcpnFlowNode[];
  return { nodes: withStats, edges: display.edges, objectTypes: flow.objectTypes };
}

function ObjectTypeChip({
  result,
  color,
}: {
  result: OcpnReplayObjectTypeResult;
  color?: string;
}) {
  const unmapped = unmappedEventCount(result);
  const unmappedEntries = Object.entries(result.unmapped_activities);
  // Informational notes stay in the tooltip; the icon marks real issues.
  const hasWarning = unmapped > 0 || result.silent_search_limit_hits > 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
          data-testid={`replay-type-${result.object_type}`}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: color ?? "#64748B" }}
          />
          <span className="font-medium">{result.object_type}</span>
          <span className={`font-mono tabular-nums ${fitnessTone(result.fitness)}`}>
            {formatFitness(result.fitness)}
          </span>
          {hasWarning && <AlertTriangle className="h-3 w-3 text-amber-500" />}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-80">
        <div className="space-y-0.5">
          <div className="font-semibold">{result.object_type}</div>
          <div>
            {result.num_objects.toLocaleString()} objects ({result.num_variants.toLocaleString()} variants),{" "}
            {result.fitting_objects.toLocaleString()} fitting
          </div>
          <div className="font-mono tabular-nums">
            p {result.produced.toLocaleString()} · c {result.consumed.toLocaleString()} · m{" "}
            {result.missing.toLocaleString()} · r {result.remaining.toLocaleString()}
          </div>
          {unmapped > 0 && (
            <div>
              {unmapped.toLocaleString()} event(s) skipped, activity not in this type's net:{" "}
              {unmappedEntries
                .slice(0, 5)
                .map(([activity, n]) => `${activity} (${n})`)
                .join(", ")}
              {unmappedEntries.length > 5 ? ", …" : ""}
            </div>
          )}
          {result.warnings.map((warning) => (
            <div key={warning} className="opacity-90">
              ⚠ {warning}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

const OcpnFlattenedReplayInner: React.FC<OcpnFlattenedReplayProps> = ({
  fileId,
  projectId,
  initialAssetId = null,
  onAssetChange,
  autoStart = false,
  filterEnabled = true,
  localFilterParams,
  height = "100%",
  onOpenModelAssets,
}) => {
  const filterVersion = useFilterVersion();
  const effectiveFilterVersion = filterEnabled ? filterVersion : 0;

  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(initialAssetId);
  const [state, setState] = useState<ReplayState>({ status: "idle" });
  const [nodes, setNodes] = useState<OcpnFlowNode[]>([]);
  const [edges, setEdges] = useState<ArcFlowEdge[]>([]);
  const [objectTypes, setObjectTypes] = useState<OcpnObjectType[]>([]);

  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const filterEnabledRef = useRef(filterEnabled);
  filterEnabledRef.current = filterEnabled;
  const localFilterParamsRef = useRef(localFilterParams);
  localFilterParamsRef.current = localFilterParams;

  // Load the project's OCPN assets.
  useEffect(() => {
    setAssets([]);
    setAssetsError(null);
    if (!projectId) return;
    let cancelled = false;
    setAssetsLoading(true);
    listAssets({ projectId, assetType: "OCPN" })
      .then((response) => {
        if (cancelled) return;
        const list = (Array.isArray(response) ? response : [])
          .filter((asset) => asset.asset_type === "OCPN" && asset.project === projectId)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.name.localeCompare(b.name));
        setAssets(list);
      })
      .catch((error: unknown) => {
        if (!cancelled) setAssetsError(extractAssetApiError(error).message);
      })
      .finally(() => {
        if (!cancelled) setAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Follow a changed preselection (e.g. dashboard reload).
  useEffect(() => {
    setSelectedAssetId(initialAssetId ?? null);
  }, [initialAssetId]);

  const assetAvailable =
    selectedAssetId !== null && assets.some((asset) => asset.id === selectedAssetId);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestSeq.current += 1;
    setState({ status: "idle" });
    setNodes([]);
    setEdges([]);
    setObjectTypes([]);
  }, []);

  // A new log or model invalidates the result.
  useEffect(() => {
    reset();
  }, [fileId, selectedAssetId, reset]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async () => {
    if (!fileId || selectedAssetId === null) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeq.current;
    setState({ status: "running" });
    try {
      const filterConfig = getEffectiveFilterConfig(
        localFilterParamsRef.current,
        filterEnabledRef.current
      );
      if (filterConfig._noResults) {
        setState({ status: "error", message: "The active filters leave no events to replay." });
        return;
      }
      const result = await runOcpnFlattenedReplay(fileId, selectedAssetId, {
        params: filterConfig.params,
        skipGlobalFilter: filterConfig._skipGlobalFilter,
        signal: controller.signal,
      });
      const flow = await buildFlow(result);
      if (seq !== requestSeq.current) return;
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setObjectTypes(flow.objectTypes);
      setState({ status: "done", result });
      requestAnimationFrame(() => rfInstance.current?.fitView({ padding: 0.15 }));
    } catch (error) {
      if (seq !== requestSeq.current) return;
      if (axios.isCancel(error) || (error instanceof Error && error.name === "CanceledError")) {
        setState({ status: "idle" });
        return;
      }
      setState({ status: "error", message: extractReplayError(error) });
    }
  }, [fileId, selectedAssetId]);

  const cancel = useCallback(() => {
    reset();
  }, [reset]);

  // Auto start once log and model are known.
  const autoStartedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!autoStart || !fileId || !assetAvailable) return;
    const key = `${fileId}:${selectedAssetId}`;
    if (autoStartedFor.current === key) return;
    autoStartedFor.current = key;
    void run();
  }, [autoStart, fileId, assetAvailable, selectedAssetId, run]);

  // Re-run on filter changes when a result is shown (or auto start is on).
  const hasResult = state.status === "done";
  const hasResultRef = useRef(hasResult);
  hasResultRef.current = hasResult;
  const firstFilterRun = useRef(true);
  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      return;
    }
    if (!fileId || !assetAvailable) return;
    if (hasResultRef.current || autoStart) void run();
  }, [filterEnabled, effectiveFilterVersion, localFilterParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (value: string) => {
    const id = Number(value);
    setSelectedAssetId(id);
    onAssetChange?.(id);
  };

  const onNodesChange = useCallback(
    (changes: NodeChange<OcpnFlowNode>[]) =>
      setNodes((current) => applyNodeChanges(changes, current) as OcpnFlowNode[]),
    []
  );

  const typeColors = useMemo(
    () => Object.fromEntries(objectTypes.map((t) => [t.name, t.color])),
    [objectTypes]
  );

  const renderAssetSelect = () => {
    if (!projectId) return null;
    if (assetsLoading) {
      return <span className="text-xs text-muted-foreground">Loading OCPN models…</span>;
    }
    if (assetsError) {
      return <span className="text-xs text-destructive">{assetsError}</span>;
    }
    if (assets.length === 0) {
      return (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          No OCPN models in this project.
          {onOpenModelAssets && (
            <Button size="sm" variant="outline" onClick={onOpenModelAssets}>
              Model Assets
            </Button>
          )}
        </span>
      );
    }
    return (
      <Select
        value={assetAvailable ? String(selectedAssetId) : undefined}
        onValueChange={handleSelect}
        disabled={state.status === "running"}
      >
        <SelectTrigger className="h-8 w-56" aria-label="OCPN model">
          <SelectValue placeholder="Select a stored OCPN model" />
        </SelectTrigger>
        <SelectContent>
          {assets.map((asset) => (
            <SelectItem key={asset.id} value={String(asset.id)}>
              {asset.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  const renderBody = () => {
    if (!fileId) {
      return (
        <VisualizerEmptyState
          label="OCPN Flattened Replay"
          message="Select an event log to replay it on an OC Petri net."
          overlay={false}
        />
      );
    }
    if (state.status === "running") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p>Replaying every object type…</p>
          <Button size="sm" variant="outline" onClick={cancel}>
            Cancel
          </Button>
        </div>
      );
    }
    if (state.status === "error") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <p role="alert" className="max-w-xl text-sm text-destructive">
            {state.message}
          </p>
          <Button size="sm" variant="outline" onClick={run} disabled={!assetAvailable}>
            <RefreshCw className="mr-1 h-4 w-4" /> Try again
          </Button>
        </div>
      );
    }
    if (state.status === "idle") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
          <p className="max-w-md">
            Each object type of the selected OC Petri net is replayed separately
            (token-based replay, one case per object). Deviations are shown on the
            combined net.
          </p>
          <Button onClick={run} disabled={!assetAvailable}>
            <Play className="mr-1 h-4 w-4" /> Run replay
          </Button>
        </div>
      );
    }
    return (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onInit={(instance) => {
          rfInstance.current = instance;
        }}
        fitView
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        connectionMode={ConnectionMode.Loose}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#CBD5E1" />
        <Controls showInteractive={false} />
      </ReactFlow>
    );
  };

  const result = state.status === "done" ? state.result : null;

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
        {renderAssetSelect()}
        {state.status === "running" ? (
          <Button size="sm" variant="destructive" onClick={cancel}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={run} disabled={!fileId || !assetAvailable}>
            {result ? (
              <>
                <RefreshCw className="mr-1 h-4 w-4" /> Re-run
              </>
            ) : (
              <>
                <Play className="mr-1 h-4 w-4" /> Run
              </>
            )}
          </Button>
        )}
        {result && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-3 w-3 rounded-full border"
                style={{ boxShadow: `0 0 0 3px rgba(${DEVIATION_RGB}, 0.5)` }}
              />
              missing / remaining tokens
            </span>
            <span style={{ color: "#B91C1C" }}>−missing</span>
            <span style={{ color: "#B45309" }}>+remaining</span>
          </div>
        )}
      </div>
      {result && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" data-testid="replay-summary">
          <div className="mr-1 flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">Average fitness</span>
            <span
              className={`text-lg font-semibold tabular-nums ${fitnessTone(result.average_fitness)}`}
              data-testid="replay-average-fitness"
            >
              {formatFitness(result.average_fitness)}
            </span>
          </div>
          {result.object_types.map((typeResult) => (
            <ObjectTypeChip
              key={typeResult.object_type}
              result={typeResult}
              color={typeColors[typeResult.object_type]}
            />
          ))}
          {result.log_object_types_not_in_model.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Not in model (not replayed): {result.log_object_types_not_in_model.join(", ")}
            </span>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">{renderBody()}</div>
    </div>
  );
};

const OcpnFlattenedReplay: React.FC<OcpnFlattenedReplayProps> = (props) => (
  <ReactFlowProvider>
    <OcpnFlattenedReplayInner {...props} />
  </ReactFlowProvider>
);

export default OcpnFlattenedReplay;
