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
import { Circle, RectangleHorizontal, Square } from 'lucide-react';
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
  parseOcpnModelFile,
  type OcpnModelFile,
  type XY,
} from '@/editors/shared/model-types';
import { loadEditorSession, saveEditorSession } from '@/editors/shared/sessionCache';
import { useUndoRedo } from '@/editors/shared/useUndoRedo';

import { ArcConnectionLine, edgeTypes } from './ArcEdge';
import { arcPathPoints, flowNodeBox, nearestSegmentIndex } from './geometry';
import { layoutOcpn } from './layout';
import {
  arcObjectType,
  arcTransitionId,
  emptyModel,
  exampleModel,
  flowToModel,
  modelToFlow,
  nextFreeId,
  normalizeTransitions,
  placeTypeMap,
  setArcVariable,
} from './model';
import { nodeTypes } from './nodes';
import { OcpnSidePanel, type OcpnSelection } from './SidePanel';
import {
  FALLBACK_TYPE_COLOR,
  isPlaceNode,
  OcpnEdgeApiContext,
  type ArcFlowEdge,
  type OcpnEdgeApi,
  type OcpnFlowNode,
  type OcpnObjectType,
  type PlaceFlowNode,
  type TransitionFlowNode,
} from './types';

const DEFAULT_NAME = 'Object-centric Petri net';

const wellFormednessToast = (updated: number) =>
  toast.info(
    `Variable applies per transition and object type — ${updated} more arc${
      updated === 1 ? '' : 's'
    } updated (well-formedness).`,
  );

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

function OcpnEditorInner() {
  const [modelName, setModelName] = useState(DEFAULT_NAME);
  const [objectTypes, setObjectTypes] = useState<OcpnObjectType[]>([]);
  const [nodes, setNodes] = useState<OcpnFlowNode[]>([]);
  const [edges, setEdges] = useState<ArcFlowEdge[]>([]);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);

  const history = useUndoRedo<OcpnModelFile>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragSnapshotRef = useRef<OcpnModelFile | null>(null);
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
    (model: OcpnModelFile, options: { fit?: boolean } = {}) => {
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
    const cached = loadEditorSession<OcpnModelFile>('ocpn');
    if (
      cached &&
      (cached.places.length > 0 ||
        cached.transitions.length > 0 ||
        cached.objectTypes.length > 0)
    ) {
      applyModelRef.current(cached, { fit: true });
    }
    return () => {
      saveEditorSession('ocpn', serializeRef.current());
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

  const placeTypes = useMemo(() => placeTypeMap(nodes), [nodes]);

  const displayNodes = useMemo<OcpnFlowNode[]>(() => {
    // Object types touched by each transition (via its connected places).
    const touched = new Map<string, Set<string>>();
    for (const edge of edges) {
      const transition = placeTypes.has(edge.source) ? edge.target : edge.source;
      const type = placeTypes.get(placeTypes.has(edge.source) ? edge.source : edge.target);
      if (!type) continue;
      if (!touched.has(transition)) touched.set(transition, new Set());
      touched.get(transition)!.add(type);
    }
    return nodes.map((node) => {
      if (isPlaceNode(node)) {
        const place: PlaceFlowNode = {
          ...node,
          data: {
            ...node.data,
            color: typeColors[node.data.objectType] ?? FALLBACK_TYPE_COLOR,
          },
        };
        return place;
      }
      const types = touched.get(node.id);
      const transition: TransitionFlowNode = {
        ...node,
        data: {
          ...node.data,
          typeDotColors: objectTypes
            .filter((t) => types?.has(t.name))
            .map((t) => t.color),
        },
      };
      return transition;
    });
  }, [nodes, edges, placeTypes, typeColors, objectTypes]);

  const displayEdges = useMemo<ArcFlowEdge[]>(
    () =>
      edges.map((edge) => {
        const type =
          placeTypes.get(placeTypes.has(edge.source) ? edge.source : edge.target) ?? '';
        const color = typeColors[type] ?? FALLBACK_TYPE_COLOR;
        const variable = edge.data?.variable === true;
        return {
          ...edge,
          type: 'arc',
          data: { variable, color, objectType: type, waypoints: edge.data?.waypoints },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            // Absolute units — otherwise the marker scales with the wide
            // stroke of variable arcs and renders as a giant triangle.
            markerUnits: 'userSpaceOnUse',
            width: variable ? 22 : 18,
            height: variable ? 22 : 18,
          },
        };
      }),
    [edges, placeTypes, typeColors],
  );

  const placeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of nodes) {
      if (isPlaceNode(node)) {
        counts[node.data.objectType] = (counts[node.data.objectType] ?? 0) + 1;
      }
    }
    return counts;
  }, [nodes]);

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  const onSelectionChange = useCallback(
    ({
      nodes: selectedNodes,
      edges: selectedEdges,
    }: {
      nodes: OcpnFlowNode[];
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

  const selection = useMemo<OcpnSelection | null>(() => {
    if (!selected) return null;
    if (selected.kind === 'node') {
      const node = displayNodes.find((n) => n.id === selected.id);
      if (!node) return null;
      return isPlaceNode(node)
        ? { kind: 'place', node }
        : { kind: 'transition', node };
    }
    const edge = displayEdges.find((e) => e.id === selected.id);
    if (!edge) return null;
    const endpointLabel = (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return id;
      if (isPlaceNode(node)) return node.id;
      return node.data.silent ? `τ (${node.id})` : node.data.label || node.id;
    };
    return {
      kind: 'arc',
      edge,
      sourceLabel: endpointLabel(edge.source),
      targetLabel: endpointLabel(edge.target),
      objectType: edge.data?.objectType ?? '',
      color: edge.data?.color ?? FALLBACK_TYPE_COLOR,
    };
  }, [selected, displayNodes, displayEdges, nodes]);

  // -------------------------------------------------------------------------
  // Canvas mutations
  // -------------------------------------------------------------------------

  const onNodesChange = useCallback(
    (changes: NodeChange<OcpnFlowNode>[]) =>
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

  const addPlace = useCallback(() => {
    record();
    let types = objectTypes;
    let typeName =
      activeType && types.some((t) => t.name === activeType)
        ? activeType
        : types[0]?.name;
    if (!typeName) {
      typeName = 'Object Type 1';
      types = [{ name: typeName, color: nextFreeColor([]) }];
      setObjectTypes(types);
      setActiveType(typeName);
      toast.info('Created "Object Type 1" — every place needs an object type.');
    }
    const id = nextFreeId('p', nodes.map((n) => n.id));
    const node: PlaceFlowNode = {
      id,
      type: 'place',
      position: viewportCenter(),
      selected: true,
      data: {
        objectType: typeName,
        color: types.find((t) => t.name === typeName)?.color ?? FALLBACK_TYPE_COLOR,
        initial: false,
        final: false,
      },
    };
    setNodes((current) => [
      ...current.map((n) => ({ ...n, selected: false })),
      node,
    ]);
    setEdges((current) => current.map((e) => ({ ...e, selected: false })));
    setSelected({ kind: 'node', id });
  }, [record, objectTypes, activeType, nodes, viewportCenter]);

  const addTransition = useCallback(
    (silent: boolean) => {
      record();
      const id = nextFreeId('t', nodes.map((n) => n.id));
      const usedLabels = new Set(
        nodes.filter((n) => !isPlaceNode(n)).map((n) => (n as TransitionFlowNode).data.label),
      );
      let n = 1;
      while (usedLabels.has(`Activity ${n}`)) n += 1;
      const node: TransitionFlowNode = {
        id,
        type: 'transition',
        position: viewportCenter(),
        selected: true,
        data: { label: silent ? '' : `Activity ${n}`, silent, typeDotColors: [] },
      };
      setNodes((current) => [
        ...current.map((existing) => ({ ...existing, selected: false })),
        node,
      ]);
      setEdges((current) => current.map((e) => ({ ...e, selected: false })));
      setSelected({ kind: 'node', id });
    },
    [record, nodes, viewportCenter],
  );

  const connectionProblem = useCallback(
    (source: string | null, target: string | null): string | null => {
      if (!source || !target) return 'Arcs connect places and transitions.';
      const sourceNode = nodes.find((n) => n.id === source);
      const targetNode = nodes.find((n) => n.id === target);
      if (!sourceNode || !targetNode) return 'Arcs connect places and transitions.';
      if (isPlaceNode(sourceNode) === isPlaceNode(targetNode)) {
        return 'Arcs connect places and transitions.';
      }
      if (edges.some((e) => e.source === source && e.target === target)) {
        return 'This arc already exists.';
      }
      return null;
    },
    [nodes, edges],
  );

  const isValidConnection = useCallback(
    (connection: ArcFlowEdge | Connection) =>
      connectionProblem(connection.source, connection.target) === null,
    [connectionProblem],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connectionProblem(connection.source, connection.target) !== null) return;
      record();
      const sourceNode = nodes.find((n) => n.id === connection.source)!;
      const targetNode = nodes.find((n) => n.id === connection.target)!;
      const transitionId = isPlaceNode(sourceNode) ? targetNode.id : sourceNode.id;
      const objectType = isPlaceNode(sourceNode)
        ? sourceNode.data.objectType
        : (targetNode as PlaceFlowNode).data.objectType;
      // Well-formedness: a new arc joins an existing variable group as variable.
      const groupIsVariable = edges.some(
        (edge) =>
          arcTransitionId(edge, placeTypes) === transitionId &&
          arcObjectType(edge, placeTypes) === objectType &&
          edge.data?.variable === true,
      );
      // No source/target handle: the arc floats and attaches wherever the
      // node border faces the other endpoint.
      const edge: ArcFlowEdge = {
        id: nextFreeId('a', edges.map((e) => e.id)),
        type: 'arc',
        source: connection.source,
        target: connection.target,
        data: { variable: groupIsVariable, color: FALLBACK_TYPE_COLOR, objectType },
      };
      if (groupIsVariable) {
        toast.info(
          `Created as VARIABLE arc — "${transitionId}" already handles sets of ${objectType} objects (well-formedness).`,
        );
      }
      setEdges((current) => [...current, edge]);
    },
    [connectionProblem, record, nodes, edges, placeTypes],
  );

  // -------------------------------------------------------------------------
  // Deletion (keyboard deletes go through onBeforeDelete for one snapshot)
  // -------------------------------------------------------------------------

  const onBeforeDelete = useCallback(
    async ({
      nodes: toDeleteNodes,
      edges: toDeleteEdges,
    }: {
      nodes: OcpnFlowNode[];
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

  const waypointSnapshotRef = useRef<OcpnModelFile | null>(null);
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
      const waypoints = edge.data?.waypoints ?? [];
      // Insert into the segment of the current path closest to the click, so
      // the arc keeps its shape and just gains a handle where clicked.
      const points = arcPathPoints(
        flowNodeBox(sourceNode),
        isPlaceNode(sourceNode),
        flowNodeBox(targetNode),
        isPlaceNode(targetNode),
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

  const edgeApi = useMemo<OcpnEdgeApi>(
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
          isPlaceNode(node) && node.data.objectType === oldName
            ? { ...node, data: { ...node.data, objectType: newName } }
            : node,
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
      const placeIds = new Set(
        nodes
          .filter((n) => isPlaceNode(n) && n.data.objectType === name)
          .map((n) => n.id),
      );
      setObjectTypes((current) => current.filter((t) => t.name !== name));
      setNodes((current) => current.filter((n) => !placeIds.has(n.id)));
      setEdges((current) =>
        current.filter((e) => !placeIds.has(e.source) && !placeIds.has(e.target)),
      );
      setActiveType((previous) => {
        if (previous !== name) return previous;
        const remaining = objectTypes.filter((t) => t.name !== name);
        return remaining[0]?.name ?? null;
      });
      if (placeIds.size > 0) {
        toast.info(
          `Deleted "${name}" with ${placeIds.size} place${placeIds.size === 1 ? '' : 's'} and their arcs.`,
        );
      }
      setSelected(null);
    },
    [record, nodes, objectTypes],
  );

  // -------------------------------------------------------------------------
  // Element property changes
  // -------------------------------------------------------------------------

  const changePlaceType = useCallback(
    (placeId: string, objectType: string) => {
      record();
      const nextNodes = nodes.map((node) =>
        node.id === placeId && isPlaceNode(node)
          ? { ...node, data: { ...node.data, objectType } }
          : node,
      );
      // Re-check well-formedness of every transition connected to the place.
      const nextPlaceTypes = placeTypeMap(nextNodes);
      const connectedTransitions = new Set<string>();
      for (const edge of edges) {
        if (edge.source === placeId) connectedTransitions.add(edge.target);
        if (edge.target === placeId) connectedTransitions.add(edge.source);
      }
      const { edges: nextEdges, changed } = normalizeTransitions(
        edges,
        nextPlaceTypes,
        connectedTransitions,
      );
      setNodes(nextNodes);
      if (changed > 0) {
        setEdges(nextEdges);
        wellFormednessToast(changed);
      }
    },
    [record, nodes, edges],
  );

  const setPlaceFlag = useCallback(
    (placeId: string, flag: 'initial' | 'final', value: boolean) => {
      record();
      setNodes((current) =>
        current.map((node) =>
          node.id === placeId && isPlaceNode(node)
            ? { ...node, data: { ...node.data, [flag]: value } }
            : node,
        ),
      );
    },
    [record],
  );

  const changeTransitionLabel = useCallback(
    (transitionId: string, label: string) => {
      record();
      setNodes((current) =>
        current.map((node) =>
          node.id === transitionId && !isPlaceNode(node)
            ? { ...node, data: { ...node.data, label } }
            : node,
        ),
      );
    },
    [record],
  );

  const setTransitionSilent = useCallback(
    (transitionId: string, silent: boolean) => {
      record();
      setNodes((current) =>
        current.map((node) =>
          node.id === transitionId && !isPlaceNode(node)
            ? { ...node, data: { ...node.data, silent } }
            : node,
        ),
      );
    },
    [record],
  );

  const setEdgeVariable = useCallback(
    (edgeId: string, variable: boolean) => {
      record();
      const { edges: nextEdges, othersChanged } = setArcVariable(
        edges,
        placeTypes,
        edgeId,
        variable,
      );
      setEdges(nextEdges);
      if (othersChanged > 0) wellFormednessToast(othersChanged);
    },
    [record, edges, placeTypes],
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
      const parsed = parseOcpnModelFile(raw);
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
    const filename = toFilename(modelName, 'ocpn-model');
    downloadJson(filename, serializeRef.current());
    toast.success(`Saved ${filename}.json`);
  }, [modelName]);

  const handleLoadExample = useCallback(() => {
    // Same (validated) code path as importing a file.
    const parsed = parseOcpnModelFile(exampleModel());
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
      const laidOut = await layoutOcpn(nodes, edges);
      // Edits may have landed while ELK was running — merge only the computed
      // positions into the CURRENT state instead of replacing it wholesale.
      const positions = new Map(laidOut.map((n) => [n.id, n.position] as const));
      const mergePositions = (current: OcpnFlowNode[]): OcpnFlowNode[] =>
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
      title="OC Petri Net Editor"
      description="Object-centric Petri nets — typed places, transitions & variable arcs"
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
          <ToolButton label="Add place" onClick={addPlace}>
            <Circle />
          </ToolButton>
          <ToolButton label="Add transition" onClick={() => addTransition(false)}>
            <RectangleHorizontal />
          </ToolButton>
          <ToolButton label="Add silent transition (τ)" onClick={() => addTransition(true)}>
            <Square className="fill-current" />
          </ToolButton>
        </>
      }
      sidePanel={
        <OcpnSidePanel
          objectTypes={objectTypes}
          activeType={activeType}
          placeCounts={placeCounts}
          selection={selection}
          onSetActiveType={setActiveType}
          onAddType={addType}
          onRenameType={renameType}
          onChangeTypeColor={changeTypeColor}
          onDeleteType={deleteType}
          onChangePlaceType={changePlaceType}
          onSetPlaceFlag={setPlaceFlag}
          onChangeTransitionLabel={changeTransitionLabel}
          onSetTransitionSilent={setTransitionSilent}
          onSetArcVariable={setEdgeVariable}
          onDeleteNode={deleteNode}
          onDeleteEdge={deleteEdge}
        />
      }
    >
      <div ref={wrapperRef} className="relative h-full w-full">
        <OcpnEdgeApiContext.Provider value={edgeApi}>
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
                node.type === 'place'
                  ? ((node.data as PlaceFlowNode['data']).color ?? FALLBACK_TYPE_COLOR)
                  : (node.data as TransitionFlowNode['data']).silent
                    ? '#0F172A'
                    : '#E2E8F0'
              }
            />
          </ReactFlow>
        </OcpnEdgeApiContext.Provider>
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg bg-white/80 px-5 py-3 text-center text-sm text-muted-foreground shadow-sm">
              Click “Add place” or “Add transition” to start,
              <br />
              or load a JSON file / the example.
            </div>
          </div>
        )}
      </div>
    </EditorShell>
  );
}

export default function OcpnEditor() {
  return (
    <ReactFlowProvider>
      <OcpnEditorInner />
    </ReactFlowProvider>
  );
}
