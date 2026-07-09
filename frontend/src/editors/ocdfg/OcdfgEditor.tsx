import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CirclePlay, CircleStop, RectangleHorizontal } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import EditorShell from '@/editors/shared/EditorShell';
import { nextFreeColor } from '@/editors/shared/colors';
import { downloadJson, openJsonFile, toFilename } from '@/editors/shared/io';
import {
  parseOcdfgModelFile,
  type OcdfgModelFile,
  type XY,
} from '@/editors/shared/model-types';
import { loadEditorSession, saveEditorSession } from '@/editors/shared/sessionCache';
import { useUndoRedo } from '@/editors/shared/useUndoRedo';

import { ArcConnectionLine, edgeTypes } from './ArcEdge';
import {
  arcPathPoints,
  effectiveWaypoints,
  flowNodeBox,
  nearestSegmentIndex,
} from './geometry';
import { layoutOcdfg } from './layout';
import {
  controlNodeId,
  emptyModel,
  exampleModel,
  flowToModel,
  hasArc,
  modelToFlow,
  nextFreeId,
} from './model';
import { nodeTypes } from './nodes';
import { OcdfgSidePanel, type OcdfgSelection } from './SidePanel';
import {
  ActiveTypeColorContext,
  FALLBACK_TYPE_COLOR,
  isControlNode,
  OcdfgEdgeApiContext,
  type ActivityFlowNode,
  type ArcFlowEdge,
  type ControlFlowNode,
  type OcdfgEdgeApi,
  type OcdfgFlowNode,
  type OcdfgObjectType,
} from './types';

const DEFAULT_NAME = 'Object-centric DFG';

type Selected = { kind: 'node' | 'edge'; id: string } | null;

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClick}>
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function OcdfgEditorInner() {
  const [modelName, setModelName] = useState(DEFAULT_NAME);
  const [objectTypes, setObjectTypes] = useState<OcdfgObjectType[]>([]);
  const [nodes, setNodes] = useState<OcdfgFlowNode[]>([]);
  const [edges, setEdges] = useState<ArcFlowEdge[]>([]);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);

  const history = useUndoRedo<OcdfgModelFile>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragSnapshotRef = useRef<OcdfgModelFile | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const serialize = useCallback(
    () => flowToModel(modelName, objectTypes, nodes, edges),
    [modelName, objectTypes, nodes, edges],
  );
  const serializeRef = useRef(serialize);
  serializeRef.current = serialize;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // `history` gets a fresh identity every render; its methods are stable.
  // Depending on the method keeps `record` (and everything memoized on it,
  // like the edge API context value) stable across renders.
  const pushHistory = history.record;
  const record = useCallback(
    () => pushHistory(serializeRef.current()),
    [pushHistory],
  );

  const applyModel = useCallback(
    (model: OcdfgModelFile, options: { fit?: boolean } = {}) => {
      const flow = modelToFlow(model);
      setModelName(model.name);
      setObjectTypes(flow.objectTypes);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setSelected(null);
      setActiveType((previous) =>
        previous && flow.objectTypes.some((t) => t.name === previous)
          ? previous
          : flow.objectTypes[0]?.name ?? null,
      );
      if (options.fit) {
        window.setTimeout(() => fitView({ padding: 0.2 }), 0);
      }
    },
    [fitView],
  );

  const applyModelRef = useRef(applyModel);
  applyModelRef.current = applyModel;

  // -------------------------------------------------------------------------
  // Session cache — the editor unmounts when the user switches to another
  // sidebar view; persist the model on unmount and restore it on mount so a
  // view switch never loses work. Mount/unmount only (refs hold live state);
  // restoring the cached model twice (StrictMode) is harmless.
  // -------------------------------------------------------------------------

  useEffect(() => {
    const cached = loadEditorSession<OcdfgModelFile>('ocdfg');
    if (
      cached &&
      (cached.activities.length > 0 ||
        cached.starts.length > 0 ||
        cached.ends.length > 0 ||
        cached.objectTypes.length > 0)
    ) {
      applyModelRef.current(cached, { fit: true });
    }
    return () => {
      saveEditorSession('ocdfg', serializeRef.current());
    };
  }, []);

  // -------------------------------------------------------------------------
  // Undo / redo (+ keyboard shortcuts)
  // -------------------------------------------------------------------------

  const handleUndo = useCallback(() => {
    const snapshot = history.undo(serializeRef.current());
    if (snapshot) applyModel(snapshot);
  }, [history, applyModel]);

  const handleRedo = useCallback(() => {
    const snapshot = history.redo(serializeRef.current());
    if (snapshot) applyModel(snapshot);
  }, [history, applyModel]);

  const undoRef = useRef(handleUndo);
  const redoRef = useRef(handleRedo);
  undoRef.current = handleUndo;
  redoRef.current = handleRedo;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoRef.current();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // -------------------------------------------------------------------------
  // Derived (display) nodes & edges — colors and type dots stay fresh
  // -------------------------------------------------------------------------

  const typeColors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const type of objectTypes) map[type.name] = type.color;
    return map;
  }, [objectTypes]);

  const displayNodes = useMemo<OcdfgFlowNode[]>(() => {
    // Object types touched by each activity (via its incident arcs).
    const touched = new Map<string, Set<string>>();
    for (const edge of edges) {
      const type = edge.data?.objectType;
      if (!type) continue;
      for (const nodeId of [edge.source, edge.target]) {
        if (!touched.has(nodeId)) touched.set(nodeId, new Set());
        touched.get(nodeId)!.add(type);
      }
    }
    return nodes.map((node) => {
      if (isControlNode(node)) {
        const control: ControlFlowNode = {
          ...node,
          data: {
            ...node.data,
            color: typeColors[node.data.objectType] ?? FALLBACK_TYPE_COLOR,
          },
        };
        return control;
      }
      const types = touched.get(node.id);
      const activity: ActivityFlowNode = {
        ...node,
        data: {
          ...node.data,
          typeDotColors: objectTypes
            .filter((t) => types?.has(t.name))
            .map((t) => t.color),
        },
      };
      return activity;
    });
  }, [nodes, edges, typeColors, objectTypes]);

  const displayEdges = useMemo<ArcFlowEdge[]>(() => {
    // Route parallel arcs (same unordered node pair) and stacked self-loops
    // apart. The offsets only apply to arcs without user bend points, but are
    // assigned per group so the spacing stays stable while editing.
    const pairGroups = new Map<string, ArcFlowEdge[]>();
    const loopGroups = new Map<string, ArcFlowEdge[]>();
    for (const edge of edges) {
      const key =
        edge.source === edge.target
          ? edge.source
          : [edge.source, edge.target].sort().join('\u0000');
      const groups = edge.source === edge.target ? loopGroups : pairGroups;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(edge);
    }
    const parallelOffsets = new Map<string, number>();
    for (const group of pairGroups.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => (a.id < b.id ? -1 : 1));
      const canonical = sorted[0].source;
      sorted.forEach((edge, index) => {
        const offset = (index - (sorted.length - 1) / 2) * 26;
        // The perpendicular flips with the arc direction — align the group.
        parallelOffsets.set(edge.id, edge.source === canonical ? offset : -offset);
      });
    }
    const loopIndexes = new Map<string, number>();
    for (const group of loopGroups.values()) {
      [...group]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .forEach((edge, index) => loopIndexes.set(edge.id, index));
    }

    return edges.map((edge) => {
      const type = edge.data?.objectType ?? '';
      const color = typeColors[type] ?? FALLBACK_TYPE_COLOR;
      return {
        ...edge,
        type: 'arc',
        data: {
          objectType: type,
          color,
          waypoints: edge.data?.waypoints,
          parallelOffset: parallelOffsets.get(edge.id) ?? 0,
          loopIndex: loopIndexes.get(edge.id) ?? 0,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          markerUnits: 'userSpaceOnUse',
          width: 18,
          height: 18,
        },
      };
    });
  }, [edges, typeColors]);

  const arcCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const edge of edges) {
      const type = edge.data?.objectType;
      if (type) counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
  }, [edges]);

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  const onSelectionChange = useCallback(
    ({
      nodes: selectedNodes,
      edges: selectedEdges,
    }: {
      nodes: OcdfgFlowNode[];
      edges: ArcFlowEdge[];
    }) => {
      if (selectedNodes.length > 0) {
        setSelected({ kind: 'node', id: selectedNodes[0].id });
      } else if (selectedEdges.length > 0) {
        setSelected({ kind: 'edge', id: selectedEdges[0].id });
      } else {
        setSelected(null);
      }
    },
    [],
  );

  const nodeLabel = useCallback(
    (id: string): string => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return id;
      if (isControlNode(node)) {
        return `${node.data.kind === 'start' ? 'START' : 'END'} (${node.data.objectType})`;
      }
      return node.data.label || node.id;
    },
    [nodes],
  );

  const selection = useMemo<OcdfgSelection | null>(() => {
    if (!selected) return null;
    if (selected.kind === 'node') {
      const node = displayNodes.find((n) => n.id === selected.id);
      if (!node) return null;
      return isControlNode(node)
        ? { kind: 'control', node }
        : { kind: 'activity', node };
    }
    const edge = displayEdges.find((e) => e.id === selected.id);
    if (!edge) return null;
    const endpointIsControl = [edge.source, edge.target].some((id) => {
      const node = nodes.find((n) => n.id === id);
      return node ? isControlNode(node) : false;
    });
    return {
      kind: 'arc',
      edge,
      sourceLabel: nodeLabel(edge.source),
      targetLabel: nodeLabel(edge.target),
      typeLocked: endpointIsControl,
    };
  }, [selected, displayNodes, displayEdges, nodes, nodeLabel]);

  // -------------------------------------------------------------------------
  // Canvas mutations
  // -------------------------------------------------------------------------

  const onNodesChange = useCallback(
    (changes: NodeChange<OcdfgFlowNode>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<ArcFlowEdge>[]) =>
      setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  );

  /** Center of the visible canvas in flow coordinates, plus a small jitter. */
  const viewportCenter = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const point = screenToFlowPosition({
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    });
    return {
      x: point.x + (Math.random() - 0.5) * 90,
      y: point.y + (Math.random() - 0.5) * 90,
    };
  }, [screenToFlowPosition]);

  /** The active object type, creating "Object Type 1" when none exists yet. */
  const ensureActiveType = useCallback((): { name: string; created: boolean } => {
    const existing =
      activeType && objectTypes.some((t) => t.name === activeType)
        ? activeType
        : objectTypes[0]?.name;
    if (existing) return { name: existing, created: false };
    const name = 'Object Type 1';
    setObjectTypes([{ name, color: nextFreeColor([]) }]);
    setActiveType(name);
    return { name, created: true };
  }, [activeType, objectTypes]);

  const addActivity = useCallback(() => {
    record();
    const id = nextFreeId('a', nodes.map((n) => n.id));
    const usedLabels = new Set(
      nodes.filter((n) => !isControlNode(n)).map((n) => (n as ActivityFlowNode).data.label),
    );
    let n = 1;
    while (usedLabels.has(`Activity ${n}`)) n += 1;
    const node: ActivityFlowNode = {
      id,
      type: 'activity',
      position: viewportCenter(),
      selected: true,
      data: { label: `Activity ${n}`, typeDotColors: [] },
    };
    setNodes((current) => [
      ...current.map((existing) => ({ ...existing, selected: false })),
      node,
    ]);
    setEdges((current) => current.map((e) => ({ ...e, selected: false })));
    setSelected({ kind: 'node', id });
  }, [record, nodes, viewportCenter]);

  const addControl = useCallback(
    (kind: 'start' | 'end') => {
      const label = kind === 'start' ? 'START' : 'END';
      const existingForType = (type: string) =>
        nodes.find(
          (n): n is ControlFlowNode =>
            isControlNode(n) && n.data.kind === kind && n.data.objectType === type,
        );
      const currentType =
        activeType && objectTypes.some((t) => t.name === activeType)
          ? activeType
          : objectTypes[0]?.name;
      if (currentType) {
        const existing = existingForType(currentType);
        if (existing) {
          toast.info(
            `"${currentType}" already has a ${label} node — an OC-DFG has at most one per object type.`,
          );
          setNodes((current) =>
            current.map((n) => ({ ...n, selected: n.id === existing.id })),
          );
          setEdges((current) => current.map((e) => ({ ...e, selected: false })));
          setSelected({ kind: 'node', id: existing.id });
          return;
        }
      }
      record();
      const { name: typeName, created } = ensureActiveType();
      if (created) {
        toast.info(`Created "${typeName}" — every ${label} node needs an object type.`);
      }
      const id = controlNodeId(kind, typeName, nodes.map((n) => n.id));
      const node: ControlFlowNode = {
        id,
        type: 'control',
        position: viewportCenter(),
        selected: true,
        data: { kind, objectType: typeName, color: FALLBACK_TYPE_COLOR },
      };
      setNodes((current) => [
        ...current.map((existing) => ({ ...existing, selected: false })),
        node,
      ]);
      setEdges((current) => current.map((e) => ({ ...e, selected: false })));
      setSelected({ kind: 'node', id });
    },
    [record, nodes, objectTypes, activeType, ensureActiveType, viewportCenter],
  );

  /** Object type a new arc between the two nodes would get. */
  const arcTypeFor = useCallback(
    (sourceNode: OcdfgFlowNode, targetNode: OcdfgFlowNode): string | null => {
      if (isControlNode(sourceNode)) return sourceNode.data.objectType;
      if (isControlNode(targetNode)) return targetNode.data.objectType;
      return activeType && objectTypes.some((t) => t.name === activeType)
        ? activeType
        : objectTypes[0]?.name ?? null;
    },
    [activeType, objectTypes],
  );

  const connectionProblem = useCallback(
    (source: string | null, target: string | null): string | null => {
      if (!source || !target) return 'Arcs connect activities and START/END nodes.';
      const sourceNode = nodes.find((n) => n.id === source);
      const targetNode = nodes.find((n) => n.id === target);
      if (!sourceNode || !targetNode) {
        return 'Arcs connect activities and START/END nodes.';
      }
      if (isControlNode(sourceNode) && sourceNode.data.kind === 'end') {
        return 'Arcs cannot leave an END node.';
      }
      if (isControlNode(targetNode) && targetNode.data.kind === 'start') {
        return 'Arcs cannot enter a START node.';
      }
      if (
        isControlNode(sourceNode) &&
        isControlNode(targetNode) &&
        sourceNode.data.objectType !== targetNode.data.objectType
      ) {
        return 'START and END nodes of different object types cannot be connected.';
      }
      const type = arcTypeFor(sourceNode, targetNode);
      if (type && hasArc(edges, source, target, type)) {
        return `This arc already exists for "${type}".`;
      }
      return null;
    },
    [nodes, edges, arcTypeFor],
  );

  const isValidConnection = useCallback(
    (connection: ArcFlowEdge | Connection) =>
      connectionProblem(connection.source, connection.target) === null,
    [connectionProblem],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connectionProblem(connection.source, connection.target) !== null) return;
      const sourceNode = nodes.find((n) => n.id === connection.source)!;
      const targetNode = nodes.find((n) => n.id === connection.target)!;
      record();
      let type = arcTypeFor(sourceNode, targetNode);
      if (!type) {
        const ensured = ensureActiveType();
        type = ensured.name;
        toast.info(`Created "${type}" — every arc belongs to an object type.`);
      }
      const edge: ArcFlowEdge = {
        id: nextFreeId('f', edges.map((e) => e.id)),
        type: 'arc',
        source: connection.source,
        target: connection.target,
        data: { objectType: type, color: FALLBACK_TYPE_COLOR },
      };
      setEdges((current) => [...current, edge]);
    },
    [connectionProblem, record, nodes, edges, arcTypeFor, ensureActiveType],
  );

  // -------------------------------------------------------------------------
  // Deletion (keyboard deletes go through onBeforeDelete for one snapshot)
  // -------------------------------------------------------------------------

  const onBeforeDelete = useCallback(
    async ({
      nodes: toDeleteNodes,
      edges: toDeleteEdges,
    }: {
      nodes: OcdfgFlowNode[];
      edges: ArcFlowEdge[];
    }) => {
      // xyflow calls this even for an empty selection — don't record a
      // no-op snapshot (it would also wipe the redo stack).
      if (toDeleteNodes.length === 0 && toDeleteEdges.length === 0) return false;
      record();
      return true;
    },
    [record],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      record();
      setNodes((current) => current.filter((n) => n.id !== nodeId));
      setEdges((current) =>
        current.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
      setSelected(null);
    },
    [record],
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      record();
      setEdges((current) => current.filter((e) => e.id !== edgeId));
      setSelected(null);
    },
    [record],
  );

  // -------------------------------------------------------------------------
  // Arc bend points (double-click an arc to add, drag to move, double-click
  // the point to remove; stored as a layout-only "waypoints" hint in the JSON)
  // -------------------------------------------------------------------------

  const waypointSnapshotRef = useRef<OcdfgModelFile | null>(null);
  // Whether the current bend-point drag actually changed a waypoint. The end
  // handler must not compare serialized state: the pointermove commits are
  // continuous-priority and may not have flushed when pointerup fires.
  const waypointMovedRef = useRef(false);

  const onEdgeDoubleClick = useCallback(
    (event: React.MouseEvent, edge: ArcFlowEdge) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceNode = nodesRef.current.find((n) => n.id === edge.source);
      const targetNode = nodesRef.current.find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // Derived routing (self-loop / parallel offset) becomes real bend
      // points on first edit, so the arc keeps its shape and just gains a
      // handle where clicked.
      const waypoints = effectiveWaypoints(
        flowNodeBox(sourceNode),
        flowNodeBox(targetNode),
        edge.source === edge.target,
        edge.data?.waypoints ?? [],
        edge.data?.parallelOffset ?? 0,
        edge.data?.loopIndex ?? 0,
      );
      const points = arcPathPoints(
        flowNodeBox(sourceNode),
        isControlNode(sourceNode),
        flowNodeBox(targetNode),
        isControlNode(targetNode),
        waypoints,
      );
      const insertAt = nearestSegmentIndex(points, position);
      record();
      setEdges((current) =>
        current.map((e) =>
          e.id === edge.id
            ? {
                ...e,
                data: {
                  ...e.data!,
                  waypoints: [
                    ...waypoints.slice(0, insertAt),
                    position,
                    ...waypoints.slice(insertAt),
                  ],
                },
              }
            : e,
        ),
      );
    },
    [record, screenToFlowPosition],
  );

  const edgeApi = useMemo<OcdfgEdgeApi>(
    () => ({
      beginWaypointDrag: () => {
        waypointSnapshotRef.current = serializeRef.current();
        waypointMovedRef.current = false;
      },
      moveWaypoint: (edgeId: string, index: number, position: XY) => {
        setEdges((current) =>
          current.map((e) => {
            if (e.id !== edgeId) return e;
            const waypoints = [...(e.data?.waypoints ?? [])];
            if (index < 0 || index >= waypoints.length) return e;
            waypoints[index] = position;
            // Ref write inside an updater is idempotent — safe under
            // StrictMode double-invocation.
            waypointMovedRef.current = true;
            return { ...e, data: { ...e.data!, waypoints } };
          }),
        );
      },
      endWaypointDrag: () => {
        const before = waypointSnapshotRef.current;
        waypointSnapshotRef.current = null;
        if (before && waypointMovedRef.current) pushHistory(before);
        waypointMovedRef.current = false;
      },
      removeWaypoint: (edgeId: string, index: number) => {
        record();
        setEdges((current) =>
          current.map((e) =>
            e.id === edgeId
              ? {
                  ...e,
                  data: {
                    ...e.data!,
                    waypoints: (e.data?.waypoints ?? []).filter((_, i) => i !== index),
                  },
                }
              : e,
          ),
        );
      },
    }),
    [pushHistory, record],
  );

  // -------------------------------------------------------------------------
  // Object type management
  // -------------------------------------------------------------------------

  const addType = useCallback(() => {
    record();
    let n = 1;
    while (objectTypes.some((t) => t.name === `Object Type ${n}`)) n += 1;
    const name = `Object Type ${n}`;
    setObjectTypes((current) => [
      ...current,
      { name, color: nextFreeColor(current.map((t) => t.color)) },
    ]);
    setActiveType(name);
  }, [record, objectTypes]);

  const renameType = useCallback(
    (oldName: string, rawName: string): boolean => {
      const newName = rawName.trim();
      if (!newName) {
        toast.error('Object type names cannot be empty.');
        return false;
      }
      if (newName === oldName) return true;
      if (objectTypes.some((t) => t.name === newName)) {
        toast.error(`An object type named "${newName}" already exists.`);
        return false;
      }
      record();
      setObjectTypes((current) =>
        current.map((t) => (t.name === oldName ? { ...t, name: newName } : t)),
      );
      setNodes((current) =>
        current.map((node) =>
          isControlNode(node) && node.data.objectType === oldName
            ? { ...node, data: { ...node.data, objectType: newName } }
            : node,
        ),
      );
      setEdges((current) =>
        current.map((edge) =>
          edge.data?.objectType === oldName
            ? { ...edge, data: { ...edge.data, objectType: newName } }
            : edge,
        ),
      );
      setActiveType((previous) => (previous === oldName ? newName : previous));
      return true;
    },
    [record, objectTypes],
  );

  const changeTypeColor = useCallback(
    (name: string, color: string) => {
      record();
      setObjectTypes((current) =>
        current.map((t) => (t.name === name ? { ...t, color } : t)),
      );
    },
    [record],
  );

  const deleteType = useCallback(
    (name: string) => {
      record();
      const controlIds = new Set(
        nodes
          .filter((n) => isControlNode(n) && n.data.objectType === name)
          .map((n) => n.id),
      );
      const removedArcs = edges.filter(
        (e) =>
          e.data?.objectType === name ||
          controlIds.has(e.source) ||
          controlIds.has(e.target),
      ).length;
      setObjectTypes((current) => current.filter((t) => t.name !== name));
      setNodes((current) => current.filter((n) => !controlIds.has(n.id)));
      setEdges((current) =>
        current.filter(
          (e) =>
            e.data?.objectType !== name &&
            !controlIds.has(e.source) &&
            !controlIds.has(e.target),
        ),
      );
      setActiveType((previous) => {
        if (previous !== name) return previous;
        const remaining = objectTypes.filter((t) => t.name !== name);
        return remaining[0]?.name ?? null;
      });
      if (removedArcs > 0 || controlIds.size > 0) {
        toast.info(
          `Deleted "${name}" with ${controlIds.size} START/END node${
            controlIds.size === 1 ? '' : 's'
          } and ${removedArcs} arc${removedArcs === 1 ? '' : 's'}.`,
        );
      }
      setSelected(null);
    },
    [record, nodes, edges, objectTypes],
  );

  // -------------------------------------------------------------------------
  // Element property changes
  // -------------------------------------------------------------------------

  const changeActivityLabel = useCallback(
    (activityId: string, label: string) => {
      record();
      setNodes((current) =>
        current.map((node) =>
          node.id === activityId && !isControlNode(node)
            ? { ...node, data: { ...node.data, label } }
            : node,
        ),
      );
    },
    [record],
  );

  const changeArcType = useCallback(
    (arcId: string, objectType: string) => {
      const edge = edges.find((e) => e.id === arcId);
      if (!edge || edge.data?.objectType === objectType) return;
      if (hasArc(edges, edge.source, edge.target, objectType)) {
        toast.error(
          `An arc ${nodeLabel(edge.source)} → ${nodeLabel(edge.target)} already exists for "${objectType}".`,
        );
        return;
      }
      record();
      setEdges((current) =>
        current.map((e) =>
          e.id === arcId ? { ...e, data: { ...e.data!, objectType } } : e,
        ),
      );
    },
    [record, edges, nodeLabel],
  );

  // -------------------------------------------------------------------------
  // Node dragging → one undo snapshot per drag
  // -------------------------------------------------------------------------

  const onNodeDragStart = useCallback(() => {
    dragSnapshotRef.current = serializeRef.current();
  }, []);

  const onNodeDragStop = useCallback(() => {
    const before = dragSnapshotRef.current;
    dragSnapshotRef.current = null;
    if (!before) return;
    // Position changes are applied by onNodesChange during the drag; only
    // record when something actually moved.
    window.setTimeout(() => {
      if (JSON.stringify(serializeRef.current()) !== JSON.stringify(before)) {
        history.record(before);
      }
    }, 0);
  }, [history]);

  // -------------------------------------------------------------------------
  // File actions
  // -------------------------------------------------------------------------

  const handleNew = useCallback(() => {
    applyModel(emptyModel(modelName));
    history.reset();
  }, [applyModel, history, modelName]);

  const handleImport = useCallback(async () => {
    try {
      const raw = await openJsonFile();
      if (raw === null) return;
      const parsed = parseOcdfgModelFile(raw);
      if (parsed.ok === false) {
        toast.error(parsed.error);
        return;
      }
      // Keep the current model reachable via undo instead of resetting history.
      record();
      applyModel(parsed.model, { fit: true });
      for (const warning of parsed.warnings ?? []) toast.info(warning);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read the file.');
    }
  }, [applyModel, record]);

  const handleExport = useCallback(() => {
    const filename = toFilename(modelName, 'ocdfg-model');
    downloadJson(filename, serializeRef.current());
    toast.success(`Saved ${filename}.json`);
  }, [modelName]);

  const handleLoadExample = useCallback(() => {
    // Same (validated) code path as importing a file.
    const parsed = parseOcdfgModelFile(exampleModel());
    if (parsed.ok === false) {
      toast.error(parsed.error);
      return;
    }
    // Keep the current model reachable via undo instead of resetting history.
    record();
    applyModel(parsed.model, { fit: true });
    for (const warning of parsed.warnings ?? []) toast.info(warning);
  }, [applyModel, record]);

  const handleAutoLayout = useCallback(async () => {
    if (nodes.length === 0) return;
    record();
    try {
      const laidOut = await layoutOcdfg(nodes, edges);
      // Edits may have landed while ELK was running — merge only the computed
      // positions into the CURRENT state instead of replacing it wholesale.
      const positions = new Map(laidOut.map((n) => [n.id, n.position] as const));
      const mergePositions = (current: OcdfgFlowNode[]): OcdfgFlowNode[] =>
        current.map((n) => {
          const position = positions.get(n.id);
          return position ? { ...n, position } : n;
        });
      setNodes(mergePositions);
      // Hand-placed bend points rarely make sense for the fresh layout.
      setEdges((current) =>
        current.map((e) =>
          e.data?.waypoints?.length ? { ...e, data: { ...e.data, waypoints: [] } } : e,
        ),
      );
      window.setTimeout(() => fitView({ padding: 0.2 }), 0);
    } catch {
      toast.error('Auto layout failed.');
    }
  }, [nodes, edges, record, fitView]);

  // -------------------------------------------------------------------------

  return (
    <EditorShell
      title="OC-DFG Editor"
      description="Object-centric directly-follows graphs — activities, typed arcs & START/END nodes"
      modelName={modelName}
      onModelNameChange={setModelName}
      onNew={handleNew}
      onImport={handleImport}
      onExport={handleExport}
      onAutoLayout={handleAutoLayout}
      onLoadExample={handleLoadExample}
      undo={{ onClick: handleUndo, disabled: !history.canUndo }}
      redo={{ onClick: handleRedo, disabled: !history.canRedo }}
      toolbar={
        <>
          <ToolButton label="Add activity" onClick={addActivity}>
            <RectangleHorizontal />
          </ToolButton>
          <ToolButton label="Add START node (active type)" onClick={() => addControl('start')}>
            <CirclePlay />
          </ToolButton>
          <ToolButton label="Add END node (active type)" onClick={() => addControl('end')}>
            <CircleStop />
          </ToolButton>
        </>
      }
      sidePanel={
        <OcdfgSidePanel
          objectTypes={objectTypes}
          activeType={activeType}
          arcCounts={arcCounts}
          selection={selection}
          onSetActiveType={setActiveType}
          onAddType={addType}
          onRenameType={renameType}
          onChangeTypeColor={changeTypeColor}
          onDeleteType={deleteType}
          onChangeActivityLabel={changeActivityLabel}
          onChangeArcType={changeArcType}
          onDeleteNode={deleteNode}
          onDeleteEdge={deleteEdge}
        />
      }
    >
      <div ref={wrapperRef} className="relative h-full w-full">
        <OcdfgEdgeApiContext.Provider value={edgeApi}>
          <ActiveTypeColorContext.Provider
            value={(activeType && typeColors[activeType]) || FALLBACK_TYPE_COLOR}
          >
            <ReactFlow
              nodes={displayNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              connectionLineComponent={ArcConnectionLine}
              isValidConnection={isValidConnection}
              onConnectEnd={(_event, connectionState) => {
                if (connectionState.isValid === false && connectionState.toNode) {
                  const problem = connectionProblem(
                    connectionState.fromNode?.id ?? null,
                    connectionState.toNode.id,
                  );
                  if (problem) toast.info(problem);
                }
              }}
              onSelectionChange={onSelectionChange}
              onBeforeDelete={onBeforeDelete}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onEdgeDoubleClick={onEdgeDoubleClick}
              fitView
              deleteKeyCode={['Backspace', 'Delete']}
              connectionMode={ConnectionMode.Loose}
              connectionRadius={70}
              zoomOnDoubleClick={false}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#CBD5E1" />
              <Controls className="ocdfg-controls" showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                className="!bg-white/90 rounded-lg border"
                nodeColor={(node) =>
                  node.type === 'control'
                    ? ((node.data as ControlFlowNode['data']).color ?? FALLBACK_TYPE_COLOR)
                    : '#E2E8F0'
                }
              />
            </ReactFlow>
          </ActiveTypeColorContext.Provider>
        </OcdfgEdgeApiContext.Provider>
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg bg-white/80 px-5 py-3 text-center text-sm text-muted-foreground shadow-sm">
              Click “Add activity” or “Add START/END node” to start,
              <br />
              or load a JSON file / the example.
            </div>
          </div>
        )}
      </div>
    </EditorShell>
  );
}

export default function OcdfgEditor() {
  return (
    <ReactFlowProvider>
      <OcdfgEditorInner />
    </ReactFlowProvider>
  );
}
