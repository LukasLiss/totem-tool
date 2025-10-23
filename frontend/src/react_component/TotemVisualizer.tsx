import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  EdgeLabelRenderer,
  Background,
  Controls,
  ControlButton,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { RefreshCw, Crosshair, LockIcon, UnlockIcon } from 'lucide-react';

import {
  layoutOCDFG,
  type DfgNode,
  type DfgLink,
} from '../utils/GraphLayouter';
import { mapTypesToColors } from '../utils/objectColors';
import TotemNode from './TotemNode';
import OcdfgEdge from './OcdfgEdge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type RelationKey = 'D' | 'I' | 'P' | string;

type TotemRelationMeta = {
  label: string;
  description: string;
  color: string;
};

const RELATION_STYLES: Record<RelationKey, TotemRelationMeta> = {
  D: {
    label: 'Dependent',
    description: 'Target overlaps with the lifecycle of the source type.',
    color: '#2563EB',
  },
  I: {
    label: 'Initiating',
    description: 'Source type typically precedes the target type.',
    color: '#10B981',
  },
  P: {
    label: 'Parallel',
    description: 'Source and target types evolve in parallel.',
    color: '#F59E0B',
  },
};

interface TotemApiResponse {
  tempgraph: {
    nodes?: string[];
    [relation: string]: string[] | string[][];
  };
  cardinalities?: Array<{
    from: string;
    to: string;
    log_cardinality?: string | null;
    event_cardinality?: string | null;
  }>;
  type_relations?: Array<string[]>;
  all_event_types?: string[];
  object_type_to_event_types?: Record<string, string[]>;
}

type CardinalityEntry = {
  log?: string | null;
  event?: string | null;
};

type BuildGraphOptions = {
  disabledRelations: Set<string>;
  relationColorMap: Record<string, string>;
  nodeColorMap: Record<string, string>;
};

type BuildGraphResult = {
  renderNodes: Node[];
  renderEdges: Edge[];
  dfgNodes: DfgNode[];
  dfgLinks: DfgLink[];
};

type TotemVisualizerProps = {
  eventLogId?: number | string | null;
  height?: string | number;
  backendBaseUrl?: string;
};

const DEFAULT_BACKEND = 'http://127.0.0.1:8000';
const EDGE_LABEL_BACKGROUND = 'rgba(255, 255, 255, 0.9)';

function edgeLabelPosition(polyline?: Array<{ x: number; y: number }>) {
  if (!polyline || polyline.length === 0) {
    return null;
  }
  if (polyline.length === 1) {
    return polyline[0];
  }

  const segments = [];
  let total = 0;
  for (let i = 1; i < polyline.length; i += 1) {
    const prev = polyline[i - 1];
    const curr = polyline[i];
    const length = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    segments.push({ start: prev, end: curr, length });
    total += length;
  }
  if (total === 0) {
    return polyline[Math.floor(polyline.length / 2)];
  }
  const midpoint = total / 2;
  let accumulated = 0;
  for (const segment of segments) {
    if (accumulated + segment.length >= midpoint) {
      const ratio = (midpoint - accumulated) / (segment.length || 1);
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
        y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
      };
    }
    accumulated += segment.length;
  }
  return polyline[polyline.length - 1];
}

function normaliseCardinality(value?: string | null) {
  if (!value || value === 'None' || value === 'ERROR 0') {
    return null;
  }
  return value;
}

function buildEdgeLabel(meta: TotemRelationMeta, cardinality?: CardinalityEntry) {
  const parts = [meta.label];
  const log = normaliseCardinality(cardinality?.log);
  const event = normaliseCardinality(cardinality?.event);
  if (log) parts.push(`LC ${log}`);
  if (event) parts.push(`EC ${event}`);
  return parts.join(' • ');
}

function buildGraph(
  data: TotemApiResponse,
  { disabledRelations, relationColorMap, nodeColorMap }: BuildGraphOptions,
): BuildGraphResult {
  const objectTypes = Array.from(new Set(data.tempgraph?.nodes ?? []));
  const renderNodes: Node[] = objectTypes.map((objectType) => ({
    id: objectType,
    type: 'totemNode',
    position: { x: 0, y: 0 },
    data: {
      label: objectType,
      events: data.object_type_to_event_types?.[objectType] ?? [],
      color: nodeColorMap[objectType],
    },
    style: {
      width: 232,
    },
  }));

  const dfgNodes: DfgNode[] = objectTypes.map((objectType) => ({
    id: objectType,
    label: objectType,
    types: [objectType],
  }));

  const cardinalityMap = new Map<string, CardinalityEntry>();
  data.cardinalities?.forEach((entry) => {
    const key = `${entry.from}-->${entry.to}`;
    cardinalityMap.set(key, {
      log: entry.log_cardinality ?? null,
      event: entry.event_cardinality ?? null,
    });
  });

  const renderEdges: Edge[] = [];
  const dfgLinks: DfgLink[] = [];

  Object.entries(data.tempgraph ?? {}).forEach(([relationKey, rawPairs]) => {
    if (relationKey === 'nodes') return;
    if (disabledRelations.has(relationKey)) return;
    if (!Array.isArray(rawPairs)) return;

    const meta = RELATION_STYLES[relationKey] ?? {
      label: relationKey,
      description: '',
      color: relationColorMap[relationKey] ?? '#64748B',
    };

    rawPairs.forEach((pair, index) => {
      if (!Array.isArray(pair) || pair.length < 2) return;
      const [source, target] = pair as [string, string];
      const id = `totem-${relationKey}-${source}-${target}-${index}`;
      const cardinality = cardinalityMap.get(`${source}-->${target}`);

      renderEdges.push({
        id,
        source,
        target,
        type: 'ocdfg',
        data: {
          owners: [relationKey],
          colors: relationColorMap,
          relationKey,
          relationLabel: meta.label,
          relationColor: meta.color,
          logCardinality: cardinality?.log,
          eventCardinality: cardinality?.event,
          displayLabel: buildEdgeLabel(meta, cardinality),
        },
      });

      dfgLinks.push({
        source,
        target,
        owners: [relationKey],
        weight: 1,
      });
    });
  });

  return { renderNodes, renderEdges, dfgNodes, dfgLinks };
}

function resolveHeight(height: string | number) {
  return typeof height === 'number' ? `${height}px` : height;
}

function buildRelationColorMap(): Record<string, string> {
  return Object.entries(RELATION_STYLES).reduce<Record<string, string>>((acc, [key, meta]) => {
    acc[key] = meta.color;
    return acc;
  }, {});
}

function TotemVisualizer({
  eventLogId,
  height = '100%',
  backendBaseUrl = DEFAULT_BACKEND,
}: TotemVisualizerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawTotem, setRawTotem] = useState<TotemApiResponse | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>('LR');
  const [interactionLocked, setInteractionLocked] = useState(false);
  const [visibleRelations, setVisibleRelations] = useState<Record<string, boolean>>(() => {
    const base = buildRelationColorMap();
    return Object.keys(base).reduce<Record<string, boolean>>((acc, relationKey) => {
      acc[relationKey] = true;
      return acc;
    }, {});
  });

  const edgeTypes = useMemo(() => ({ ocdfg: OcdfgEdge }), []);
  const nodeTypes = useMemo(() => ({ totemNode: TotemNode }), []);
  const relationColorMap = useMemo(() => buildRelationColorMap(), []);
  const reactFlow = useReactFlow();

  const fetchTotem = useCallback(async () => {
    if (!eventLogId) {
      setRawTotem(null);
      setNodes([]);
      setEdges([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(
        `${backendBaseUrl}/api/eventlogs/${eventLogId}/discover_totem/`,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Backend responded with ${response.status}`);
      }
      const payload: TotemApiResponse = await response.json();
      setRawTotem(payload);
    } catch (err) {
      console.error('[TotemVisualizer] Failed to load Totem data', err);
      setError(err instanceof Error ? err.message : 'Failed to load Totem data');
      setRawTotem(null);
    } finally {
      setLoading(false);
    }
  }, [backendBaseUrl, eventLogId]);

  useEffect(() => {
    fetchTotem();
  }, [fetchTotem]);

  const rebuildLayout = useCallback(async () => {
    if (!rawTotem) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const disabledRelations = new Set(
      Object.entries(visibleRelations)
        .filter(([, enabled]) => !enabled)
        .map(([relationKey]) => relationKey),
    );

    const nodeColorMap = mapTypesToColors(rawTotem.tempgraph?.nodes ?? []);
    const { renderNodes, renderEdges, dfgNodes, dfgLinks } = buildGraph(rawTotem, {
      disabledRelations,
      relationColorMap,
      nodeColorMap,
    });

    try {
      const { nodes: layoutedNodes, edges: layoutedEdges } = await layoutOCDFG({
        renderNodes,
        renderEdges,
        dfgNodes,
        dfgLinks,
        config: { direction: layoutDirection },
      });
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);

      window.requestAnimationFrame(() => {
        if (layoutedNodes.length > 0) {
          reactFlow.fitView({ padding: 0.18, includeHiddenNodes: false });
        }
      });
    } catch (err) {
      console.error('[TotemVisualizer] Layout failed, falling back to raw coordinates.', err);
      setNodes(renderNodes);
      setEdges(renderEdges);
    }
  }, [rawTotem, visibleRelations, relationColorMap, layoutDirection, reactFlow]);

  useEffect(() => {
    rebuildLayout();
  }, [rebuildLayout]);

  const onNodesChange = useCallback<OnNodesChange>(
    (changes) => setNodes((curr) => applyNodeChanges(changes, curr)),
    [],
  );
  const onEdgesChange = useCallback<OnEdgesChange>(
    (changes) => setEdges((curr) => applyEdgeChanges(changes, curr)),
    [],
  );

  const toggleRelation = useCallback((relationKey: string, enabled: boolean) => {
    setVisibleRelations((prev) => ({
      ...prev,
      [relationKey]: enabled,
    }));
  }, []);

  const handleFitView = useCallback(() => {
    reactFlow.fitView({ padding: 0.2, includeHiddenNodes: false });
  }, [reactFlow]);

  const handleReload = useCallback(() => {
    fetchTotem();
  }, [fetchTotem]);

  const computedHeight = resolveHeight(height);

  return (
    <div className="h-full w-full flex flex-col" style={{ height: computedHeight }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Temporal Relations
          </span>
          {(Object.keys(relationColorMap) as RelationKey[]).map((relationKey) => {
            const meta = RELATION_STYLES[relationKey] ?? {
              label: relationKey,
              description: '',
              color: relationColorMap[relationKey] ?? '#64748B',
            };
            const enabled = visibleRelations[relationKey] ?? false;
            return (
              <label
                key={relationKey}
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm"
                title={meta.description}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: meta.color }}
                />
                <span className="text-sm font-medium text-slate-700">{meta.label}</span>
                <Switch
                  checked={enabled}
                  onCheckedChange={(value) => toggleRelation(relationKey, value)}
                  className="data-[state=checked]:bg-slate-900"
                />
              </label>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
            <span className="text-sm font-medium text-slate-700">Lock Layout</span>
            <Switch
              checked={interactionLocked}
              onCheckedChange={setInteractionLocked}
              className="data-[state=checked]:bg-slate-900"
            />
          </label>
          <Button variant="outline" size="sm" onClick={() => setLayoutDirection((prev) => (prev === 'TB' ? 'LR' : 'TB'))}>
            {layoutDirection === 'TB' ? 'Top-Down' : 'Left-Right'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleFitView}>
            <Crosshair className="mr-2 h-4 w-4" />
            Fit View
          </Button>
          <Button variant="outline" size="sm" onClick={handleReload}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reload
          </Button>
        </div>
      </div>

      <div className="relative flex-1">
        {!eventLogId && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-md">
              <Badge variant="outline">Totem Visualizer</Badge>
              <p className="text-sm text-slate-600">Select an event log to discover its Totem model.</p>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
          panOnDrag={!interactionLocked}
          panOnScroll={!interactionLocked}
          zoomOnDoubleClick={!interactionLocked}
          zoomOnScroll={!interactionLocked}
          nodesDraggable={!interactionLocked}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          className="bg-slate-50"
        >
          <Background gap={32} size={2} color="rgba(148, 163, 184, 0.3)" />
          <Controls className="shadow-md shadow-slate-400/20">
            <ControlButton onClick={handleFitView} title="Fit View">
              <Crosshair className="h-4 w-4" />
            </ControlButton>
            <ControlButton onClick={() => setInteractionLocked((prev) => !prev)} title="Toggle interactions">
              {interactionLocked ? <LockIcon className="h-4 w-4" /> : <UnlockIcon className="h-4 w-4" />}
            </ControlButton>
          </Controls>

          <EdgeLabelRenderer>
            {edges.map((edge) => {
              const label = edge.data?.displayLabel;
              if (!label) return null;
              const position = edgeLabelPosition(edge.data?.polyline);
              if (!position) return null;
              const relationColor = edge.data?.relationColor ?? '#64748B';
              return (
                <div
                  key={`edge-label-${edge.id}`}
                  style={{
                    position: 'absolute',
                    transform: 'translate(-50%, -50%)',
                    left: position.x,
                    top: position.y,
                    pointerEvents: 'none',
                  }}
                >
                  <div
                    style={{
                      background: EDGE_LABEL_BACKGROUND,
                      border: `1px solid ${relationColor}`,
                      borderRadius: 10,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#0F172A',
                      boxShadow: '0 6px 16px rgba(15, 23, 42, 0.18)',
                    }}
                  >
                    {label}
                  </div>
                </div>
              );
            })}
          </EdgeLabelRenderer>
        </ReactFlow>

        {loading && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-white/60 backdrop-blur-sm">
            <div className="rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 shadow-lg">
              Discovering Totem model…
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-x-0 top-6 z-30 flex justify-center">
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 shadow">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={handleReload}>
                Retry
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TotemVisualizer;
