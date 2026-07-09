import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ReactFlow,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  PlusIcon,
  MinusIcon,
  ScanIcon,
  LockIcon,
  UnlockIcon,
  NetworkIcon,
  ArrowDownIcon,
  ArrowRightIcon,
} from 'lucide-react';
import { mapTypesToColors } from '../utils/objectColors';
import { occnToFlow, type OccnLayoutDirection, type OccnNet } from '../utils/occnTransform';
import { layoutOccn } from '../utils/occnLayout';
import OccnActivityNode from './OccnActivityNode';
import OccnTerminalNode from './OccnTerminalNode';
import OccnMarkerGroupNode from './OccnMarkerGroupNode';
import OccnEdge from './OccnEdge';

interface OCCNVisualizerProps {
  height?: string | number;
  fileId?: number;
  data?: OccnNet;
  showControls?: boolean;
  initialInteractionLocked?: boolean;
  typeColorOverrides?: Record<string, string>;
  /** Cap on rendered marker groups per activity side; the rest collapse into a "+N more" chip. */
  maxMarkerGroupsPerSide?: number;
  /** Initial ELK layout direction; the in-canvas toggle takes over afterwards. */
  initialLayoutDirection?: OccnLayoutDirection;
  /** Initial relative occurrence threshold; the in-canvas slider takes over afterwards. */
  initialThreshold?: number;
  /** Restrict discovery to these object types; empty/undefined = all types. */
  objectTypes?: string[];
  /** Hide the in-canvas title when the surrounding page already renders one. */
  showTitle?: boolean;
}

function resolveHeightValue(height: string | number) {
  return typeof height === 'number' ? `${height}px` : height;
}

function OCCNVisualizer({
  height = '100%',
  fileId,
  data,
  showControls = true,
  initialInteractionLocked = false,
  typeColorOverrides,
  maxMarkerGroupsPerSide,
  initialLayoutDirection = 'LR',
  initialThreshold = 0,
  objectTypes,
  showTitle = true,
}: OCCNVisualizerProps) {
  const reactFlow = useReactFlow();
  const { fitView } = reactFlow;

  const [net, setNet] = useState<OccnNet | null>(data ?? null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(initialInteractionLocked);
  // Threshold applied to the fetch; the slider commits into this state.
  const [threshold, setThreshold] = useState(initialThreshold);
  const [layoutDirection, setLayoutDirection] = useState<OccnLayoutDirection>(initialLayoutDirection);
  // Bumped by the "re-layout" button to rerun ELK after manual dragging.
  const [layoutTick, setLayoutTick] = useState(0);

  const nodeTypes = useMemo(
    () => ({
      occnActivity: OccnActivityNode,
      occnTerminal: OccnTerminalNode,
      occnMarkerGroup: OccnMarkerGroupNode,
    }),
    [],
  );
  const edgeTypes = useMemo(() => ({ occn: OccnEdge }), []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  // Normalized to a string so the fetch effect doesn't re-run on array identity.
  const objectTypesParam = (objectTypes ?? []).map((t) => t.trim()).filter(Boolean).join(',');

  // Fetch the serialized net. A `data` prop bypasses the fetch entirely.
  useEffect(() => {
    if (data) {
      setNet(data);
      setError(null);
      return;
    }
    if (fileId == null) {
      setNet(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    axios
      .get<OccnNet>(
        `http://127.0.0.1:8000/api/occn/?file_id=${fileId}&relativeOccuranceThreshold=${threshold}${
          objectTypesParam ? `&object_types=${encodeURIComponent(objectTypesParam)}` : ''
        }`,
      )
      .then(({ data: payload }) => {
        if (cancelled) return;
        setNet(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load OCCN', err);
        setNet(null);
        setError(err?.response?.data?.error ?? 'Failed to discover the OCCN for this file.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, fileId, threshold, objectTypesParam]);

  const typeColors = useMemo(
    () => (net ? mapTypesToColors(net.object_types, typeColorOverrides) : {}),
    [net, typeColorOverrides],
  );

  // Build + layout the flow graph whenever the net (or its colors, direction,
  // or the re-layout tick) change. ELK layout is async, so guard against a
  // stale run resolving after the inputs changed.
  useEffect(() => {
    if (!net) {
      setNodes([]);
      setEdges([]);
      return;
    }
    let cancelled = false;
    const { nodes: flowNodes, edges: flowEdges, groupSizes } = occnToFlow(net, typeColors, {
      maxMarkerGroupsPerSide,
      direction: layoutDirection,
    });
    layoutOccn(flowNodes, net.edges, groupSizes, layoutDirection)
      .catch((err) => {
        console.error('OCCN layout failed, rendering unpositioned nodes', err);
        return flowNodes;
      })
      .then((laidOutNodes) => {
        if (cancelled) return;
        setNodes(laidOutNodes);
        setEdges(flowEdges);
        window.requestAnimationFrame(() => fitView({ padding: 0.15 }));
      });
    return () => {
      cancelled = true;
    };
  }, [net, typeColors, fitView, maxMarkerGroupsPerSide, layoutDirection, layoutTick]);

  const interactionsDisabled = interactionLocked;

  return (
    <div
      style={{ height: resolveHeightValue(height), width: '100%', position: 'relative' }}
      className={interactionsDisabled ? 'interactions-disabled' : ''}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        // Dense logs at threshold 0 lay out tens of thousands of px tall;
        // fitView cannot go below minZoom, so keep it low enough to fit.
        minZoom={0.02}
        maxZoom={2.5}
        nodesDraggable={!interactionsDisabled}
        nodesConnectable={false}
        elementsSelectable={!interactionsDisabled}
        panOnDrag={!interactionsDisabled}
        zoomOnPinch={!interactionsDisabled}
        zoomOnScroll={!interactionsDisabled}
        zoomOnDoubleClick={!interactionsDisabled}
        preventScrolling={!interactionsDisabled}
      />

      {(loading || error) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            fontFamily: 'var(--font-primary, Inter, sans-serif)',
            fontSize: 14,
            color: error ? '#B91C1C' : '#475569',
          }}
        >
          {error ?? 'Discovering OCCN…'}
        </div>
      )}

      {showControls && (
        <>
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxHeight: 'calc(100% - 32px)',
          }}
        >
          {showTitle && (
            <div
              style={{
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: 12,
                padding: '10px 14px',
                boxShadow: 'none',
                fontFamily: 'var(--font-primary, Inter, sans-serif)',
                minWidth: 240,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>
                Object-Centric Causal Net (OCCN)
              </div>
            </div>
          )}

          {Object.keys(typeColors).length > 0 && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                background: '#FFFFFF',
                border: '1px solid #E5E7EB',
                borderRadius: 12,
                padding: '10px 14px',
                boxShadow: '0 6px 16px rgba(15, 23, 42, 0.05)',
                fontFamily: 'var(--font-primary, Inter, sans-serif)',
                maxHeight: '50vh',
                overflowY: 'auto',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A', marginBottom: 6 }}>
                Object types
              </div>
              {Object.entries(typeColors).map(([type, color]) => (
                <div
                  key={type}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#334155', lineHeight: '20px' }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: color,
                      flexShrink: 0,
                    }}
                  />
                  {type}
                </div>
              ))}
            </div>
          )}
        </div>

          <div
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: 16,
              right: 16,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 9999,
              padding: '6px 12px',
              boxShadow: '0 10px 24px rgba(15, 23, 42, 0.14)',
            }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 4 }}
              title="Relative occurrence threshold — commits on release and re-discovers the net"
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
                Threshold
              </span>
              <Slider
                className="w-28"
                min={0}
                max={1}
                step={0.05}
                defaultValue={[threshold]}
                onValueCommit={(value) => setThreshold(value[0] ?? 0)}
                disabled={data != null || loading}
              />
              <span style={{ fontSize: 11, color: '#475569', width: 28 }}>{threshold.toFixed(2)}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() =>
                setLayoutDirection((prev) => (prev === 'LR' ? 'TB' : 'LR'))
              }
              className="rounded-full h-9 w-9"
              title={
                layoutDirection === 'LR'
                  ? 'Switch to top-to-bottom layout'
                  : 'Switch to left-to-right layout'
              }
            >
              {layoutDirection === 'LR' ? (
                <ArrowRightIcon className="h-4 w-4" />
              ) : (
                <ArrowDownIcon className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setLayoutTick((tick) => tick + 1)}
              className="rounded-full h-9 w-9"
              title="Re-run automatic layout"
            >
              <NetworkIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => reactFlow.zoomIn?.()}
              className="rounded-full h-9 w-9"
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => reactFlow.zoomOut?.()}
              className="rounded-full h-9 w-9"
            >
              <MinusIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fitView({ padding: 0.15 })}
              className="rounded-full h-9 w-9"
            >
              <ScanIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={interactionLocked ? 'secondary' : 'outline'}
              size="icon"
              onClick={() => setInteractionLocked((prev) => !prev)}
              className="rounded-full h-9 w-9"
              title={interactionLocked ? 'Unlock interactions' : 'Lock interactions'}
            >
              {interactionLocked ? <UnlockIcon className="h-4 w-4" /> : <LockIcon className="h-4 w-4" />}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default OCCNVisualizer;
export type { OCCNVisualizerProps };
