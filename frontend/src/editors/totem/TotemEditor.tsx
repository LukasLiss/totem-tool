import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnBeforeDelete,
} from '@xyflow/react';
import { SquarePlus } from 'lucide-react';
import { toast } from 'sonner';

import '@xyflow/react/dist/style.css';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { nextFreeColor } from '@/editors/shared/colors';
import EditorShell from '@/editors/shared/EditorShell';
import { downloadJson, openJsonFile, toFilename } from '@/editors/shared/io';
import {
  TOTEM_FORMAT,
  detectModelFormat,
  parseTotemModelFile,
  wrongFormatMessage,
  type TemporalRelation,
  type TotemModelFile,
} from '@/editors/shared/model-types';
import {
  loadEditorSession,
  saveEditorSession,
} from '@/editors/shared/sessionCache';
import { useUndoRedo } from '@/editors/shared/useUndoRedo';

import { EXAMPLE_MODEL } from './example';
import { layoutTotemGraph } from './layout';
import { buildModelFile, modelToFlow } from './serialize';
import { OverviewPanel, RelationPanel, TypePanel } from './TotemPanel';
import TotemRelationEdge from './TotemRelationEdge';
import TotemTypeNode from './TotemTypeNode';
import {
  freshId,
  type TotemRelationEdgeData,
  type TotemRelationEdgeType,
  type TotemTypeNodeType,
} from './types';

const nodeTypes = { totemType: TotemTypeNode };
const edgeTypes = { totemRelation: TotemRelationEdge };

const SESSION_KEY = 'totem';

/** Swap of the reading direction: D↔Di, I↔Ii, P stays — same semantics. */
const TEMPORAL_SWAP: Record<TemporalRelation, TemporalRelation> = {
  D: 'Di',
  Di: 'D',
  I: 'Ii',
  Ii: 'I',
  P: 'P',
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

function TotemEditorInner() {
  const [modelName, setModelName] = useState('TOTeM model');
  const [nodes, setNodes] = useState<TotemTypeNodeType[]>([]);
  const [edges, setEdges] = useState<TotemRelationEdgeType[]>([]);
  const history = useUndoRedo<TotemModelFile>();
  const { fitView, screenToFlowPosition } = useReactFlow<
    TotemTypeNodeType,
    TotemRelationEdgeType
  >();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragSnapshotRef = useRef<{ file: TotemModelFile; x: number; y: number } | null>(null);

  // Latest state for stable callbacks (avoids stale closures in listeners).
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const nameRef = useRef(modelName);
  nameRef.current = modelName;

  const serializeCurrent = useCallback(
    () => buildModelFile(nameRef.current, nodesRef.current, edgesRef.current),
    [],
  );

  const recordSnapshot = useCallback(() => {
    history.record(serializeCurrent());
  }, [history, serializeCurrent]);

  const restoreSnapshot = useCallback((file: TotemModelFile) => {
    setModelName(file.name);
    const flow = modelToFlow(file);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, []);

  const handleUndo = useCallback(() => {
    const snapshot = history.undo(serializeCurrent());
    if (snapshot) restoreSnapshot(snapshot);
  }, [history, restoreSnapshot, serializeCurrent]);

  const handleRedo = useCallback(() => {
    const snapshot = history.redo(serializeCurrent());
    if (snapshot) restoreSnapshot(snapshot);
  }, [history, restoreSnapshot, serializeCurrent]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  // -------------------------------------------------------------------------
  // Canvas change handling
  // -------------------------------------------------------------------------

  const onNodesChange = useCallback(
    (changes: NodeChange<TotemTypeNodeType>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<TotemRelationEdgeType>[]) =>
      setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  );

  /** One undo snapshot per canvas deletion (keyboard delete incl. cascades). */
  const onBeforeDelete: OnBeforeDelete<TotemTypeNodeType, TotemRelationEdgeType> =
    useCallback(
      async ({ nodes: toDeleteNodes, edges: toDeleteEdges }) => {
        if (toDeleteNodes.length === 0 && toDeleteEdges.length === 0) return false;
        recordSnapshot();
        return true;
      },
      [recordSnapshot],
    );

  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: TotemTypeNodeType) => {
      dragSnapshotRef.current = {
        file: serializeCurrent(),
        x: node.position.x,
        y: node.position.y,
      };
    },
    [serializeCurrent],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: TotemTypeNodeType) => {
      const started = dragSnapshotRef.current;
      dragSnapshotRef.current = null;
      if (!started) return;
      if (started.x !== node.position.x || started.y !== node.position.y) {
        history.record(started.file);
      }
    },
    [history],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (!source || !target) return;
      if (source === target) {
        toast.info('TOTeM does not support self-relations.');
        return;
      }
      const existing = edgesRef.current.find(
        (edge) =>
          (edge.source === source && edge.target === target) ||
          (edge.source === target && edge.target === source),
      );
      if (existing) {
        const sourceName = nodesRef.current.find((n) => n.id === source)?.data.name ?? source;
        const targetName = nodesRef.current.find((n) => n.id === target)?.data.name ?? target;
        toast.info(
          `There is already a relation between ${sourceName} and ${targetName} — select it to edit its annotations.`,
        );
        return;
      }
      recordSnapshot();
      const newEdge: TotemRelationEdgeType = {
        id: freshId('relation'),
        type: 'totemRelation',
        source,
        target,
        selected: true,
        data: {
          temporal: 'P',
          sourceToTarget: { log: '0..*', event: '0..*' },
          targetToSource: { log: '0..*', event: '0..*' },
        },
      };
      setNodes((current) =>
        current.map((node) => (node.selected ? { ...node, selected: false } : node)),
      );
      setEdges((current) => [
        ...current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
        newEdge,
      ]);
    },
    [recordSnapshot],
  );

  // -------------------------------------------------------------------------
  // Model mutations
  // -------------------------------------------------------------------------

  const selectNode = useCallback((nodeId: string) => {
    setNodes((current) =>
      current.map((node) =>
        node.selected !== (node.id === nodeId)
          ? { ...node, selected: node.id === nodeId }
          : node,
      ),
    );
    setEdges((current) =>
      current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
    );
  }, []);

  const addObjectType = useCallback(() => {
    recordSnapshot();
    const usedNames = new Set(nodesRef.current.map((node) => node.data.name));
    let counter = usedNames.size + 1;
    while (usedNames.has(`Object Type ${counter}`)) counter += 1;
    const name = `Object Type ${counter}`;
    const color = nextFreeColor(nodesRef.current.map((node) => node.data.color));

    const rect = wrapperRef.current?.getBoundingClientRect();
    const center = rect
      ? screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        })
      : { x: 0, y: 0 };
    const position = {
      x: Math.round(center.x - 70 + (Math.random() - 0.5) * 80),
      y: Math.round(center.y - 26 + (Math.random() - 0.5) * 80),
    };

    const newNode: TotemTypeNodeType = {
      id: freshId('type'),
      type: 'totemType',
      position,
      selected: true,
      data: { name, color },
    };
    setNodes((current) => [
      ...current.map((node) => (node.selected ? { ...node, selected: false } : node)),
      newNode,
    ]);
    setEdges((current) =>
      current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
    );
  }, [recordSnapshot, screenToFlowPosition]);

  const renameType = useCallback(
    (nodeId: string, name: string) => {
      // Relations reference nodes by id, so the rename cascades automatically
      // through all relations; serialization writes the new name everywhere.
      recordSnapshot();
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, name } } : node,
        ),
      );
    },
    [recordSnapshot],
  );

  const changeTypeColor = useCallback(
    (nodeId: string, color: string) => {
      recordSnapshot();
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, color } } : node,
        ),
      );
    },
    [recordSnapshot],
  );

  const deleteType = useCallback(
    (nodeId: string) => {
      recordSnapshot();
      setEdges((current) =>
        current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      );
      setNodes((current) => current.filter((node) => node.id !== nodeId));
    },
    [recordSnapshot],
  );

  const changeRelationData = useCallback(
    (edgeId: string, data: TotemRelationEdgeData) => {
      recordSnapshot();
      setEdges((current) =>
        current.map((edge) => (edge.id === edgeId ? { ...edge, data } : edge)),
      );
    },
    [recordSnapshot],
  );

  /**
   * Swap the reading direction of a relation: exchanges source/target, both
   * direction annotations and inverts the temporal code (D↔Di, I↔Ii, P stays).
   * Purely representational — semantics and rendering are unchanged.
   */
  const swapRelationDirection = useCallback(
    (edgeId: string) => {
      recordSnapshot();
      setEdges((current) =>
        current.map((edge) => {
          if (edge.id !== edgeId || !edge.data) return edge;
          return {
            ...edge,
            source: edge.target,
            target: edge.source,
            data: {
              temporal: TEMPORAL_SWAP[edge.data.temporal],
              sourceToTarget: { ...edge.data.targetToSource },
              targetToSource: { ...edge.data.sourceToTarget },
            },
          };
        }),
      );
    },
    [recordSnapshot],
  );

  const deleteRelation = useCallback(
    (edgeId: string) => {
      recordSnapshot();
      setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    },
    [recordSnapshot],
  );

  // -------------------------------------------------------------------------
  // File actions
  // -------------------------------------------------------------------------

  const loadModel = useCallback(
    (model: TotemModelFile) => {
      setModelName(model.name);
      const flow = modelToFlow(model);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      // Keep the refs in sync immediately: if the editor unmounts before the
      // next render (StrictMode dev double-mount, fast view switches), the
      // unmount save must serialize the loaded model, not the stale state.
      nameRef.current = model.name;
      nodesRef.current = flow.nodes;
      edgesRef.current = flow.edges;
      requestAnimationFrame(() => {
        fitView({ padding: 0.2 });
      });
    },
    [fitView],
  );

  // Persist the model across sidebar view switches: the editor unmounts when
  // another view opens, so save the serialized model on unmount and restore it
  // on the next mount. Mount/unmount only — the cleanup reads the latest state
  // from refs. StrictMode-safe: loadModel syncs the refs immediately, so the
  // dev double-mount round-trips the exact same model (restoring twice is
  // harmless), and an untouched empty editor never overwrites a real cache
  // entry with anything the restore path would pick up (trivial models are
  // ignored on mount).
  const loadModelRef = useRef(loadModel);
  loadModelRef.current = loadModel;
  useEffect(() => {
    const cached = loadEditorSession<TotemModelFile>(SESSION_KEY);
    if (cached && (cached.objectTypes.length > 0 || cached.relations.length > 0)) {
      loadModelRef.current(cached);
    }
    return () => {
      saveEditorSession(SESSION_KEY, serializeCurrent());
    };
  }, [serializeCurrent]);

  const handleNew = useCallback(() => {
    setNodes([]);
    setEdges([]);
    history.reset();
  }, [history]);

  const handleImport = useCallback(async () => {
    let raw: unknown;
    try {
      raw = await openJsonFile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read the file.');
      return;
    }
    if (raw === null) return;
    const detected = detectModelFormat(raw);
    if (detected && detected !== TOTEM_FORMAT) {
      toast.error(wrongFormatMessage(TOTEM_FORMAT, raw));
      return;
    }
    const parsed = parseTotemModelFile(raw);
    if (parsed.ok === false) {
      toast.error(parsed.error);
      return;
    }
    // Importing replaces the model — make it undoable instead of wiping history.
    recordSnapshot();
    loadModel(parsed.model);
    toast.success(`Loaded "${parsed.model.name}".`);
  }, [loadModel, recordSnapshot]);

  const handleExport = useCallback(() => {
    const filename = toFilename(nameRef.current, 'totem-model');
    downloadJson(filename, serializeCurrent());
    toast.success(`Saved ${filename}.json`);
  }, [serializeCurrent]);

  const handleLoadExample = useCallback(() => {
    // Same validated code path as importing a file.
    const parsed = parseTotemModelFile(EXAMPLE_MODEL);
    if (parsed.ok === false) {
      toast.error(parsed.error);
      return;
    }
    // Loading the example replaces the model — make it undoable.
    recordSnapshot();
    loadModel(parsed.model);
  }, [loadModel, recordSnapshot]);

  const handleAutoLayout = useCallback(async () => {
    if (nodesRef.current.length < 2) return;
    recordSnapshot();
    const positions = await layoutTotemGraph(nodesRef.current, edgesRef.current);
    setNodes((current) =>
      current.map((node) =>
        positions[node.id] ? { ...node, position: positions[node.id] } : node,
      ),
    );
    window.setTimeout(() => {
      fitView({ padding: 0.2, duration: 300 });
    }, 20);
  }, [fitView, recordSnapshot]);

  // -------------------------------------------------------------------------
  // Side panel
  // -------------------------------------------------------------------------

  const selectedNode = useMemo(() => nodes.find((node) => node.selected), [nodes]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.selected), [edges]);

  const relationCountOf = useCallback(
    (nodeId: string) =>
      edgesRef.current.filter((edge) => edge.source === nodeId || edge.target === nodeId)
        .length,
    [],
  );

  const isNameTaken = useCallback(
    (name: string, exceptNodeId: string) =>
      nodesRef.current.some((node) => node.id !== exceptNodeId && node.data.name === name),
    [],
  );

  let sidePanel: React.ReactNode;
  if (selectedNode) {
    sidePanel = (
      <TypePanel
        key={selectedNode.id}
        node={selectedNode}
        relationCount={
          edges.filter(
            (edge) => edge.source === selectedNode.id || edge.target === selectedNode.id,
          ).length
        }
        isNameTaken={isNameTaken}
        onRename={renameType}
        onColorChange={changeTypeColor}
        onDelete={deleteType}
      />
    );
  } else if (selectedEdge) {
    const sourceName =
      nodes.find((node) => node.id === selectedEdge.source)?.data.name ?? selectedEdge.source;
    const targetName =
      nodes.find((node) => node.id === selectedEdge.target)?.data.name ?? selectedEdge.target;
    sidePanel = (
      <RelationPanel
        key={selectedEdge.id}
        edge={selectedEdge}
        sourceName={sourceName}
        targetName={targetName}
        onDataChange={changeRelationData}
        onSwapDirection={swapRelationDirection}
        onDelete={deleteRelation}
      />
    );
  } else {
    sidePanel = (
      <OverviewPanel
        nodes={nodes}
        relationCount={relationCountOf}
        onAddType={addObjectType}
        onSelectNode={selectNode}
      />
    );
  }

  const toolbar = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" onClick={addObjectType}>
          <SquarePlus />
          <span className="sr-only">Add object type</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">Add object type</TooltipContent>
    </Tooltip>
  );

  return (
    <EditorShell
      title="TOTeM Model Editor"
      description="Object types with temporal relations and cardinalities"
      modelName={modelName}
      onModelNameChange={setModelName}
      onNew={handleNew}
      onImport={handleImport}
      onExport={handleExport}
      onAutoLayout={handleAutoLayout}
      onLoadExample={handleLoadExample}
      undo={{ onClick: handleUndo, disabled: !history.canUndo }}
      redo={{ onClick: handleRedo, disabled: !history.canRedo }}
      toolbar={toolbar}
      sidePanel={sidePanel}
    >
      <div ref={wrapperRef} className="relative h-full w-full">
        <ReactFlow<TotemTypeNodeType, TotemRelationEdgeType>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onBeforeDelete={onBeforeDelete}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={70}
          deleteKeyCode={['Backspace', 'Delete']}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#CBD5E1" />
          <Controls className="ocdfg-controls" showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            className="!bg-white/90 rounded-lg border"
            nodeColor={(node) =>
              typeof node.data?.color === 'string' ? node.data.color : '#94A3B8'
            }
          />
        </ReactFlow>
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-lg bg-white/80 px-4 py-3 text-center text-sm text-muted-foreground shadow-sm">
              Click “Add object type” to start,
              <br />
              or load a JSON file / the example.
            </div>
          </div>
        )}
      </div>
    </EditorShell>
  );
}

/** TOTeM model editor: object types + annotated temporal relations. */
export default function TotemEditor() {
  return (
    <ReactFlowProvider>
      <TotemEditorInner />
    </ReactFlowProvider>
  );
}
