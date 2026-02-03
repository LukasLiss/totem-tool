import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { RefreshCcw } from 'lucide-react';
import { mapTypesToColors } from '../utils/objectColors';
import { TotemNode, type TotemNodeData } from './TotemNode';
import { TotemEdge, type TotemEdgeData } from './TotemEdge';

// API Response types matching backend _serialize_totem
type TotemCardinality = {
  from: string;
  to: string;
  log_cardinality: string | null;
  event_cardinality: string | null;
};

type TotemApiResponse = {
  tempgraph: {
    nodes: string[];
    D?: string[][];
    I?: string[][];
    P?: string[][];
  };
  cardinalities: TotemCardinality[];
  type_relations: string[][];
  all_event_types: string[];
  object_type_to_event_types: Record<string, string[]>;
};

// Internal types
type RelationType = 'D' | 'I' | 'P';

type NodeLayout = {
  row: number;
  column: number;
};

// Component props
type TotemProps = {
  fileId?: number | string | null;
  backendBaseUrl?: string;
  height?: string | number;
  embedded?: boolean;
  automaticLoading?: boolean;
  initialTau?: number;
};

// Layout constants
const NODE_WIDTH = 120;
const NODE_HEIGHT = 36;
const ROW_GAP = 120;
const COLUMN_GAP = 80;
const PADDING = 60;

// Custom node and edge types for React Flow
const nodeTypes = { totemNode: TotemNode };
const edgeTypes = { totemEdge: TotemEdge };

/**
 * Compute layout using topological sort based on D (during) relations.
 * INVERTED: Targets of D relations (containers) go on TOP (row 0).
 * Sources of D relations (contained objects) go BELOW their containers.
 */
function computeTotemLayout(
  nodes: string[],
  dRelations: string[][]
): Map<string, NodeLayout> {
  // Build outgoing D map: for D[source, target], source is "during" target
  // So source should be BELOW target (target is container)
  const outgoingD = new Map<string, Set<string>>();
  const incomingD = new Map<string, Set<string>>();

  nodes.forEach((node) => {
    outgoingD.set(node, new Set());
    incomingD.set(node, new Set());
  });

  // D relation: [source, target] means source's lifespan is during target's
  // So target is the container, should be at TOP
  // source is contained, should be BELOW
  dRelations.forEach(([source, target]) => {
    if (outgoingD.has(source) && incomingD.has(target)) {
      outgoingD.get(source)!.add(target);
      incomingD.get(target)!.add(source);
    }
  });

  // Find top-level nodes (no outgoing D = not contained in anything)
  const rowAssignment = new Map<string, number>();
  const queue: Array<{ node: string; row: number }> = [];

  nodes.forEach((node) => {
    if (outgoingD.get(node)?.size === 0) {
      // This node is not contained in any other (top level)
      queue.push({ node, row: 0 });
      rowAssignment.set(node, 0);
    }
  });

  // BFS: nodes with outgoing D go below their targets
  while (queue.length > 0) {
    const { node, row } = queue.shift()!;

    // Find nodes that are "during" this node (have D relation TO this node)
    incomingD.get(node)?.forEach((containedNode) => {
      const existingRow = rowAssignment.get(containedNode);
      const newRow = row + 1;

      if (existingRow === undefined || newRow > existingRow) {
        rowAssignment.set(containedNode, newRow);
        queue.push({ node: containedNode, row: newRow });
      }
    });
  }

  // Handle disconnected nodes (place at row 0)
  nodes.forEach((node) => {
    if (!rowAssignment.has(node)) {
      rowAssignment.set(node, 0);
    }
  });

  // Assign columns within each row
  const rowNodes = new Map<number, string[]>();
  rowAssignment.forEach((row, node) => {
    if (!rowNodes.has(row)) {
      rowNodes.set(row, []);
    }
    rowNodes.get(row)!.push(node);
  });

  const layout = new Map<string, NodeLayout>();
  rowNodes.forEach((nodesInRow, row) => {
    nodesInRow.sort((a, b) => a.localeCompare(b));
    nodesInRow.forEach((node, index) => {
      layout.set(node, { row, column: index });
    });
  });

  return layout;
}

/**
 * Build cardinality lookup maps for both directions
 */
function buildCardinalityMaps(cardinalities: TotemCardinality[]) {
  const logCardMap = new Map<string, string>();
  const eventCardMap = new Map<string, string>();

  cardinalities.forEach((card) => {
    const key = `${card.from}->${card.to}`;
    if (card.log_cardinality) {
      logCardMap.set(key, card.log_cardinality);
    }
    if (card.event_cardinality) {
      eventCardMap.set(key, card.event_cardinality);
    }
  });

  return { logCardMap, eventCardMap };
}

/**
 * Convert layout to React Flow nodes
 */
function createNodes(
  nodeIds: string[],
  layout: Map<string, NodeLayout>,
  colorMap: Record<string, string>
): Node<TotemNodeData>[] {
  // Find max columns per row for centering
  const rowMaxColumn = new Map<number, number>();
  layout.forEach(({ row, column }) => {
    const current = rowMaxColumn.get(row) ?? -1;
    if (column > current) {
      rowMaxColumn.set(row, column);
    }
  });

  return nodeIds.map((nodeId) => {
    const { row, column } = layout.get(nodeId) ?? { row: 0, column: 0 };
    const maxCol = rowMaxColumn.get(row) ?? 0;
    const rowWidth = (maxCol + 1) * (NODE_WIDTH + COLUMN_GAP) - COLUMN_GAP;
    const startX = PADDING + (500 - rowWidth) / 2;

    return {
      id: nodeId,
      type: 'totemNode',
      position: {
        x: Math.max(PADDING, startX + column * (NODE_WIDTH + COLUMN_GAP)),
        y: PADDING + row * (NODE_HEIGHT + ROW_GAP),
      },
      data: {
        label: nodeId,
        color: colorMap[nodeId] ?? '#2563EB',
      },
    };
  });
}

/**
 * Create edges with cardinalities from both directions
 */
function createEdges(
  data: TotemApiResponse,
  logCardMap: Map<string, string>,
  eventCardMap: Map<string, string>
): Edge<TotemEdgeData>[] {
  const edges: Edge<TotemEdgeData>[] = [];
  const processedPairs = new Set<string>();

  const addEdge = (from: string, to: string, relation: RelationType) => {
    // For each edge, we show cardinalities in both directions
    const forwardLogKey = `${from}->${to}`;
    const reverseLogKey = `${to}->${from}`;
    const forwardEventKey = `${from}->${to}`;
    const reverseEventKey = `${to}->${from}`;

    // Create unique pair key (sorted to avoid duplicates for P relations)
    const pairKey = relation === 'P'
      ? [from, to].sort().join('-')
      : `${from}-${to}`;

    if (processedPairs.has(pairKey) && relation === 'P') {
      return; // Skip duplicate P edges
    }
    processedPairs.add(pairKey);

    edges.push({
      id: `${relation}-${from}-${to}`,
      source: from,
      target: to,
      type: 'totemEdge',
      data: {
        relation,
        logCardForward: logCardMap.get(forwardLogKey),
        logCardReverse: logCardMap.get(reverseLogKey),
        eventCardForward: eventCardMap.get(forwardEventKey),
        eventCardReverse: eventCardMap.get(reverseEventKey),
        // Node dimensions for boundary calculation
        sourceWidth: NODE_WIDTH,
        sourceHeight: NODE_HEIGHT,
        targetWidth: NODE_WIDTH,
        targetHeight: NODE_HEIGHT,
      },
    });
  };

  // Process D relations
  data.tempgraph.D?.forEach(([from, to]) => addEdge(from, to, 'D'));
  // Process I relations
  data.tempgraph.I?.forEach(([from, to]) => addEdge(from, to, 'I'));
  // Process P relations
  data.tempgraph.P?.forEach(([from, to]) => addEdge(from, to, 'P'));

  return edges;
}

function TotemInner({
  fileId,
  backendBaseUrl = 'http://localhost:8000',
  height = 500,
  embedded = false,
  automaticLoading = true,
  initialTau = 0.9,
}: TotemProps) {
  const [totemData, setTotemData] = useState<TotemApiResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasStartedLoading, setHasStartedLoading] = useState(false);
  const [tau, setTau] = useState<number>(initialTau); // Triggers fetch when changed
  const [sliderValue, setSliderValue] = useState<number>(initialTau); // Visual display during drag

  const [nodes, setNodes, onNodesChange] = useNodesState<TotemNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TotemEdgeData>([]);

  // Stale closure prevention
  const fileIdRef = useRef<number | string | null | undefined>(fileId);
  const tauRef = useRef<number>(initialTau);
  useEffect(() => {
    fileIdRef.current = fileId;
  }, [fileId]);
  useEffect(() => {
    tauRef.current = tau;
  }, [tau]);

  // Reset when fileId changes
  useEffect(() => {
    setTotemData(null);
    setStatus('idle');
    setHasStartedLoading(false);
    setNodes([]);
    setEdges([]);
  }, [fileId, setNodes, setEdges]);

  // Fetch data
  const fetchTotem = useCallback(async () => {
    if (!fileId) return;
    if (!automaticLoading && !hasStartedLoading) return;

    const currentFileId = fileId;
    if (fileIdRef.current !== currentFileId) return;

    setStatus('loading');

    const token = localStorage.getItem('access_token');
    if (!token) {
      setStatus('error');
      setErrorMsg('Not authenticated');
      return;
    }

    try {
      const response = await fetch(
        `${backendBaseUrl}/api/files/${currentFileId}/discover_totem/?tau=${tauRef.current}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        }
      );

      if (fileIdRef.current !== currentFileId) return;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: TotemApiResponse = await response.json();

      if (fileIdRef.current !== currentFileId) return;

      if (!data.tempgraph?.nodes || data.tempgraph.nodes.length === 0) {
        setStatus('empty');
        return;
      }

      setTotemData(data);
      setStatus('ready');
    } catch (err) {
      if (fileIdRef.current !== currentFileId) return;
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load TOTeM data');
    }
  }, [fileId, backendBaseUrl, automaticLoading, hasStartedLoading, tau]);

  useEffect(() => {
    fetchTotem();
  }, [fetchTotem]);

  // Build nodes and edges when data changes
  useEffect(() => {
    if (!totemData) return;

    const dRelations = totemData.tempgraph.D ?? [];
    const layout = computeTotemLayout(totemData.tempgraph.nodes, dRelations);
    const colorMap = mapTypesToColors(totemData.tempgraph.nodes);
    const { logCardMap, eventCardMap } = buildCardinalityMaps(totemData.cardinalities);

    const newNodes = createNodes(totemData.tempgraph.nodes, layout, colorMap);
    const newEdges = createEdges(totemData, logCardMap, eventCardMap);

    setNodes(newNodes);
    setEdges(newEdges);
  }, [totemData, setNodes, setEdges]);

  const handleReload = useCallback(() => {
    setHasStartedLoading(true);
    setTotemData(null);
    setStatus('idle');
    setNodes([]);
    setEdges([]);
    setTimeout(() => {
      fetchTotem();
    }, 0);
  }, [fetchTotem, setNodes, setEdges]);

  const heightStyle = typeof height === 'number' ? `${height}px` : height;

  const renderContent = () => {
    if (status === 'idle' && !fileId) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          Select a file to view TOTeM model
        </div>
      );
    }

    if (status === 'idle' && fileId && !automaticLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <Button onClick={() => setHasStartedLoading(true)}>Load TOTeM Model</Button>
        </div>
      );
    }

    if (status === 'loading') {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          Loading TOTeM model...
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2">
          <span className="text-destructive">Error: {errorMsg}</span>
          <Button onClick={handleReload} variant="outline" size="sm">
            Retry
          </Button>
        </div>
      );
    }

    if (status === 'empty') {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          No object types found in log
        </div>
      );
    }

    return (
      <div style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={true}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          maxZoom={2}
        >
          <Background color="#e5e7eb" gap={20} />
          <Controls />
        </ReactFlow>
      </div>
    );
  };

  if (embedded) {
    return <div style={{ height: heightStyle }}>{renderContent()}</div>;
  }

  return (
    <Card className="@container/card w-full">
      <CardHeader className="items-center relative z-10 justify-between">
        <CardTitle>TOTeM Model</CardTitle>
        <CardAction className="flex items-center gap-4">
          {/* Tau slider */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              τ: {sliderValue.toFixed(2)}
            </span>
            <Slider
              value={[sliderValue]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={(v) => setSliderValue(v[0])}
              onValueCommit={(v) => setTau(v[0])}
              className="w-32"
              disabled={!fileId}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReload}
            disabled={!fileId}
            className="flex items-center gap-2"
          >
            <RefreshCcw className="h-4 w-4" />
            Reload
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0" style={{ height: heightStyle }}>
        {renderContent()}
      </CardContent>
    </Card>
  );
}

export default function Totem(props: TotemProps) {
  return (
    <ReactFlowProvider>
      <TotemInner {...props} />
    </ReactFlowProvider>
  );
}
