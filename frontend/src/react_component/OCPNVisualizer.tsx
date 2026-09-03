/**
 * OCPNVisualizer — discovers an Object-Centric Petri Net for the selected
 * event log via the backend (`/api/files/<id>/discover_ocpn/`) and renders
 * it read-only with the same place/transition/arc components the OCPN
 * editor uses. Supports a configurable discovery timeout, re-runs, and
 * downloading the discovered net as a model JSON file.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useFilterVersion } from '@/store/filterStore';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Download, Loader2, Play, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SaveModelAssetButton from '@/components/SaveModelAssetDialog';
import {
  parseOcpnModelFile,
  type OcpnModelFile,
} from '@/editors/shared/model-types';
import { downloadJson, toFilename } from '@/editors/shared/io';
import { modelToFlow, placeTypeMap, type FlowState } from '@/editors/ocpn/model';
import { layoutOcpn } from '@/editors/ocpn/layout';
import { nodeTypes } from '@/editors/ocpn/nodes';
import { edgeTypes } from '@/editors/ocpn/ArcEdge';
import {
  FALLBACK_TYPE_COLOR,
  isPlaceNode,
  type ArcFlowEdge,
  type OcpnFlowNode,
  type OcpnObjectType,
} from '@/editors/ocpn/types';

export const DEFAULT_OCPN_TIMEOUT_S = 30;

export interface OCPNVisualizerProps {
  height?: number | string;
  fileId?: number | string;
  /** Start discovery automatically once a file is available. */
  autoStart?: boolean;
  /** Initial timeout budget in seconds. */
  defaultTimeoutS?: number;
  /** Show the toolbar (timeout input, discover/download buttons, legend). */
  showControls?: boolean;
  /** Called when the user edits the timeout (e.g. to persist it). */
  onTimeoutSChange?: (timeoutS: number) => void;
  filterEnabled?: boolean;
}

/**
 * Derive presentation data the editor computes on the fly: place colors,
 * transition type-dots, and colored arrow markers per arc.
 */
function toDisplay(state: FlowState): {
  nodes: OcpnFlowNode[];
  edges: ArcFlowEdge[];
} {
  const typeColors: Record<string, string> = {};
  for (const type of state.objectTypes) typeColors[type.name] = type.color;
  const placeTypes = placeTypeMap(state.nodes);

  const touched = new Map<string, Set<string>>();
  for (const edge of state.edges) {
    const transition = placeTypes.has(edge.source) ? edge.target : edge.source;
    const type = placeTypes.get(placeTypes.has(edge.source) ? edge.source : edge.target);
    if (!type) continue;
    if (!touched.has(transition)) touched.set(transition, new Set());
    touched.get(transition)!.add(type);
  }

  const nodes = state.nodes.map((node) => {
    if (isPlaceNode(node)) {
      return {
        ...node,
        data: {
          ...node.data,
          color: typeColors[node.data.objectType] ?? FALLBACK_TYPE_COLOR,
        },
      };
    }
    const types = touched.get(node.id);
    return {
      ...node,
      data: {
        ...node.data,
        typeDotColors: state.objectTypes
          .filter((t) => types?.has(t.name))
          .map((t) => t.color),
      },
    };
  }) as OcpnFlowNode[];

  const edges = state.edges.map((edge) => {
    const type =
      placeTypes.get(placeTypes.has(edge.source) ? edge.source : edge.target) ?? '';
    const color = typeColors[type] ?? FALLBACK_TYPE_COLOR;
    const variable = edge.data?.variable === true;
    return {
      ...edge,
      data: { ...edge.data!, color, objectType: type },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        markerUnits: 'userSpaceOnUse',
        width: variable ? 22 : 18,
        height: variable ? 22 : 18,
      },
    };
  }) as ArcFlowEdge[];

  return { nodes, edges };
}

const OCPNVisualizer: React.FC<OCPNVisualizerProps> = ({
  height = '100%',
  fileId,
  autoStart = false,
  defaultTimeoutS = DEFAULT_OCPN_TIMEOUT_S,
  showControls = true,
  onTimeoutSChange,
  filterEnabled = false,
}) => {
  const filterVersion = useFilterVersion();
  const effectiveFilterVersion = filterEnabled ? filterVersion : 0;
  const [model, setModel] = useState<OcpnModelFile | null>(null);
  const [objectTypes, setObjectTypes] = useState<OcpnObjectType[]>([]);
  const [nodes, setNodes] = useState<OcpnFlowNode[]>([]);
  const [edges, setEdges] = useState<ArcFlowEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeoutS, setTimeoutS] = useState<number>(defaultTimeoutS);

  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const requestSeq = useRef(0);
  const autoStartedFor = useRef<number | string | null>(null);

  // Keep the timeout in sync when the persisted setting changes.
  useEffect(() => {
    setTimeoutS(defaultTimeoutS);
  }, [defaultTimeoutS]);

  // Reset when the selected log changes.
  useEffect(() => {
    requestSeq.current += 1;
    setModel(null);
    setObjectTypes([]);
    setNodes([]);
    setEdges([]);
    setError(null);
    setLoading(false);
  }, [fileId]);

  const timeoutRef = useRef(timeoutS);
  timeoutRef.current = timeoutS;

  const filterEnabledRef = useRef(filterEnabled);
  filterEnabledRef.current = filterEnabled;

  const discover = useCallback(async () => {
    if (!fileId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`/api/files/${fileId}/discover_ocpn/`, {
        params: { timeout_s: timeoutRef.current },
        _skipGlobalFilter: !filterEnabledRef.current,
      } as any);
      const parsed = parseOcpnModelFile(data?.ocpn);
      if (parsed.ok === false) throw new Error(parsed.error);
      const flow = modelToFlow(parsed.model);
      const laidOutNodes = await layoutOcpn(flow.nodes, flow.edges);
      if (seq !== requestSeq.current) return;
      const display = toDisplay({ ...flow, nodes: laidOutNodes });
      setModel(parsed.model);
      setObjectTypes(flow.objectTypes);
      setNodes(display.nodes);
      setEdges(display.edges);
      requestAnimationFrame(() =>
        rfInstance.current?.fitView({ padding: 0.15 }),
      );
    } catch (err: any) {
      if (seq !== requestSeq.current) return;
      if (axios.isAxiosError(err) && err.response?.status === 408) {
        const info = err.response.data as { timeout_s?: number } | undefined;
        setError(
          `Discovery timed out after ${info?.timeout_s ?? timeoutRef.current} s. ` +
            'Increase the timeout and try again.',
        );
      } else if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(String(err.response.data.error));
      } else {
        setError(err?.message ?? 'OCPN discovery failed.');
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [fileId]);

  // Re-discover when filter is toggled or version changes.
  useEffect(() => {
    if (!fileId || !autoStart) return;
    discover();
  }, [filterEnabled, effectiveFilterVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start discovery (once per file).
  useEffect(() => {
    if (!autoStart || !fileId) return;
    if (autoStartedFor.current === fileId) return;
    autoStartedFor.current = fileId;
    discover();
  }, [autoStart, fileId, discover]);

  const handleTimeoutChange = (raw: string) => {
    const value = Number(raw);
    const safe = Number.isFinite(value) && value > 0 ? value : DEFAULT_OCPN_TIMEOUT_S;
    setTimeoutS(safe);
    onTimeoutSChange?.(safe);
  };

  const handleDownload = () => {
    if (!model) return;
    downloadJson(toFilename(model.name, 'discovered-ocpn'), model);
  };

  const onNodesChange = useCallback(
    (changes: NodeChange<OcpnFlowNode>[]) =>
      setNodes((current) => applyNodeChanges(changes, current) as OcpnFlowNode[]),
    [],
  );

  const renderBody = () => {
    if (!fileId) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Select an event log to discover an Object-Centric Petri Net.
        </div>
      );
    }
    if (loading) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          Discovering Object-Centric Petri Net…
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button size="sm" variant="outline" onClick={discover}>
            <RefreshCw className="mr-1 h-4 w-4" /> Try again
          </Button>
        </div>
      );
    }
    if (!model) {
      return (
        <div className="flex h-full items-center justify-center">
          <Button onClick={discover}>
            <Play className="mr-1 h-4 w-4" /> Discover OC Petri Net
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
        // The OCPN node components only define source handles (the editor
        // relies on loose connection mode); without it React Flow drops
        // every edge for lack of a target handle.
        connectionMode={ConnectionMode.Loose}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#CBD5E1" />
        <Controls showInteractive={false} />
      </ReactFlow>
    );
  };

  return (
    <ReactFlowProvider>
      <div
        className="flex h-full w-full flex-col"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      >
        {showControls && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="ocpn-timeout" className="text-xs text-muted-foreground">
                Timeout (s)
              </Label>
              <Input
                id="ocpn-timeout"
                type="number"
                min={1}
                max={600}
                step={1}
                value={timeoutS}
                onChange={(event) => handleTimeoutChange(event.target.value)}
                className="h-8 w-20"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={discover}
              disabled={!fileId || loading}
            >
              {model ? (
                <>
                  <RefreshCw className="mr-1 h-4 w-4" /> Re-discover
                </>
              ) : (
                <>
                  <Play className="mr-1 h-4 w-4" /> Discover
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownload}
              disabled={!model}
              title="Download the discovered OCPN as JSON"
            >
              <Download className="mr-1 h-4 w-4" /> JSON
            </Button>
            <SaveModelAssetButton
              fileId={fileId}
              filterEnabled={filterEnabled}
              modelType="OCPN"
              params={{ timeout_s: timeoutS }}
              disabled={!model}
            />
            {objectTypes.length > 0 && (
              <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
                {objectTypes.map((type) => (
                  <span
                    key={type.name}
                    className="flex items-center gap-1 text-xs text-muted-foreground"
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: type.color }}
                    />
                    {type.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="relative min-h-0 flex-1">{renderBody()}</div>
      </div>
    </ReactFlowProvider>
  );
};

export default OCPNVisualizer;
