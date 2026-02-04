import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
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
  layoutOCDFGLongestTrace,
  type DfgNode,
  type DfgLink,
} from '../utils/GraphLayouter';
import type { TraceVariantsPerType } from './OCDFGVisualizer';
import { mapTypesToColors } from '../utils/objectColors';
import OcdfgEdge from './OcdfgEdge';
import OcdfgTerminalNode from './OcdfgTerminalNode';
import OcdfgDefaultNode from './OcdfgDefaultNode';
import OcdfgDebugLayerNode from './OcdfgDebugLayerNode';
import { BufferZoneDebug } from './BufferZoneDebug';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { PlusIcon, MinusIcon, ScanIcon, LockIcon, UnlockIcon, ShieldIcon, BugIcon, ZapIcon, Sun } from 'lucide-react';

const DEFAULT_THICKNESS_MIN = 0.5;
const DEFAULT_THICKNESS_MAX = 2;

// Define specific types for the data we expect from the backend
interface DfgData {
  dfg: {
    nodes: DfgNode[];
    links: DfgLink[];
    trace_variants?: TraceVariantsPerType;
  };
  trace_variants?: TraceVariantsPerType;
}

interface OCDFGLongestTraceVisualizerProps {
  height?: string | number;
}

function resolveHeightValue(height: string | number) {
  return typeof height === 'number' ? `${height}px` : height;
}

function OCDFGLongestTraceVisualizer({ height = 'calc(100vh - 50px)' }: OCDFGLongestTraceVisualizerProps) {
  console.log('[OCDFGLongestTraceVisualizer] Component mounted!');

  const layoutKey = useId();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [typeColors, setTypeColors] = useState<Record<string, string>>({});
  const [typeVisibility, setTypeVisibility] = useState<Record<string, boolean>>({});
  const [typeAvailability, setTypeAvailability] = useState<Record<string, boolean>>({});
  const [typeTraceLimit, setTypeTraceLimit] = useState<Record<string, number>>({});
  const [typeTraceMax, setTypeTraceMax] = useState<Record<string, number>>({});
  const [typeArcOrder, setTypeArcOrder] = useState<Record<string, string[]>>({});
  const [baseNodes, setBaseNodes] = useState<Node[]>([]);
  const [baseEdges, setBaseEdges] = useState<Edge[]>([]);
  const [dfgData, setDfgData] = useState<{ nodes: DfgNode[]; links: DfgLink[]; trace_variants?: TraceVariantsPerType } | null>(null);
  const [rawNodes, setRawNodes] = useState<Node[]>([]);
  const [rawEdges, setRawEdges] = useState<Edge[]>([]);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(true);
  const [showDebugOverlays, setShowDebugOverlays] = useState(false);
  const [showBufferZones, setShowBufferZones] = useState(false);
  const [animateEdges, setAnimateEdges] = useState(false);
  const [dimTerminalEdges, setDimTerminalEdges] = useState(false);
  const layoutActiveTypesRef = useRef<string[] | null>(null);
  const initialAvailabilityRef = useRef<Record<string, boolean> | null>(null);
  const layoutTraceLimitRef = useRef<string | null>(null);
  const typeTraceLimitCacheRef = useRef<Record<string, number>>({});
  const reactFlow = useReactFlow();
  const { fitView } = reactFlow;
  const edgeTypes = useMemo(() => ({ ocdfg: OcdfgEdge as any }), []);
  const nodeTypes = useMemo(
    () => ({
      ocdfgStart: OcdfgTerminalNode as any,
      ocdfgEnd: OcdfgTerminalNode as any,
      ocdfgDefault: OcdfgDefaultNode as any,
      debugLayer: OcdfgDebugLayerNode as any,
    }),
    [],
  );

  const onNodesChange = useCallback((c: any) => setNodes((nds) => applyNodeChanges(c, nds)), []);
  const onEdgesChange = useCallback((c: any) => setEdges((eds) => applyEdgeChanges(c, eds)), []);

  const shallowBoolRecordEqual = (a: Record<string, boolean>, b: Record<string, boolean>) => {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => Boolean(a[k]) === Boolean(b[k]));
  };

  const resolveOwnerTypes = (entry?: { owners?: string[]; ownerTypes?: string[] }) => {
    const values = entry?.ownerTypes && entry.ownerTypes.length > 0
      ? entry.ownerTypes
      : entry?.owners ?? [];
    return values.filter((t): t is string => typeof t === 'string' && t.length > 0);
  };

  const resolveOwnerPairs = (entry?: { owners?: string[]; ownerTypes?: string[] }) => {
    const owners = entry?.owners ?? [];
    const ownerTypes = entry?.ownerTypes ?? [];
    if (owners.length > 0 && ownerTypes.length === owners.length) {
      return owners
        .map((owner, index) => ({ owner, type: ownerTypes[index] }))
        .filter(
          (pair): pair is { owner: string; type: string } =>
            typeof pair.owner === 'string'
            && pair.owner.length > 0
            && typeof pair.type === 'string'
            && pair.type.length > 0,
        );
    }
    return resolveOwnerTypes(entry).map(type => ({ owner: type, type }));
  };

  function computeTypeAvailability(layoutNodes: Node[], layoutEdges: Edge[], allTypes: string[]) {
    const presence = Object.fromEntries(allTypes.map(t => [t, false])) as Record<string, boolean>;
    const visibleNodeIds = new Set(
      layoutNodes.filter(n => n.hidden !== true).map(n => n.id),
    );

    layoutEdges.forEach((edge) => {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
        return;
      }
      const ownerTypes = resolveOwnerTypes(
        edge.data as { owners?: string[]; ownerTypes?: string[] } | undefined,
      );
      ownerTypes.forEach((t) => {
        if (t in presence) {
          presence[t] = true;
        }
      });
    });

    return presence;
  }

  const stripDebugNodes = useCallback((nodeList: Node[]) => {
    return nodeList.filter((node) => {
      const id = typeof node.id === 'string' ? node.id : '';
      const type = typeof node.type === 'string' ? node.type : '';
      const data = (node.data as { isBuffer?: boolean; isDummy?: boolean } | undefined) ?? {};
      if (id.startsWith('debug-')) return false;
      if (type.startsWith('debug')) return false;
      if (data.isBuffer || data.isDummy) return false;
      return true;
    });
  }, []);

  const LEGEND_WIDTH = 300;
  const LEGEND_MARGIN = 24;
  const LEGEND_BUFFER = 120;
  const LEGEND_TOTAL = LEGEND_WIDTH + LEGEND_MARGIN * 2 + LEGEND_BUFFER;

  const addLegendSpacer = useCallback((nodesIn: Node[]): Node[] => {
    if (Object.keys(typeColors).length === 0) return nodesIn;
    if (nodesIn.some(n => n.id === 'legend-spacer')) return nodesIn;
    const baseY = nodesIn.length > 0
      ? Math.min(...nodesIn.map(n => n.position?.y ?? 0)) - 40
      : -40;
    const spacer: Node = {
      id: 'legend-spacer',
      position: { x: -LEGEND_TOTAL, y: baseY },
      width: LEGEND_TOTAL,
      height: 10,
      data: {},
      selectable: false,
      draggable: false,
      type: 'ocdfgDefault',
      style: {
        opacity: 0,
        pointerEvents: 'none',
      },
    };
    return [...nodesIn, spacer];
  }, [typeColors, LEGEND_TOTAL]);

  const shiftForLegend = useCallback(
    (nodesIn: Node[], edgesIn: Edge[]) => {
      // Legend is always on the left for this visualizer; shift graph to the right of it.
      if (Object.keys(typeColors).length === 0) {
        return { nodes: nodesIn, edges: edgesIn };
      }
      // Apply a fixed positive shift so the graph always starts to the right of the legend.
      const shift = LEGEND_TOTAL + 16;

      const shiftedNodes = nodesIn.map(n => n.position
        ? { ...n, position: { ...n.position, x: n.position.x + shift } }
        : n);
      const shiftedEdges = edgesIn.map(e => {
        const data = e.data as { polyline?: Array<{ x?: number; y?: number }> } | undefined;
        const polyline = Array.isArray(data?.polyline)
          ? data!.polyline.map(p => ({ ...p, x: (p?.x ?? 0) + shift }))
          : undefined;
        return polyline
          ? { ...e, data: { ...(e.data ?? {}), polyline } }
          : e;
      });
      return { nodes: shiftedNodes, edges: shiftedEdges };
    },
    [typeColors],
  );

  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/ocdfg/')
      .then((response) => response.json())
      .then((data: DfgData) => {
        const { nodes: dfgNodes, links: dfgLinks } = data.dfg;
        // Accept trace variants from either the dfg payload or top-level.
        const traceVariants = data.dfg?.trace_variants ?? data.trace_variants;
        setDfgData({ nodes: dfgNodes, links: dfgLinks, trace_variants: traceVariants });

        const allTypes = Array.from(
          new Set(dfgNodes.flatMap(node => node.types ?? [])),
        );
        const colors = mapTypesToColors(allTypes);
        setTypeColors(colors);
        const initialAvailability = Object.fromEntries(allTypes.map(type => [type, true]));
        setTypeAvailability(initialAvailability);
        const initialVisibility = Object.fromEntries(allTypes.map(type => [type, true]));
        setTypeVisibility(initialVisibility);
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
          const minHeight = baseHeight + 0;
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
              position: { x: 0, y: 0 },
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
            position: { x: 0, y: 0 },
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
              ownerTypes: link.ownerTypes ?? [],
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

        setRawNodes(initialNodes);
        setRawEdges(initialEdges);
        layoutActiveTypesRef.current = null;
        initialAvailabilityRef.current = null;
        layoutTraceLimitRef.current = null;
      })
      .catch(console.error);
  }, [fitView]);

  useEffect(() => {
    if (!dfgData) return;
    if (rawNodes.length === 0 || rawEdges.length === 0) return;

    const activeTypes = Object.entries(typeVisibility)
      .filter(([, visible]) => visible !== false)
      .map(([type]) => type)
      .sort();

    const requestedTypes = activeTypes;
    const traceLimitKey = JSON.stringify(typeTraceLimit);

    layoutActiveTypesRef.current = activeTypes;
    layoutTraceLimitRef.current = traceLimitKey;

    if (activeTypes.length === 0) {
      setBaseNodes([]);
      setBaseEdges([]);
      return;
    }

      layoutOCDFGLongestTrace({
        renderNodes: rawNodes,
        renderEdges: rawEdges,
        dfgNodes: dfgData.nodes,
        dfgLinks: dfgData.links,
        backendTraceVariants: dfgData.trace_variants,
        typeTraceLimit,
        activeTypes,
        layoutKey,
      includeDebugOverlays: showDebugOverlays,
    }).then(({ nodes: layoutedNodes, edges: layoutedEdges }) => {
      const shifted = shiftForLegend(layoutedNodes, layoutedEdges);
      const spacedNodes = addLegendSpacer(shifted.nodes);
      setBaseNodes(spacedNodes);
      setBaseEdges(shifted.edges);
      if (layoutedNodes.length > 0) {
        const availability = computeTypeAvailability(
          layoutedNodes,
          layoutedEdges,
          Object.keys(typeColors),
        );
        if (!initialAvailabilityRef.current) {
          initialAvailabilityRef.current = availability;
        }
        const mergedAvailability = initialAvailabilityRef.current
          ? Object.fromEntries(
              Object.keys(availability).map((type) => [
                type,
                availability[type] || initialAvailabilityRef.current?.[type] === true,
              ]),
            )
          : availability;
        initialAvailabilityRef.current = mergedAvailability;
        setTypeAvailability(prev => shallowBoolRecordEqual(prev, mergedAvailability) ? prev : mergedAvailability);
      }
      window.requestAnimationFrame(() => fitView({
        padding: { top: 50, right: 50, bottom: 50, left: 50 },
        offset: { x: LEGEND_TOTAL, y: 0 },
        duration: 200
      }));
    }).catch(console.error);
  }, [typeVisibility, typeTraceLimit, rawNodes, rawEdges, dfgData, typeColors, fitView, layoutKey, showDebugOverlays, shiftForLegend]);

  useEffect(() => {
    if (baseNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const nodesForVisibility = showDebugOverlays ? baseNodes : stripDebugNodes(baseNodes);

    const availability = computeTypeAvailability(nodesForVisibility, baseEdges, Object.keys(typeColors));
    if (!initialAvailabilityRef.current) {
      initialAvailabilityRef.current = availability;
    }
    const mergedAvailability = initialAvailabilityRef.current
      ? Object.fromEntries(
          Object.keys(availability).map((type) => [
            type,
            availability[type] || initialAvailabilityRef.current?.[type] === true,
          ]),
        )
      : availability;
    initialAvailabilityRef.current = mergedAvailability;
    setTypeAvailability(prev => shallowBoolRecordEqual(prev, mergedAvailability) ? prev : mergedAvailability);

    // Build allowed edges per type by arc frequency ordering
    const allowedEdgeIds = new Set<string>();
    if (Object.keys(typeArcOrder).length === 0) {
      baseEdges.forEach(edge => allowedEdgeIds.add(edge.id));
    } else {
      Object.entries(typeArcOrder).forEach(([type, ids]) => {
        const max = ids.length;
        const limit = Math.min(Math.max(0, typeTraceLimit[type] ?? max), max);
        ids.slice(0, limit).forEach(id => allowedEdgeIds.add(id));
      });
    }

    const resolvedNodes = nodesForVisibility.map((node) => {
      const nodeTypes = (node.data as { types?: string[] } | undefined)?.types ?? [];
      const baseHidden = node.hidden === true;
      const hasVisibleType = nodeTypes.length === 0
        ? true
        : nodeTypes.some((t) => typeVisibility[t] !== false);

      if (!baseHidden && hasVisibleType) {
        return { ...node, hidden: false };
      }
      return { ...node, hidden: true };
    });

    const visibleNodeIds = new Set(resolvedNodes.filter(n => !n.hidden).map(n => n.id));
    const filteredEdges = baseEdges.filter(edge => {
      const ownerTypes = resolveOwnerTypes(
        edge.data as { owners?: string[]; ownerTypes?: string[] } | undefined,
      );
      const blockedByType = ownerTypes.some(t => typeVisibility[t] === false);
      if (blockedByType) return false;
      const nodesVisible = visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
      if (!nodesVisible) return false;

      // Arc-based filtering: keep edge if no ownerTypes OR any owner type keeps it.
      if (ownerTypes.length === 0) return true;
      return allowedEdgeIds.has(edge.id);
    }).map(edge => ({
      ...edge,
      animated: animateEdges,
      data: {
        ...(edge.data ?? {}),
        overlayDebug: showDebugOverlays
          ? (edge.data as Record<string, unknown>)?.overlayDebug ?? false
          : false,
        dimmed:
          dimTerminalEdges
          && (
            (edge.data as { sourceVariant?: string } | undefined)?.sourceVariant === 'start'
            || (edge.data as { sourceVariant?: string } | undefined)?.sourceVariant === 'end'
            || (edge.data as { targetVariant?: string } | undefined)?.targetVariant === 'start'
            || (edge.data as { targetVariant?: string } | undefined)?.targetVariant === 'end'
          ),
      },
    }));

    setNodes(resolvedNodes);
    setEdges(filteredEdges);
  }, [baseNodes, baseEdges, typeVisibility, typeColors, typeArcOrder, typeTraceLimit, showDebugOverlays, animateEdges, dimTerminalEdges, stripDebugNodes]);

  useEffect(() => {
    if (!typeAvailability) return;
    setTypeVisibility(prev => {
      const next: Record<string, boolean> = { ...prev };
      let changed = false;
      Object.entries(typeAvailability).forEach(([t, available]) => {
        if (available === false) {
          if (next[t] !== false) {
            next[t] = false;
            changed = true;
          }
        } else if (available === true && next[t] === undefined) {
          next[t] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [typeAvailability]);

  const handleTypeToggle = (type: string, checked: boolean) => {
    if (typeAvailability[type] !== true && checked) {
      return;
    }

    const max = typeTraceMax[type] ?? 0;
    const currentLimit = typeTraceLimit[type] ?? max;

    if (!checked) {
      typeTraceLimitCacheRef.current[type] = currentLimit;
      setTypeTraceLimit(prev => ({ ...prev, [type]: 0 }));
      setTypeVisibility(prev => ({ ...prev, [type]: false }));
      return;
    }

    const cached = typeTraceLimitCacheRef.current[type];
    const restoredBase = cached ?? currentLimit ?? max;
    const restored = Math.min(Math.max(0, restoredBase), max);
    setTypeVisibility(prev => ({ ...prev, [type]: true }));
    setTypeTraceLimit(prev => ({ ...prev, [type]: restored }));
  };

  const handleTraceLimitChange = (type: string, value: number) => {
    const max = typeTraceMax[type] ?? 0;
    const desired = Math.min(Math.max(0, Math.round(value)), max);
    const prevLimit = typeTraceLimit[type] ?? max;
    // Enforce single-step change per slider event to drop exactly one arc per move.
    const next = desired === prevLimit
      ? prevLimit
      : (desired > prevLimit ? prevLimit + 1 : prevLimit - 1);

    if (next === 0) {
      typeTraceLimitCacheRef.current[type] = prevLimit;
      setTypeVisibility(prev => (prev[type] === false ? prev : { ...prev, [type]: false }));
    }

    if (next > 0) {
      setTypeVisibility(prev => ({ ...prev, [type]: true }));
    }

    setTypeTraceLimit(prev => ({ ...prev, [type]: next }));
  };

  useEffect(() => {
    if (Object.keys(typeTraceMax).length === 0) return;
    setTypeTraceLimit((prev) => {
      const next: Record<string, number> = { ...prev };
      let changed = false;
      Object.entries(typeTraceMax).forEach(([type, max]) => {
        const current = prev[type];
        const desired = current === undefined ? max : Math.min(Math.max(0, current), max);
        if (desired !== current) {
          next[type] = desired;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [typeTraceMax]);

  useEffect(() => {
    if (Object.keys(typeArcOrder).length === 0) return;
    const arcCounts = Object.fromEntries(
      Object.entries(typeArcOrder).map(([type, ids]) => [type, ids.length]),
    );
    setTypeTraceMax(arcCounts);
    setTypeTraceLimit((prev) => {
      const next: Record<string, number> = { ...prev };
      let changed = false;
      Object.entries(arcCounts).forEach(([type, max]) => {
        const current = prev[type];
        const desired = current === undefined ? max : Math.min(Math.max(0, current), max);
        if (desired !== current) {
          next[type] = desired;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [typeArcOrder]);

  // Recompute arc order from layouted edges to ensure IDs align with rendered edges.
  useEffect(() => {
    if (baseEdges.length === 0) return;
    const edgesByType: Record<string, Edge[]> = {};
    baseEdges.forEach((edge) => {
      const owners = resolveOwnerTypes(edge.data as { owners?: string[]; ownerTypes?: string[] } | undefined);
      owners.forEach((type) => {
        if (!edgesByType[type]) edgesByType[type] = [];
        edgesByType[type].push(edge);
      });
    });
    const arcOrder: Record<string, string[]> = {};
    Object.entries(edgesByType).forEach(([type, edges]) => {
      const sorted = edges.slice().sort((a, b) => {
        const fa = Number((a.data as { frequency?: number } | undefined)?.frequency) || 0;
        const fb = Number((b.data as { frequency?: number } | undefined)?.frequency) || 0;
        if (fb !== fa) return fb - fa;
        return String(a.id).localeCompare(String(b.id));
      });
      arcOrder[type] = sorted.map(e => String(e.id));
    });
    setTypeArcOrder(arcOrder);
  }, [baseEdges]);

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
        <BufferZoneDebug enabled={showDebugOverlays && showBufferZones} />
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
              <span>Longest Trace View</span>
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
                {Object.entries(typeColors).map(([type, color]) => {
                  const max = typeTraceMax[type] ?? 0;
                  const resolvedLimit = typeTraceLimit[type] ?? max;
                  const clampedLimit = Math.min(Math.max(0, resolvedLimit), max);
                  const isVisible = typeVisibility[type] !== false;
                  const sliderDisabled = typeAvailability[type] !== true || max <= 0;
                  const sliderValue = clampedLimit;

                  return (
                    <div
                      key={type}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        paddingBottom: 6,
                        borderBottom: '1px solid #E2E8F0',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                        <Switch
                          checked={typeVisibility[type] !== false}
                          disabled={typeAvailability[type] !== true}
                          onCheckedChange={(checked) => handleTypeToggle(type, checked)}
                        />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          opacity: typeAvailability[type] ? (isVisible ? 1 : 0.7) : 0.5,
                        }}
                      >
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Slider
                            min={0}
                            max={max}
                            step={1}
                            value={[sliderValue]}
                            onValueChange={(values) => handleTraceLimitChange(type, values?.[0] ?? 0)}
                            disabled={sliderDisabled}
                          />
                          <span style={{ fontSize: 12, color: '#475569', minWidth: 90, textAlign: 'right' }}>
                            {sliderValue}/{max} Arcs
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

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
            variant={showDebugOverlays ? 'secondary' : 'outline'}
            size="icon"
            onClick={() => setShowDebugOverlays((prev) => !prev)}
            className="rounded-full h-9 w-9"
            title={showDebugOverlays ? 'Hide debug overlays' : 'Show debug overlays'}
          >
            <BugIcon className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={showBufferZones ? 'secondary' : 'outline'}
            size="icon"
            onClick={() => setShowBufferZones((prev) => !prev)}
            className="rounded-full h-9 w-9"
            title={showBufferZones ? 'Hide buffer zones' : 'Show buffer zones (debug)'}
            disabled={!showDebugOverlays}
          >
            <ShieldIcon className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={animateEdges ? 'secondary' : 'outline'}
            size="icon"
            onClick={() => setAnimateEdges((prev) => !prev)}
            className="rounded-full h-9 w-9"
            title={animateEdges ? 'Disable edge animation' : 'Enable edge animation'}
          >
            <ZapIcon className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={dimTerminalEdges ? 'secondary' : 'outline'}
            size="icon"
            onClick={() => setDimTerminalEdges((prev) => !prev)}
            className="rounded-full h-9 w-9"
            title={dimTerminalEdges ? 'Undim terminal edges' : 'Dim edges touching start/end'}
          >
            <Sun className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default OCDFGLongestTraceVisualizer;
