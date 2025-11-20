import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  layoutOCDFG,
  type DfgNode,
  type DfgLink,
} from '../utils/GraphLayouter';
import { mapTypesToColors } from '../utils/objectColors';
import OcdfgEdge from './OcdfgEdge';
import OcdfgTerminalNode from './OcdfgTerminalNode';
import OcdfgDefaultNode from './OcdfgDefaultNode';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { PlusIcon, MinusIcon, ScanIcon, LockIcon, UnlockIcon, SaveIcon } from 'lucide-react';

const THICKNESS_MIN_LIMIT = 0.1;
const THICKNESS_MAX_LIMIT = 5;
const DEFAULT_THICKNESS_MIN = 0.5;
const DEFAULT_THICKNESS_MAX = 2;

// Define specific types for the data we expect from the backend
interface DfgData {
  dfg: {
    nodes: DfgNode[];
    links: DfgLink[];
  };
}

interface OCDFGVisualizerProps {
  height?: string | number;
}

function resolveHeightValue(height: string | number) {
  return typeof height === 'number' ? `${height}px` : height;
}

function OCDFGVisualizer({ height = 'calc(100vh - 50px)' }: OCDFGVisualizerProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [typeColors, setTypeColors] = useState<Record<string, string>>({});
  const [dfgData, setDfgData] = useState<{ nodes: DfgNode[]; links: DfgLink[] } | null>(null);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>('TB');
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(false);
  const [thicknessEnabled, setThicknessEnabled] = useState(true);
  const [thicknessMin, setThicknessMin] = useState(DEFAULT_THICKNESS_MIN);
  const [thicknessMax, setThicknessMax] = useState(DEFAULT_THICKNESS_MAX);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const reactFlow = useReactFlow();
  const { fitView } = reactFlow;
  const edgeTypes = useMemo(() => ({ ocdfg: OcdfgEdge }), []);
  const nodeTypes = useMemo(
    () => ({
      ocdfgStart: OcdfgTerminalNode,
      ocdfgEnd: OcdfgTerminalNode,
      ocdfgDefault: OcdfgDefaultNode,
    }),
    [],
  );

  const onNodesChange = useCallback((c) => setNodes((nds) => applyNodeChanges(c, nds)), []);
  const onEdgesChange = useCallback((c) => setEdges((eds) => applyEdgeChanges(c, eds)), []);

  const computeThicknessFactor = useCallback(
    (normalized?: number) => {
      if (!thicknessEnabled) {
        return 1;
      }
      const safeMin = Math.min(thicknessMin, thicknessMax);
      const safeMax = Math.max(thicknessMin, thicknessMax);
      const span = safeMax - safeMin;
      if (span <= 1e-6) {
        return safeMax;
      }
      const value = typeof normalized === 'number' && Number.isFinite(normalized) ? normalized : 0;
      const clamped = Math.min(1, Math.max(0, value));
      return safeMin + clamped * span;
    },
    [thicknessEnabled, thicknessMin, thicknessMax],
  );

  const applyThicknessToEdges = useCallback(
    (edgeList: Edge[]) =>
      edgeList.map((edge) => {
        const data = edge.data as { frequencyNormalized?: number } | undefined;
        const normalized = data?.frequencyNormalized;
        const factor = computeThicknessFactor(normalized);
        return {
          ...edge,
          data: {
            ...edge.data,
            thicknessFactor: factor,
          },
        };
      }),
    [computeThicknessFactor],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setEdges((prev) => applyThicknessToEdges(prev));
  }, [applyThicknessToEdges]);

  const handleSaveSettings = useCallback(() => {
    const presets = {
      layoutDirection,
      thicknessEnabled,
      thicknessMin,
      thicknessMax,
      interactionLocked,
    };
    localStorage.setItem('ocdfg-visualization-settings', JSON.stringify(presets));
    setSettingsSaved(true);
    window.setTimeout(() => setSettingsSaved(false), 1600);
  }, [interactionLocked, layoutDirection, thicknessEnabled, thicknessMin, thicknessMax]);

  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/ocdfg/')
      .then((response) => response.json())
      .then((data: DfgData) => {
        const { nodes: dfgNodes, links: dfgLinks } = data.dfg;
        setDfgData({ nodes: dfgNodes, links: dfgLinks });

        const allTypes = Array.from(
          new Set(dfgNodes.flatMap(node => node.types ?? [])),
        );
        const colors = mapTypesToColors(allTypes);
        setTypeColors(colors);
        const groupCounts: Record<string, number> = {};
        dfgLinks.forEach(link => {
          const key = `${link.source}->${link.target}`;
          groupCounts[key] = (groupCounts[key] ?? 0) + 1;
        });
        const groupIndex: Record<string, number> = {};
        const incomingCounts: Record<string, number> = {};
        const outgoingCounts: Record<string, number> = {};
        dfgLinks.forEach(link => {
          incomingCounts[link.target] = (incomingCounts[link.target] ?? 0) + 1;
          outgoingCounts[link.source] = (outgoingCounts[link.source] ?? 0) + 1;
        });

        const resolveLinkFrequency = (link: DfgLink) => {
          if (typeof link.weight === 'number' && Number.isFinite(link.weight)) {
            return Math.max(0, link.weight);
          }
          if (link.weights && typeof link.weights === 'object') {
            const total = Object.values(link.weights).reduce((sum: number, value) => {
              if (typeof value === 'number' && Number.isFinite(value)) {
                return sum + value;
              }
              return sum;
            }, 0);
            if (total > 0) {
              return total;
            }
          }
          if (Array.isArray(link.owners) && link.owners.length > 0) {
            return link.owners.length;
          }
          return 1;
        };

        const frequencies = dfgLinks.map(resolveLinkFrequency);
        const minFrequency = frequencies.length > 0 ? Math.min(...frequencies) : 1;
        const maxFrequency = frequencies.length > 0 ? Math.max(...frequencies) : minFrequency;
        const frequencySpan = Math.max(maxFrequency - minFrequency, 0);
        const normalizedValues = frequencies.map((frequency) => {
          if (!Number.isFinite(frequency) || frequencySpan < 1e-9) {
            return 0;
          }
          return (frequency - minFrequency) / frequencySpan;
        });
        const thicknessFactors = normalizedValues.map((normalized) => {
          const factor = DEFAULT_THICKNESS_MIN +
            Math.min(1, Math.max(0, normalized)) *
              (DEFAULT_THICKNESS_MAX - DEFAULT_THICKNESS_MIN);
          return Math.min(DEFAULT_THICKNESS_MAX, Math.max(DEFAULT_THICKNESS_MIN, factor));
        });

        const nodeVariantMap: Record<string, 'start' | 'end' | 'center' | undefined> = {};

        // Create standard React Flow nodes (no custom types)
        const initialNodes: Node[] = dfgNodes.map((node) => {
          const isStart = (incomingCounts[node.id] ?? 0) === 0;
          const isEnd = !isStart && (outgoingCounts[node.id] ?? 0) === 0;
          const fillColor = (node.types?.[0] && colors[node.types[0]]) || '#2563EB';
          const variant: 'start' | 'end' | 'center' = isStart ? 'start' : (isEnd ? 'end' : 'center');
          const cleanLabel = (node.label || node.id || '').trim();
          const approxLines = cleanLabel.length === 0
            ? 1
            : Math.max(1, Math.ceil(cleanLabel.length / 22));
          const baseHeight = Math.max(60, approxLines * 22);
          const minHeight = baseHeight + 0; // include vertical padding allowance
          const sharedData = {
            label: node.label || node.id,
            types: node.types ?? [],
            colors,
            fillColor,
            nodeVariant: variant,
            isStart,
          };
          const terminalLabel = (node.types && node.types.length > 0)
            ? node.types[0]
            : (cleanLabel.replace(/\s+(start|end)$/i, '').trim() || node.id);

          if (isStart) {
            nodeVariantMap[node.id] = 'start';
            return {
              id: node.id,
              type: 'ocdfgStart' as const,
              data: { ...sharedData, label: terminalLabel, sizePreset: 'terminal' },
              width: 80,
              height: 80,
              style: {
                width: 80,
                height: 80,
                padding: 0,
                border: 'none',
                boxShadow: 'none',
                background: 'transparent',
              },
              position: { x: 0, y: 0 }, // Position set by layout manager
            };
          }

          if (isEnd) {
            nodeVariantMap[node.id] = 'end';
            return {
              id: node.id,
              type: 'ocdfgEnd' as const,
              data: { ...sharedData, label: terminalLabel, sizePreset: 'terminal' },
              width: 80,
              height: 80,
              style: {
                width: 80,
                height: 80,
                padding: 0,
                border: 'none',
                boxShadow: 'none',
                background: 'transparent',
              },
              position: { x: 0, y: 0 },
            };
          }

          nodeVariantMap[node.id] = 'center';
          return {
            id: node.id,
            type: 'ocdfgDefault' as const,
            data: sharedData,
            position: { x: 0, y: 0 }, // Position will be set by the layout manager
            style: {
              background: '#FFFFFF',
              color: '#000000',
              border: '1px solid #000000',
              borderRadius: 12,
              padding: 14,
              minHeight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-primary, Inter, sans-serif)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              boxShadow: 'none',
              minWidth: 180,
            },
          };
        });

        initialNodes.forEach((node) => {
          const variant = (node.data as { nodeVariant?: 'start' | 'end' | 'center' } | undefined)?.nodeVariant;
          if (variant === 'start' || variant === 'end' || variant === 'center') {
            nodeVariantMap[node.id] = variant;
          }
        });

        const initialEdges: Edge[] = dfgLinks.map((link, index) => {
          const key = `${link.source}->${link.target}`;
          const currentIndex = groupIndex[key] ?? 0;
          groupIndex[key] = currentIndex + 1;
          return {
            id: `e${index}-${link.source}-${link.target}`,
            source: link.source,
            target: link.target,
            type: 'ocdfg',
            animated: true,
            data: {
              owners: link.owners ?? [],
              colors,
              parallelIndex: currentIndex,
              parallelCount: groupCounts[key],
              sourceVariant: nodeVariantMap[link.source],
              targetVariant: nodeVariantMap[link.target],
              frequency: frequencies[index],
              frequencyNormalized: normalizedValues[index],
              thicknessFactor: thicknessFactors[index],
            },
          } as Edge;
        });

        // Pass the elements to the layout manager to generate positions
        layoutOCDFG({
          renderNodes: initialNodes,
          renderEdges: initialEdges,
          dfgNodes,
          dfgLinks,
          mode: 'advanced',
          config: {
            direction: layoutDirection,
          },
        }).then(({ nodes, edges }) => {
          setNodes(nodes);
          setEdges(applyThicknessToEdges(edges));
          window.requestAnimationFrame(() => fitView());
        }).catch(console.error);
      })
      .catch(console.error);
  }, [fitView]);
  
  // The relayout button reuses the central layout manager
  const onLayout = useCallback(() => {
    if (!dfgData) return;
    layoutOCDFG({
      renderNodes: nodes,
      renderEdges: edges,
      dfgNodes: dfgData.nodes,
      dfgLinks: dfgData.links,
      mode: 'advanced',
      config: {
        direction: layoutDirection,
      },
    })
      .then(({ nodes, edges }) => {
        setNodes(nodes);
        setEdges(applyThicknessToEdges(edges));
        window.requestAnimationFrame(() => fitView());
      })
      .catch(console.error);
  }, [nodes, edges, fitView, dfgData, layoutDirection, applyThicknessToEdges]);

  useEffect(() => {
    if (!dfgData) return;
    if (nodes.length === 0 && edges.length === 0) return;
    onLayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutDirection]);

  return (
    <div style={{ height: resolveHeightValue(height), width: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.25}
        maxZoom={2.5}
        nodesDraggable={!interactionLocked}
        nodesConnectable={!interactionLocked}
        elementsSelectable={!interactionLocked}
        panOnDrag={!interactionLocked}
        panOnScroll={!interactionLocked}
        zoomOnPinch={!interactionLocked}
        zoomOnScroll={!interactionLocked}
      >
      </ReactFlow>

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
        {Object.keys(typeColors).length > 0 && (
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderRadius: 12,
              padding: '12px 16px',
              boxShadow: '0 6px 16px rgba(15, 23, 42, 0.05)',
              fontFamily: 'var(--font-primary, Inter, sans-serif)',
              maxHeight: '50vh',
              overflowY: 'auto',
              minWidth: 240,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: legendCollapsed ? 0 : 8,
                fontWeight: 600,
                fontSize: 14,
                color: '#0F172A',
              }}
            >
              <span>Object Types</span>
              <button
                type="button"
                onClick={() => setLegendCollapsed((prev) => !prev)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#64748B',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {legendCollapsed ? 'Show' : 'Hide'}
              </button>
            </div>
            {!legendCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(typeColors).map(([type, color]) => (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      aria-hidden
                      style={{
                        display: 'inline-block',
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: color,
                        border: '1px solid rgba(15, 23, 42, 0.12)',
                        boxShadow: '0 4px 8px rgba(15, 23, 42, 0.18)',
                      }}
                    />
                    <span style={{ fontSize: 13, color: '#475569', letterSpacing: '-0.01em' }}>{type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            padding: '12px 16px',
            boxShadow: '0 6px 16px rgba(15, 23, 42, 0.05)',
            fontFamily: 'var(--font-primary, Inter, sans-serif)',
            minWidth: 240,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: optionsCollapsed ? 0 : 12,
              fontWeight: 600,
              fontSize: 14,
              color: '#0F172A',
            }}
          >
            <span>Layout Options</span>
            <button
              type="button"
              onClick={() => setOptionsCollapsed((prev) => !prev)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#64748B',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {optionsCollapsed ? 'Show' : 'Hide'}
            </button>
          </div>
          {!optionsCollapsed && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: '#1E293B', fontWeight: 500 }}>Left-to-right layout</span>
                <Switch
                  checked={layoutDirection === 'LR'}
                  onCheckedChange={(checked) => setLayoutDirection(checked ? 'LR' : 'TB')}
                  aria-label="Toggle horizontal layout"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: '#1E293B', fontWeight: 500 }}>Variable edge thickness</span>
                <Switch
                  checked={thicknessEnabled}
                  onCheckedChange={setThicknessEnabled}
                  aria-label="Toggle variable edge thickness"
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  paddingLeft: 16,
                  marginBottom: 16,
                  opacity: thicknessEnabled ? 1 : 0.45,
                  pointerEvents: thicknessEnabled ? 'auto' : 'none',
                }}
              >
                <div style={{ fontSize: 12, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Minimum thickness</span>
                  <span>{thicknessMin.toFixed(2)}×</span>
                </div>
                <Slider
                  value={[thicknessMin]}
                  min={THICKNESS_MIN_LIMIT}
                  max={THICKNESS_MAX_LIMIT}
                  step={0.05}
                  onValueChange={(value) => {
                    const next = value?.[0];
                    if (typeof next !== 'number') return;
                    const clamped = Math.min(
                      Math.max(next, THICKNESS_MIN_LIMIT),
                      Math.min(thicknessMax, THICKNESS_MAX_LIMIT),
                    );
                    setThicknessMin(parseFloat(clamped.toFixed(2)));
                  }}
                  disabled={!thicknessEnabled}
                />
                <div style={{ fontSize: 12, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Maximum thickness</span>
                  <span>{thicknessMax.toFixed(2)}×</span>
                </div>
                <Slider
                  value={[thicknessMax]}
                  min={THICKNESS_MIN_LIMIT}
                  max={THICKNESS_MAX_LIMIT}
                  step={0.05}
                  onValueChange={(value) => {
                    const next = value?.[0];
                    if (typeof next !== 'number') return;
                    const clamped = Math.max(
                      Math.min(next, THICKNESS_MAX_LIMIT),
                      Math.max(thicknessMin, THICKNESS_MIN_LIMIT),
                    );
                    setThicknessMax(parseFloat(clamped.toFixed(2)));
                  }}
                  disabled={!thicknessEnabled}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={onLayout} className="w-full justify-center">
                Relayout
              </Button>
            </>
          )}
        </div>

        <div
          style={{
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
            onClick={() => fitView()}
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
          <Button
            type="button"
            onClick={handleSaveSettings}
            variant={settingsSaved ? 'secondary' : 'default'}
            className="rounded-full h-9 px-4 flex items-center gap-2"
          >
            <SaveIcon className="h-4 w-4" />
            <span className="text-sm font-medium">{settingsSaved ? 'Saved' : 'Save'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default OCDFGVisualizer;
