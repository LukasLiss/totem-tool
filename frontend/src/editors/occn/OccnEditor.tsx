import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeFunc,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Boxes, SquarePlus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { assignTypeColors, nextFreeColor } from '@/editors/shared/colors';
import EditorShell from '@/editors/shared/EditorShell';
import { downloadJson, openJsonFile, toFilename } from '@/editors/shared/io';
import {
  OCCN_FORMAT,
  occnEndActivity,
  occnStartActivity,
  parseOccnModelFile,
  type OccnMarker,
  type OccnMarkerGroup,
  type OccnModelFile,
  type XY,
} from '@/editors/shared/model-types';
import { useUndoRedo } from '@/editors/shared/useUndoRedo';
import { cn } from '@/lib/utils';

import MarkerOverlay from './MarkerOverlay';
import OccnEdgeComponent from './OccnEdge';
import OccnNodeComponent from './OccnNode';
import {
  ActivityPanel,
  ArcPanel,
  OverviewPanel,
  type OccnPanelApi,
} from './OccnPanel';
import {
  activityKind,
  buildOccnExample,
  elkLayeredPositions,
  emptyOccnModel,
  normalizeBindings,
  pruneBindings,
  removeActivityFromBindings,
  removeArcFromBindings,
  removeTypeFromBindings,
  renameActivityInBindings,
  renameTypeInBindings,
  retypeArcInBindings,
} from './model';
import {
  arcId,
  OccnRenderContext,
  type BindingsMap,
  type BindingSide,
  type GroupRef,
  type OccnEdge,
  type OccnNode,
  type Selection,
} from './types';

const nodeTypes = { occn: OccnNodeComponent };
const edgeTypes = { occnArc: OccnEdgeComponent };

type ObjectType = { name: string; color: string };

const uniqueName = (base: string, taken: (candidate: string) => boolean) => {
  let index = 1;
  while (taken(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
};

const jitter = (amount = 30) => (Math.random() - 0.5) * 2 * amount;

function OccnEditorInner() {
  const [modelName, setModelName] = useState('Object-centric causal net');
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [nodes, setNodes] = useState<OccnNode[]>([]);
  const [edges, setEdges] = useState<OccnEdge[]>([]);
  const [bindings, setBindings] = useState<BindingsMap>({});
  const [activeType, setActiveTypeState] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [focusedGroup, setFocusedGroup] = useState<GroupRef | null>(null);

  const history = useUndoRedo<OccnModelFile>();
  const reactFlow = useReactFlow<OccnNode, OccnEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragSnapshotRef = useRef<OccnModelFile | null>(null);

  // -------------------------------------------------------------------------
  // Serialization / loading
  // -------------------------------------------------------------------------

  const serialize = useCallback((): OccnModelFile => {
    return {
      format: OCCN_FORMAT,
      version: 1,
      name: modelName,
      objectTypes: types.map((t) => ({ name: t.name, color: t.color })),
      activities: nodes.map((n) => ({
        name: n.id,
        position: { x: n.position.x, y: n.position.y },
      })),
      arcs: edges.map((e) => ({
        source: e.source,
        target: e.target,
        objectType: e.data?.objectType ?? '',
      })),
      markerGroups: pruneBindings(bindings),
    };
  }, [modelName, types, nodes, edges, bindings]);

  const fitSoon = useCallback(() => {
    window.setTimeout(() => {
      void reactFlow.fitView({ padding: 0.2, duration: 300 });
    }, 30);
  }, [reactFlow]);

  const applyModel = useCallback(
    async (model: OccnModelFile, opts: { fit?: boolean; keepName?: boolean } = {}) => {
      const colors = assignTypeColors(model.objectTypes);
      const nextTypes: ObjectType[] = model.objectTypes.map((t) => ({
        name: t.name,
        color: colors[t.name],
      }));
      const typeNames = new Set(nextTypes.map((t) => t.name));

      // One START and one END pseudo activity per object type.
      const activityMap = new Map(model.activities.map((a) => [a.name, a]));
      for (const t of nextTypes) {
        for (const pseudo of [occnStartActivity(t.name), occnEndActivity(t.name)]) {
          if (!activityMap.has(pseudo)) activityMap.set(pseudo, { name: pseudo });
        }
      }
      const activities = [...activityMap.values()];

      let layouted: Record<string, XY> = {};
      if (activities.some((a) => !a.position) && activities.length > 0) {
        try {
          layouted = await elkLayeredPositions(
            activities.map((a) => ({
              id: a.name,
              kind: activityKind(a.name, typeNames).kind,
            })),
            model.arcs.map((arc) => ({ source: arc.source, target: arc.target })),
          );
        } catch {
          layouted = {};
        }
      }

      const nextNodes: OccnNode[] = activities.map((a, index) => {
        const kind = activityKind(a.name, typeNames);
        return {
          id: a.name,
          type: 'occn',
          position:
            a.position ??
            layouted[a.name] ?? {
              x: 80 + (index % 5) * 190,
              y: 80 + Math.floor(index / 5) * 130,
            },
          data: { label: a.name, kind: kind.kind, objectType: kind.objectType },
          deletable: kind.kind === 'activity',
        };
      });

      const nextEdges: OccnEdge[] = model.arcs.map((arc) => ({
        id: arcId(arc.source, arc.target, arc.objectType),
        source: arc.source,
        target: arc.target,
        type: 'occnArc',
        data: { objectType: arc.objectType },
      }));

      setTypes(nextTypes);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setBindings(normalizeBindings(model.markerGroups, activities.map((a) => a.name)));
      setActiveTypeState(nextTypes[0]?.name ?? null);
      setSelection(null);
      setFocusedGroup(null);
      if (!opts.keepName) setModelName(model.name);
      if (opts.fit) fitSoon();
    },
    [fitSoon],
  );

  // -------------------------------------------------------------------------
  // Derived render data
  // -------------------------------------------------------------------------

  const typeColors = useMemo(
    () => Object.fromEntries(types.map((t) => [t.name, t.color])),
    [types],
  );

  const incidentTypes = useMemo(() => {
    const order = new Map(types.map((t, i) => [t.name, i]));
    const sets: Record<string, Set<string>> = {};
    for (const edge of edges) {
      const ot = edge.data?.objectType;
      if (!ot) continue;
      (sets[edge.source] ??= new Set()).add(ot);
      (sets[edge.target] ??= new Set()).add(ot);
    }
    return Object.fromEntries(
      Object.entries(sets).map(([name, set]) => [
        name,
        [...set].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99)),
      ]),
    );
  }, [edges, types]);

  const parallelOffset = useMemo(() => {
    const pairs = new Map<string, OccnEdge[]>();
    for (const edge of edges) {
      const key = [edge.source, edge.target].sort().join(' ');
      const list = pairs.get(key);
      if (list) list.push(edge);
      else pairs.set(key, [edge]);
    }
    const result: Record<string, number> = {};
    for (const list of pairs.values()) {
      const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
      sorted.forEach((edge, index) => {
        let offset = (index - (sorted.length - 1) / 2) * 42;
        // Canonical perpendicular direction per unordered node pair, so
        // opposite-direction arcs fan out consistently.
        if (edge.source > edge.target) offset = -offset;
        result[edge.id] = offset;
      });
    }
    return result;
  }, [edges]);

  const renderContext = useMemo(
    () => ({ typeColors, incidentTypes, parallelOffset }),
    [typeColors, incidentTypes, parallelOffset],
  );

  const nodesById = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  // -------------------------------------------------------------------------
  // React Flow handlers
  // -------------------------------------------------------------------------

  const onNodesChange = useCallback((changes: NodeChange<OccnNode>[]) => {
    setNodes((current) =>
      applyNodeChanges(
        changes.filter((change) => change.type !== 'remove'),
        current,
      ),
    );
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<OccnEdge>[]) => {
    setEdges((current) =>
      applyEdgeChanges(
        changes.filter((change) => change.type !== 'remove'),
        current,
      ),
    );
  }, []);

  const onSelectionChange: OnSelectionChangeFunc<OccnNode, OccnEdge> = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }) => {
      if (selectedNodes.length > 0) {
        setSelection({ kind: 'activity', id: selectedNodes[0].id });
      } else if (selectedEdges.length > 0) {
        setSelection({ kind: 'arc', id: selectedEdges[0].id });
      } else {
        setSelection(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      focusedGroup &&
      !(selection?.kind === 'activity' && selection.id === focusedGroup.activity)
    ) {
      setFocusedGroup(null);
    }
  }, [selection, focusedGroup]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (!source || !target) return;
      if (source === target) {
        toast.info('Self-loops are not supported in the editor.');
        return;
      }
      const sourceNode = nodesById[source];
      const targetNode = nodesById[target];
      if (!sourceNode || !targetNode) return;
      if (sourceNode.data.kind === 'end') {
        toast.info('End activities have no outgoing arcs.');
        return;
      }
      if (targetNode.data.kind === 'start') {
        toast.info('Start activities have no incoming arcs.');
        return;
      }
      const forcedBySource =
        sourceNode.data.kind === 'start' ? sourceNode.data.objectType ?? null : null;
      const forcedByTarget =
        targetNode.data.kind === 'end' ? targetNode.data.objectType ?? null : null;
      if (forcedBySource && forcedByTarget && forcedBySource !== forcedByTarget) {
        toast.info(
          `START_${forcedBySource} and END_${forcedByTarget} belong to different object types.`,
        );
        return;
      }
      const objectType = forcedBySource ?? forcedByTarget ?? activeType;
      if (!objectType) {
        toast.info('Add an object type first — every arc needs one.');
        return;
      }
      if ((forcedBySource || forcedByTarget) && objectType !== activeType) {
        toast.info(
          `Using object type "${objectType}" — start/end activities only connect arcs of their own type.`,
        );
      }
      const id = arcId(source, target, objectType);
      if (edges.some((edge) => edge.id === id)) {
        toast.info(
          `The arc ${source} → ${target} (${objectType}) already exists — pick another active type for a parallel arc.`,
        );
        return;
      }

      history.record(serialize());
      setEdges((current) => [
        ...current,
        { id, source, target, type: 'occnArc', data: { objectType } },
      ]);
      // Auto-binding: singleton output group at the source, singleton input
      // group at the target (XOR semantics by default; merge in the panel).
      setBindings((current) => {
        const sourceBindings = current[source] ?? { img: [], omg: [] };
        const targetBindings = current[target] ?? { img: [], omg: [] };
        const outMarker: OccnMarker = [target, objectType, [1, 1], 0];
        const inMarker: OccnMarker = [source, objectType, [1, 1], 0];
        return {
          ...current,
          [source]: { ...sourceBindings, omg: [...sourceBindings.omg, [outMarker]] },
          [target]: { ...targetBindings, img: [...targetBindings.img, [inMarker]] },
        };
      });
    },
    [nodesById, activeType, edges, history, serialize],
  );

  // -------------------------------------------------------------------------
  // Deletion cascades
  // -------------------------------------------------------------------------

  const deleteElements = useCallback(
    (nodeIds: string[], edgeIds: string[]) => {
      const pseudo = nodeIds.filter((id) => nodesById[id]?.data.kind !== 'activity');
      if (pseudo.length > 0) {
        toast.info('Start/End activities are managed via their object type.');
      }
      const activityIds = nodeIds.filter(
        (id) => nodesById[id]?.data.kind === 'activity',
      );
      const removedNodeIds = new Set(activityIds);
      const removedEdges = edges.filter(
        (edge) =>
          edgeIds.includes(edge.id) ||
          removedNodeIds.has(edge.source) ||
          removedNodeIds.has(edge.target),
      );
      if (activityIds.length === 0 && removedEdges.length === 0) return;

      history.record(serialize());

      let nextBindings = bindings;
      for (const name of activityIds) {
        nextBindings = removeActivityFromBindings(nextBindings, name).bindings;
      }
      for (const edge of removedEdges) {
        if (removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target)) continue;
        nextBindings = removeArcFromBindings(nextBindings, {
          source: edge.source,
          target: edge.target,
          objectType: edge.data?.objectType ?? '',
        }).bindings;
      }
      const removedEdgeIds = new Set(removedEdges.map((edge) => edge.id));
      setNodes((current) => current.filter((node) => !removedNodeIds.has(node.id)));
      setEdges((current) => current.filter((edge) => !removedEdgeIds.has(edge.id)));
      setBindings(nextBindings);
      setSelection((current) => {
        if (!current) return current;
        if (current.kind === 'activity' && removedNodeIds.has(current.id)) return null;
        if (current.kind === 'arc' && removedEdgeIds.has(current.id)) return null;
        return current;
      });
    },
    [nodesById, edges, bindings, history, serialize],
  );

  const onBeforeDelete = useCallback(
    async ({
      nodes: toDeleteNodes,
      edges: toDeleteEdges,
    }: {
      nodes: OccnNode[];
      edges: OccnEdge[];
    }) => {
      deleteElements(
        toDeleteNodes.map((node) => node.id),
        toDeleteEdges.map((edge) => edge.id),
      );
      return false as const;
    },
    [deleteElements],
  );

  // -------------------------------------------------------------------------
  // Node dragging (single undo snapshot per drag)
  // -------------------------------------------------------------------------

  const onNodeDragStart = useCallback(() => {
    dragSnapshotRef.current = serialize();
  }, [serialize]);

  const onNodeDragStop = useCallback(
    (_event: unknown, _node: OccnNode, dragged: OccnNode[]) => {
      const snapshot = dragSnapshotRef.current;
      dragSnapshotRef.current = null;
      if (!snapshot) return;
      const before = new Map(snapshot.activities.map((a) => [a.name, a.position]));
      const moved = dragged.some((node) => {
        const prev = before.get(node.id);
        return !prev || prev.x !== node.position.x || prev.y !== node.position.y;
      });
      if (moved) history.record(snapshot);
    },
    [history],
  );

  // -------------------------------------------------------------------------
  // Element creation
  // -------------------------------------------------------------------------

  const flowPositionAt = useCallback(
    (fractionX: number, fractionY: number): XY => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return reactFlow.screenToFlowPosition({
        x: rect.left + rect.width * fractionX,
        y: rect.top + rect.height * fractionY,
      });
    },
    [reactFlow],
  );

  const addActivity = useCallback(() => {
    const name = uniqueName('activity', (candidate) => candidate in nodesById);
    history.record(serialize());
    const center = flowPositionAt(0.5, 0.5);
    const node: OccnNode = {
      id: name,
      type: 'occn',
      position: { x: center.x - 70 + jitter(), y: center.y - 28 + jitter() },
      data: { label: name, kind: 'activity' },
      selected: true,
      deletable: true,
    };
    setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), node]);
    setEdges((current) => current.map((e) => (e.selected ? { ...e, selected: false } : e)));
    setBindings((current) => ({ ...current, [name]: { img: [], omg: [] } }));
    setSelection({ kind: 'activity', id: name });
  }, [nodesById, history, serialize, flowPositionAt]);

  const addObjectType = useCallback(() => {
    const name = uniqueName(
      'type',
      (candidate) =>
        types.some((t) => t.name === candidate) ||
        occnStartActivity(candidate) in nodesById ||
        occnEndActivity(candidate) in nodesById,
    );
    history.record(serialize());
    const color = nextFreeColor(types.map((t) => t.color));
    const startName = occnStartActivity(name);
    const endName = occnEndActivity(name);
    const left = flowPositionAt(0.12, 0.5);
    const right = flowPositionAt(0.85, 0.5);
    const startNode: OccnNode = {
      id: startName,
      type: 'occn',
      position: { x: left.x, y: left.y - 37 + jitter(40) },
      data: { label: startName, kind: 'start', objectType: name },
      deletable: false,
    };
    const endNode: OccnNode = {
      id: endName,
      type: 'occn',
      position: { x: right.x, y: right.y - 37 + jitter(40) },
      data: { label: endName, kind: 'end', objectType: name },
      deletable: false,
    };
    setTypes((current) => [...current, { name, color }]);
    setNodes((current) => [...current, startNode, endNode]);
    setBindings((current) => ({
      ...current,
      [startName]: { img: [], omg: [] },
      [endName]: { img: [], omg: [] },
    }));
    setActiveTypeState(name);
    toast.success(`Added object type "${name}" with its START/END activities.`);
  }, [types, nodesById, history, serialize, flowPositionAt]);

  // -------------------------------------------------------------------------
  // Object type operations
  // -------------------------------------------------------------------------

  const renameObjectType = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName) return;
      if (types.some((t) => t.name === newName)) {
        toast.error(`Object type "${newName}" already exists.`);
        return;
      }
      const newStart = occnStartActivity(newName);
      const newEnd = occnEndActivity(newName);
      const oldStart = occnStartActivity(oldName);
      const oldEnd = occnEndActivity(oldName);
      if (
        (newStart in nodesById && newStart !== oldStart) ||
        (newEnd in nodesById && newEnd !== oldEnd)
      ) {
        toast.error(`An activity named "${newStart}" or "${newEnd}" already exists.`);
        return;
      }
      history.record(serialize());
      const renameNode = (id: string) =>
        id === oldStart ? newStart : id === oldEnd ? newEnd : id;
      setTypes((current) =>
        current.map((t) => (t.name === oldName ? { ...t, name: newName } : t)),
      );
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== oldStart && node.id !== oldEnd) return node;
          const id = renameNode(node.id);
          return { ...node, id, data: { ...node.data, label: id, objectType: newName } };
        }),
      );
      setEdges((current) =>
        current.map((edge) => {
          const source = renameNode(edge.source);
          const target = renameNode(edge.target);
          const objectType =
            edge.data?.objectType === oldName ? newName : edge.data?.objectType ?? '';
          if (
            source === edge.source &&
            target === edge.target &&
            objectType === edge.data?.objectType
          ) {
            return edge;
          }
          return {
            ...edge,
            id: arcId(source, target, objectType),
            source,
            target,
            data: { objectType },
          };
        }),
      );
      setBindings((current) => renameTypeInBindings(current, oldName, newName));
      setActiveTypeState((current) => (current === oldName ? newName : current));
      setSelection(null);
    },
    [types, nodesById, history, serialize],
  );

  const recolorObjectType = useCallback(
    (name: string, color: string) => {
      const type = types.find((t) => t.name === name);
      if (!type || type.color === color) return;
      history.record(serialize());
      setTypes((current) =>
        current.map((t) => (t.name === name ? { ...t, color } : t)),
      );
    },
    [types, history, serialize],
  );

  const deleteObjectType = useCallback(
    (name: string) => {
      const startName = occnStartActivity(name);
      const endName = occnEndActivity(name);
      history.record(serialize());
      const removedEdges = edges.filter(
        (edge) =>
          edge.data?.objectType === name ||
          [edge.source, edge.target].some((id) => id === startName || id === endName),
      );
      const removedEdgeIds = new Set(removedEdges.map((edge) => edge.id));
      const { bindings: nextBindings, removedMarkers } = removeTypeFromBindings(
        bindings,
        name,
      );
      setTypes((current) => current.filter((t) => t.name !== name));
      setNodes((current) =>
        current.filter((node) => node.id !== startName && node.id !== endName),
      );
      setEdges((current) => current.filter((edge) => !removedEdgeIds.has(edge.id)));
      setBindings(nextBindings);
      setActiveTypeState((current) => {
        if (current !== name) return current;
        const remaining = types.filter((t) => t.name !== name);
        return remaining[0]?.name ?? null;
      });
      setSelection((current) => {
        if (!current) return current;
        if (
          current.kind === 'activity' &&
          (current.id === startName || current.id === endName)
        ) {
          return null;
        }
        if (current.kind === 'arc' && removedEdgeIds.has(current.id)) return null;
        return current;
      });
      toast.success(
        `Removed type "${name}": ${removedEdges.length} arc(s) and ${removedMarkers} marker(s).`,
      );
    },
    [edges, bindings, types, history, serialize],
  );

  // -------------------------------------------------------------------------
  // Activity / arc operations
  // -------------------------------------------------------------------------

  const renameActivity = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName) return;
      if (newName in nodesById) {
        toast.error(`An activity named "${newName}" already exists.`);
        return;
      }
      history.record(serialize());
      setNodes((current) =>
        current.map((node) =>
          node.id === oldName
            ? { ...node, id: newName, data: { ...node.data, label: newName } }
            : node,
        ),
      );
      setEdges((current) =>
        current.map((edge) => {
          if (edge.source !== oldName && edge.target !== oldName) return edge;
          const source = edge.source === oldName ? newName : edge.source;
          const target = edge.target === oldName ? newName : edge.target;
          return {
            ...edge,
            id: arcId(source, target, edge.data?.objectType ?? ''),
            source,
            target,
          };
        }),
      );
      setBindings((current) => renameActivityInBindings(current, oldName, newName));
      setSelection((current) =>
        current?.kind === 'activity' && current.id === oldName
          ? { kind: 'activity', id: newName }
          : current,
      );
      setFocusedGroup(null);
    },
    [nodesById, history, serialize],
  );

  const retypeArc = useCallback(
    (edgeId: string, newType: string) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (!edge || edge.data?.objectType === newType) return;
      const sourceKind = nodesById[edge.source]?.data.kind;
      const targetKind = nodesById[edge.target]?.data.kind;
      if (sourceKind !== 'activity' || targetKind !== 'activity') {
        toast.info('Arcs at START/END activities are fixed to their object type.');
        return;
      }
      const newId = arcId(edge.source, edge.target, newType);
      if (edges.some((e) => e.id === newId)) {
        toast.error(
          `The arc ${edge.source} → ${edge.target} (${newType}) already exists.`,
        );
        return;
      }
      history.record(serialize());
      const arc = {
        source: edge.source,
        target: edge.target,
        objectType: edge.data?.objectType ?? '',
      };
      setEdges((current) =>
        current.map((e) =>
          e.id === edgeId ? { ...e, id: newId, data: { objectType: newType } } : e,
        ),
      );
      setBindings((current) => retypeArcInBindings(current, arc, newType));
      setSelection((current) =>
        current?.kind === 'arc' && current.id === edgeId
          ? { kind: 'arc', id: newId }
          : current,
      );
    },
    [edges, nodesById, history, serialize],
  );

  // -------------------------------------------------------------------------
  // Marker group operations
  // -------------------------------------------------------------------------

  const updateGroups = useCallback(
    (
      activity: string,
      side: BindingSide,
      fn: (groups: OccnMarkerGroup[]) => OccnMarkerGroup[],
    ) => {
      setBindings((current) => {
        const entry = current[activity] ?? { img: [], omg: [] };
        return { ...current, [activity]: { ...entry, [side]: fn(entry[side]) } };
      });
    },
    [],
  );

  const addGroup = useCallback(
    (activity: string, side: BindingSide) => {
      const incident = edges.filter((edge) =>
        side === 'img' ? edge.target === activity : edge.source === activity,
      );
      if (incident.length === 0) {
        toast.info(
          `Connect an ${side === 'img' ? 'incoming' : 'outgoing'} arc to "${activity}" first.`,
        );
        return;
      }
      const first = incident[0];
      const related = side === 'img' ? first.source : first.target;
      const marker: OccnMarker = [related, first.data?.objectType ?? '', [1, 1], 0];
      history.record(serialize());
      updateGroups(activity, side, (groups) => [...groups, [marker]]);
    },
    [edges, history, serialize, updateGroups],
  );

  const deleteGroup = useCallback(
    (ref: GroupRef) => {
      history.record(serialize());
      updateGroups(ref.activity, ref.side, (groups) =>
        groups.filter((_, index) => index !== ref.groupIndex),
      );
      setFocusedGroup(null);
    },
    [history, serialize, updateGroups],
  );

  const addMarker = useCallback(
    (ref: GroupRef, related: string, objectType: string) => {
      const group = bindings[ref.activity]?.[ref.side]?.[ref.groupIndex];
      if (!group) return;
      if (group.some((m) => m[0] === related && m[1] === objectType)) {
        toast.info('This group already has a marker on that arc.');
        return;
      }
      history.record(serialize());
      const marker: OccnMarker = [related, objectType, [1, 1], 0];
      updateGroups(ref.activity, ref.side, (groups) =>
        groups.map((g, index) => (index === ref.groupIndex ? [...g, marker] : g)),
      );
    },
    [bindings, history, serialize, updateGroups],
  );

  const removeMarker = useCallback(
    (ref: GroupRef, markerIndex: number) => {
      history.record(serialize());
      updateGroups(ref.activity, ref.side, (groups) =>
        groups
          .map((g, index) =>
            index === ref.groupIndex ? g.filter((_, i) => i !== markerIndex) : g,
          )
          .filter((g) => g.length > 0),
      );
    },
    [history, serialize, updateGroups],
  );

  const updateMarker = useCallback(
    (
      ref: GroupRef,
      markerIndex: number,
      patch: { min?: number; max?: number; key?: number },
    ) => {
      const marker = bindings[ref.activity]?.[ref.side]?.[ref.groupIndex]?.[markerIndex];
      if (!marker) return;
      const [related, objectType, [min0, max0], key0] = marker;
      const min = patch.min !== undefined ? Math.max(1, Math.round(patch.min)) : min0;
      let max =
        patch.max !== undefined
          ? patch.max === -1
            ? -1
            : Math.max(1, Math.round(patch.max))
          : max0;
      if (max !== -1 && max < min) max = min;
      const key = patch.key !== undefined ? Math.max(0, Math.round(patch.key)) : key0;
      if (min === min0 && max === max0 && key === key0) return;
      history.record(serialize());
      const next: OccnMarker = [related, objectType, [min, max], key];
      updateGroups(ref.activity, ref.side, (groups) =>
        groups.map((g, gi) =>
          gi === ref.groupIndex ? g.map((m, mi) => (mi === markerIndex ? next : m)) : g,
        ),
      );
    },
    [bindings, history, serialize, updateGroups],
  );

  const selectGroup = useCallback((ref: GroupRef) => {
    setNodes((current) =>
      current.map((node) => ({ ...node, selected: node.id === ref.activity })),
    );
    setEdges((current) =>
      current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
    );
    setSelection({ kind: 'activity', id: ref.activity });
    setFocusedGroup(ref);
  }, []);

  // -------------------------------------------------------------------------
  // Shell actions
  // -------------------------------------------------------------------------

  const onNew = useCallback(() => {
    void applyModel(emptyOccnModel(modelName), { keepName: true });
    history.reset();
  }, [applyModel, history, modelName]);

  const onImport = useCallback(async () => {
    try {
      const raw = await openJsonFile();
      if (raw === null) return;
      const parsed = parseOccnModelFile(raw);
      if (parsed.ok === false) {
        toast.error(parsed.error);
        return;
      }
      await applyModel(parsed.model, { fit: true });
      history.reset();
      toast.success(`Loaded "${parsed.model.name}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read the file.');
    }
  }, [applyModel, history]);

  const onExport = useCallback(() => {
    const filename = toFilename(modelName, 'occn-model');
    downloadJson(filename, serialize());
    toast.success(`Saved ${filename}.json`);
  }, [modelName, serialize]);

  const onLoadExample = useCallback(async () => {
    const parsed = parseOccnModelFile(buildOccnExample());
    if (parsed.ok === false) {
      toast.error(parsed.error);
      return;
    }
    await applyModel(parsed.model, { fit: true });
    history.reset();
    toast.success('Loaded the shipping example.');
  }, [applyModel, history]);

  const onAutoLayout = useCallback(async () => {
    if (nodes.length === 0) return;
    history.record(serialize());
    try {
      const positions = await elkLayeredPositions(
        nodes.map((node) => ({ id: node.id, kind: node.data.kind })),
        edges.map((edge) => ({ source: edge.source, target: edge.target })),
      );
      setNodes((current) =>
        current.map((node) =>
          positions[node.id] ? { ...node, position: positions[node.id] } : node,
        ),
      );
      fitSoon();
    } catch {
      toast.error('Auto layout failed.');
    }
  }, [nodes, edges, history, serialize, fitSoon]);

  // Undo / redo (buttons + keyboard).
  const doUndo = useCallback(() => {
    const snapshot = history.undo(serialize());
    if (snapshot) void applyModel(snapshot, { keepName: true });
  }, [history, serialize, applyModel]);

  const doRedo = useCallback(() => {
    const snapshot = history.redo(serialize());
    if (snapshot) void applyModel(snapshot, { keepName: true });
  }, [history, serialize, applyModel]);

  const undoRedoRef = useRef({ undo: doUndo, redo: doRedo });
  undoRedoRef.current = { undo: doUndo, redo: doRedo };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoRedoRef.current.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        undoRedoRef.current.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // -------------------------------------------------------------------------
  // Panel
  // -------------------------------------------------------------------------

  const panelApi: OccnPanelApi = {
    addObjectType,
    renameObjectType,
    recolorObjectType,
    deleteObjectType,
    setActiveType: setActiveTypeState,
    renameActivity,
    deleteActivity: (name) => deleteElements([name], []),
    retypeArc,
    deleteArc: (edgeId) => deleteElements([], [edgeId]),
    addGroup,
    deleteGroup,
    addMarker,
    removeMarker,
    updateMarker,
  };

  const selectedNode =
    selection?.kind === 'activity' ? nodesById[selection.id] : undefined;
  const selectedEdge =
    selection?.kind === 'arc' ? edges.find((e) => e.id === selection.id) : undefined;

  const sidePanel = selectedNode ? (
    <ActivityPanel
      node={selectedNode}
      bindings={bindings}
      edges={edges}
      typeColors={typeColors}
      focusedGroup={focusedGroup}
      api={panelApi}
    />
  ) : selectedEdge ? (
    <ArcPanel
      edge={selectedEdge}
      nodesById={nodesById}
      bindings={bindings}
      types={types}
      typeColors={typeColors}
      api={panelApi}
    />
  ) : (
    <OverviewPanel
      types={types}
      activeType={activeType}
      isEmpty={nodes.length === 0}
      api={panelApi}
    />
  );

  const toolbar = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" onClick={addActivity}>
            <SquarePlus />
            <span className="sr-only">Add activity</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Add activity</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" onClick={addObjectType}>
            <Boxes />
            <span className="sr-only">Add object type</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Add object type (with START/END)</TooltipContent>
      </Tooltip>
    </>
  );

  return (
    <EditorShell
      title="OC Causal Net Editor"
      description="Typed dependency arcs with input/output marker groups"
      modelName={modelName}
      onModelNameChange={setModelName}
      onNew={onNew}
      onImport={() => void onImport()}
      onExport={onExport}
      onAutoLayout={() => void onAutoLayout()}
      onLoadExample={() => void onLoadExample()}
      undo={{ onClick: doUndo, disabled: !history.canUndo }}
      redo={{ onClick: doRedo, disabled: !history.canRedo }}
      toolbar={toolbar}
      sidePanel={sidePanel}
    >
      <div ref={wrapperRef} className="relative h-full w-full">
        <OccnRenderContext.Provider value={renderContext}>
          <ReactFlow<OccnNode, OccnEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onBeforeDelete={onBeforeDelete}
            onSelectionChange={onSelectionChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={70}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#CBD5E1" />
            <Controls className="ocdfg-controls" showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              className="!bg-white/90 rounded-lg border"
              nodeColor={(node) => {
                const data = node.data as OccnNode['data'];
                return data.kind !== 'activity'
                  ? typeColors[data.objectType ?? ''] ?? '#CBD5E1'
                  : '#CBD5E1';
              }}
            />
            <MarkerOverlay
              nodes={nodes}
              edges={edges}
              bindings={bindings}
              typeColors={typeColors}
              parallelOffset={parallelOffset}
              focusedGroup={focusedGroup}
              onSelectGroup={selectGroup}
            />
          </ReactFlow>
        </OccnRenderContext.Provider>

        {types.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
            <div
              className="pointer-events-auto flex max-w-[75%] flex-wrap items-center justify-center gap-1 rounded-full border bg-background/95 px-2 py-1 shadow-sm backdrop-blur"
              title="New arcs use the active object type"
            >
              {types.map((type) => (
                <button
                  key={type.name}
                  type="button"
                  onClick={() => setActiveTypeState(type.name)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs transition-colors',
                    activeType === type.name
                      ? 'bg-muted ring-2 ring-blue-500/60'
                      : 'hover:bg-muted/60',
                  )}
                >
                  <span
                    className="inline-block size-2.5 rounded-full border border-black/10"
                    style={{ background: type.color }}
                  />
                  <span className="max-w-28 truncate">{type.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-lg border bg-white/85 px-5 py-3 text-center text-sm text-muted-foreground shadow-sm">
              Click "Add object type" or "Add activity" to start,
              <br />
              or load a JSON file / the example.
            </div>
          </div>
        )}
      </div>
    </EditorShell>
  );
}

export default function OccnEditor() {
  return (
    <ReactFlowProvider>
      <OccnEditorInner />
    </ReactFlowProvider>
  );
}
