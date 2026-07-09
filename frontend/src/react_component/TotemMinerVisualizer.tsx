/**
 * TOTeM Miner Visualizer
 *
 * Renders the TOTeM temporal graph as a hierarchical graph matching the thesis paper:
 *  - Layered (Sugiyama-style) top-to-bottom layout based on D-relation direction
 *  - Each object type is a coloured rounded-rectangle node (auto-width)
 *  - Arcs styled by relation type (black=D, red=P, blue=I, dashed=I)
 *  - Source label (e.g. "1,*" or "1") near arc origin
 *  - Oval EC|LC cardinality bubble at arc midpoint
 *  - Filled square terminator at arc source endpoint
 *  - Pan & zoom via SVG transform
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from '@/components/ui/card';
import { RefreshCcw, ZoomIn, ZoomOut, Maximize2, Lock, Unlock } from 'lucide-react';
import { mapTypesToColors, textColorForBackground } from '../utils/objectColors';

// ─── Types ───────────────────────────────────────────────────────────────────

type TotemCardinality = {
  from: string;
  to: string;
  log_cardinality: string | null;
  event_cardinality: string | null;
};

type TotemApiResponse = {
  tempgraph: {
    nodes?: string[];
    [relation: string]: string[] | string[][];
  };
  cardinalities?: TotemCardinality[];
  type_relations?: Array<string[]>;
  all_event_types?: string[];
  object_type_to_event_types?: Record<string, string[]>;
};

type RelationType = 'D' | 'P' | 'I' | 'A' | 'Di' | string;

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  relation: RelationType;
  sourceLabel: string;   // near-source label e.g. "1"
  targetLabel: string;   // near-target label e.g. "1..*"
  bubbleLabel: string;   // midpoint oval e.g. "0|1"
};

type LayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  textColor: string;
};

export type TotemMinerVisualizerControls = {
  processAreaScale: number;
  onProcessAreaScaleChange: (v: number) => void;
  autoZoomEnabled: boolean;
  onAutoZoomToggle: () => void;
  minScale: number;
  maxScale: number;
  scaleStep: number;
};

/** @deprecated use TotemMinerVisualizerControls */
export type TotemVisualizerControls = TotemMinerVisualizerControls;

type TotemMinerVisualizerProps = {
  eventLogId?: number | string | null;
  height?: string | number;
  backendBaseUrl?: string;
  reloadSignal?: number;
  title?: string;
  topInset?: number;
  embedded?: boolean;
  onControlsReady?: (controls: TotemMinerVisualizerControls) => void;
  tau?: number;
  fitness?: number | null;
  precision?: number | null;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BACKEND = 'http://localhost:8000';

const RELATION_COLOR: Record<string, string> = {
  D: '#0f172a',
  Di: '#0f172a',
  P: '#dc2626',
  I: '#2563eb',
  A: '#64748b',
};

const NODE_H = 36;
const NODE_PADDING_X = 16;
const NODE_R = 6;
const OVAL_RX = 20;
const OVAL_RY = 10;
const SQUARE_SIZE = 7;
const FONT_SIZE_NODE = 12;
const FONT_SIZE_LABEL = 10;
const FONT_SIZE_BUBBLE = 9.5;
const NODE_FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, sans-serif';

// Approximate char width at given font size (used for auto-sizing nodes)
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62;
}

function nodeWidth(label: string): number {
  return Math.max(80, estimateTextWidth(label, FONT_SIZE_NODE) + NODE_PADDING_X * 2);
}

// ─── Cardinality helpers ──────────────────────────────────────────────────────

/** "1..n" → "1,*" | "1..1" → "1" | "0..1" → "0..1" */
function formatCardinality(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.trim();
  if (s === '1..1' || s === '1') return '1';
  if (s === '1..n' || s === '1..*' || s === '1..N' || s === '1,n' || s === '1,*') return '1..*';
  if (s === '0..n' || s === '0..*' || s === '0..N' || s === '0,n' || s === '0,*') return '0..*';
  if (s === '0..1' || s === '0,1') return '0..1';
  return s.replace(/,[nN*]/, '..*').replace(/\.\.[nN]/, '..*');
}

/** Build compact "EC|LC" label from raw cardinality strings */
function makeBubbleLabel(ec: string | null | undefined, lc: string | null | undefined): string {
  const side = (v: string | null | undefined) => {
    if (!v) return '0';
    const s = v.trim();
    return s.startsWith('0') ? '0' : '1';
  };
  return `${side(ec)}|${side(lc)}`;
}

// ─── Extract edges from tempgraph ────────────────────────────────────────────

function extractEdges(
  tempgraph: TotemApiResponse['tempgraph'],
  cardinalities: TotemCardinality[],
): GraphEdge[] {
  const cardMap = new Map<string, TotemCardinality>();
  cardinalities.forEach((c) => cardMap.set(`${c.from}→${c.to}`, c));

  const edges: GraphEdge[] = [];
  const RELATION_KEYS = ['D', 'Di', 'P', 'I', 'A'];

  for (const key of RELATION_KEYS) {
    const list = tempgraph[key];
    if (!Array.isArray(list)) continue;
    (list as string[][]).forEach((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return;
      const [from, to] = pair;
      const card = cardMap.get(`${from}→${to}`);
      edges.push({
        id: `${key}::${from}→${to}`,
        from,
        to,
        relation: key,
        sourceLabel: '1',
        targetLabel: formatCardinality(card?.log_cardinality),
        bubbleLabel: makeBubbleLabel(card?.event_cardinality, card?.log_cardinality),
      });
    });
  }
  return edges;
}

// ─── Hierarchical layout (Sugiyama-style) ────────────────────────────────────

/**
 * Assigns each node to a layer based on the longest path from a source node
 * in the Dependent (D) edges subgraph. Nodes with no incoming D-edges are at
 * layer 0 (top). Lays out nodes within each layer evenly spaced.
 */
function computeHierarchicalLayout(
  nodeIds: string[],
  edges: GraphEdge[],
  width: number,
  height: number,
  nodeWidths: Map<string, number>,
): Map<string, { x: number; y: number }> {
  if (nodeIds.length === 0) return new Map();

  // Use D edges for hierarchy; fall back to all edges if none exist
  const dirEdges = edges.filter((e) => e.relation === 'D' || e.relation === 'Di');
  const hierarchyEdges = dirEdges.length > 0 ? dirEdges : edges;

  // Build adjacency + in-degree
  const adj = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));

  for (const e of hierarchyEdges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  // BFS: longest-path layer assignment
  const layer = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  const rem = new Map(inDegree);
  const enqueued = new Set(queue);

  while (queue.length > 0) {
    const node = queue.shift()!;
    const cur = layer.get(node) ?? 0;
    for (const nb of adj.get(node) ?? []) {
      const proposed = cur + 1;
      if (proposed > (layer.get(nb) ?? 0)) layer.set(nb, proposed);
      const r = (rem.get(nb) ?? 1) - 1;
      rem.set(nb, r);
      if (r <= 0 && !enqueued.has(nb)) {
        enqueued.add(nb);
        queue.push(nb);
      }
    }
  }
  // Any node not yet enqueued gets layer 0
  for (const id of nodeIds) if (!enqueued.has(id)) layer.set(id, 0);

  // Group nodes by layer
  const byLayer = new Map<number, string[]>();
  for (const id of nodeIds) {
    const l = layer.get(id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(id);
  }
  // Sort each layer for stable ordering
  for (const nodes of byLayer.values()) nodes.sort();

  const LAYER_GAP = 110;
  const numLayers = Math.max(...Array.from(layer.values())) + 1;

  const PADDING_Y = 50;
  const layerY = (l: number) => PADDING_Y + (numLayers - 1 - l) * LAYER_GAP;

  const positions = new Map<string, { x: number; y: number }>();
  const NODE_GAP = 60;

  for (const [l, nodes] of byLayer) {
    const y = layerY(l);
    // Total width needed for this layer
    const totalNodeW = nodes.reduce((s, id) => s + (nodeWidths.get(id) ?? 80), 0);
    const layerW = totalNodeW + (nodes.length - 1) * NODE_GAP;
    
    // Center the layer horizontally around width / 2
    let curX = (width / 2) - (layerW / 2);
    
    for (const id of nodes) {
      const w = nodeWidths.get(id) ?? 80;
      positions.set(id, { x: curX + w / 2, y });
      curX += w + NODE_GAP;
    }
  }

  return positions;
}

// ─── Arc / geometry helpers ──────────────────────────────────────────────────

/** Point where the line from (cx,cy)→(tx,ty) exits a rectangle centred at (cx,cy). */
function clipToBorder(
  cx: number, cy: number,
  tx: number, ty: number,
  hw: number, hh: number,
): { x: number; y: number } {
  const dx = tx - cx, dy = ty - cy;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return { x: cx, y: cy };
  const sx = hw / Math.abs(dx || 1e-9);
  const sy = hh / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Arrowhead polygon at (tx,ty) pointing from (sx,sy)→(tx,ty). */
function arrowPath(sx: number, sy: number, tx: number, ty: number, size = 9): string {
  const dx = tx - sx, dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const ax = tx - ux * size, ay = ty - uy * size;
  return `M ${tx} ${ty} L ${ax + px * size * 0.42} ${ay + py * size * 0.42} L ${ax - px * size * 0.42} ${ay - py * size * 0.42} Z`;
}

/** A quadratic bezier SVG path string with control point offset perpendicularly. */
function bezierPath(
  x1: number, y1: number,
  x2: number, y2: number,
  curvature = 0,
): string {
  if (Math.abs(curvature) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const cx = mx - (dy / len) * curvature;
  const cy = my + (dx / len) * curvature;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

/** Point along a quadratic bezier at arbitrary t (0 to 1) */
function bezierPoint(
  x1: number, y1: number,
  x2: number, y2: number,
  curvature = 0,
  t = 0.5,
): { x: number; y: number } {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  if (Math.abs(curvature) < 0.5) {
    return {
      x: x1 + (x2 - x1) * t,
      y: y1 + (y2 - y1) * t,
    };
  }
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const cpx = mx - (dy / len) * curvature;
  const cpy = my + (dx / len) * curvature;
  const u = 1 - t;
  return {
    x: u * u * x1 + 2 * u * t * cpx + t * t * x2,
    y: u * u * y1 + 2 * u * t * cpy + t * t * y2,
  };
}
function bezierMid(
  x1: number, y1: number,
  x2: number, y2: number,
  curvature = 0,
): { x: number; y: number } {
  return bezierPoint(x1, y1, x2, y2, curvature, 0.5);
}

/** Direction vector along quadratic bezier at t=0 (tangent at start). */
function bezierStartTangent(
  x1: number, y1: number,
  x2: number, y2: number,
  curvature = 0,
): { dx: number; dy: number } {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const edx = x2 - x1, edy = y2 - y1;
  const len = Math.sqrt(edx * edx + edy * edy) || 1;
  const cpx = mx - (edy / len) * curvature;
  const cpy = my + (edx / len) * curvature;
  return { dx: cpx - x1, dy: cpy - y1 };
}

// ─── Main Component ──────────────────────────────────────────────────────────

function TotemMinerVisualizer({
  eventLogId,
  height = '100%',
  backendBaseUrl = DEFAULT_BACKEND,
  reloadSignal,
  embedded = false,
  onControlsReady,
  tau = 0.5,
  fitness = null,
  precision = null,
}: TotemMinerVisualizerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawData, setRawData] = useState<TotemApiResponse | null>(null);

  // Pan & zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panLocked, setPanLocked] = useState(false);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ width: 800, height: 600 });

  const effectiveReloadSignal = reloadSignal ?? 0;

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!eventLogId) { setRawData(null); return; }
    setLoading(true);
    setError(null);
    try {
      const tauParam = Math.max(0, Math.min(1, tau)).toFixed(3);
      const { data } = await axios.get<TotemApiResponse>(
        `${backendBaseUrl}/api/files/${eventLogId}/discover_totem/?tau=${tauParam}`,
      );
      setRawData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load TOTeM data');
      setRawData(null);
    } finally {
      setLoading(false);
    }
  }, [backendBaseUrl, eventLogId, tau]);

  useEffect(() => { fetchData(); }, [fetchData, effectiveReloadSignal]);

  // ── Container size ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() =>
      setSvgSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    obs.observe(el);
    setSvgSize({ width: el.clientWidth, height: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  // ── Build graph data ─────────────────────────────────────────────────────────
  const { nodeIds, edges, colorMap } = useMemo(() => {
    if (!rawData?.tempgraph) return { nodeIds: [], edges: [], colorMap: {} };
    const nodeIds = (rawData.tempgraph.nodes as string[]) ?? [];
    const edges = extractEdges(rawData.tempgraph, rawData.cardinalities ?? []);
    const colorMap = mapTypesToColors(nodeIds, {
      'Forklift': '#f59e0b',
      'Vehicle': '#22c55e',
      'Transport Document': '#ef4444',
      'Customer Order': '#10b981',
      'Container': '#2563eb',
      'Handling Unit': '#7c3aed',
      'Truck': '#06b6d4',
    });
    return { nodeIds, edges, colorMap };
  }, [rawData]);

  // Node widths (auto-sized to label)
  const widthMap = useMemo(
    () => new Map(nodeIds.map((id) => [id, nodeWidth(id)])),
    [nodeIds],
  );

  // ── Hierarchical layout ──────────────────────────────────────────────────────
  const layoutMap = useMemo(
    () => computeHierarchicalLayout(nodeIds, edges, svgSize.width, svgSize.height, widthMap),
    [nodeIds, edges, svgSize.width, svgSize.height, widthMap],
  );

  const layoutNodes: LayoutNode[] = useMemo(
    () =>
      nodeIds.map((id) => {
        const pos = layoutMap.get(id) ?? { x: 100, y: 100 };
        const color = colorMap[id] ?? '#2563eb';
        const textColor = textColorForBackground(color, { minContrast: 3.8, gradientSamples: [] });
        return { id, x: pos.x, y: pos.y, width: widthMap.get(id) ?? 80, height: NODE_H, color, textColor };
      }),
    [nodeIds, layoutMap, colorMap, widthMap],
  );

  const nodePos = useMemo(
    () => new Map(layoutNodes.map((n) => [n.id, n])),
    [layoutNodes],
  );

  // ── Auto-fit on layout change ────────────────────────────────────────────────
  useEffect(() => {
    if (layoutNodes.length === 0) return;
    const xs = layoutNodes.map((n) => n.x);
    const ys = layoutNodes.map((n) => n.y);
    const minX = Math.min(...xs) - 80;
    const maxX = Math.max(...xs) + 80;
    const minY = Math.min(...ys) - 60;
    const maxY = Math.max(...ys) + 60;
    const gW = maxX - minX;
    const gH = maxY - minY;
    const newZoom = Math.min(svgSize.width / gW, svgSize.height / gH, 1.6);
    setZoom(newZoom);
    setPan({
      x: (svgSize.width - gW * newZoom) / 2 - minX * newZoom,
      y: (svgSize.height - gH * newZoom) / 2 - minY * newZoom,
    });
  }, [layoutNodes, svgSize]);

  // ── Zoom / pan handlers ──────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    setZoom((z) => {
      const newZoom = Math.max(0.15, Math.min(5, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      setPan((p) => ({
        x: cursorX - (cursorX - p.x) * (newZoom / z),
        y: cursorY - (cursorY - p.y) * (newZoom / z),
      }));
      return newZoom;
    });
  }, []);

  const zoomToCenter = (factor: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    setZoom((z) => {
      const newZoom = Math.max(0.15, Math.min(5, z * factor));
      setPan((p) => ({
        x: centerX - (centerX - p.x) * (newZoom / z),
        y: centerY - (centerY - p.y) * (newZoom / z),
      }));
      return newZoom;
    });
  };

  const handleZoomIn = () => zoomToCenter(1.2);
  const handleZoomOut = () => zoomToCenter(1 / 1.2);
  const handleFit = () => {
    if (layoutNodes.length === 0) return;
    const xs = layoutNodes.map((n) => n.x);
    const ys = layoutNodes.map((n) => n.y);
    const minX = Math.min(...xs) - 80, maxX = Math.max(...xs) + 80;
    const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60;
    const gW = maxX - minX, gH = maxY - minY;
    const nz = Math.min(svgSize.width / gW, svgSize.height / gH, 1.6);
    setZoom(nz);
    setPan({
      x: (svgSize.width - gW * nz) / 2 - minX * nz,
      y: (svgSize.height - gH * nz) / 2 - minY * nz,
    });
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (panLocked || e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    panOrigin.current = { x: pan.x, y: pan.y };
  }, [pan, panLocked]);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    setPan({ x: panOrigin.current.x + e.clientX - panStart.current.x, y: panOrigin.current.y + e.clientY - panStart.current.y });
  }, []);
  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);

  // Expose controls
  useEffect(() => {
    onControlsReady?.({
      processAreaScale: zoom,
      onProcessAreaScaleChange: setZoom,
      autoZoomEnabled: !panLocked,
      onAutoZoomToggle: () => setPanLocked((v) => !v),
      minScale: 0.15, maxScale: 5, scaleStep: 0.05,
    });
  }, [zoom, panLocked, onControlsReady]);

  const computedHeight = typeof height === 'number' ? `${height}px` : height;

  // ── Determine curvature per edge (same layer → curve, else straight) ─────────
  const edgeCurvatures = useMemo(() => {
    const layerOf = new Map<string, number>();
    layoutNodes.forEach((n) => {
      // Use y-position as proxy for layer index (higher y = deeper layer)
      layerOf.set(n.id, Math.round(n.y));
    });

    // Count parallel edges between same node pair (for offset)
    const pairCount = new Map<string, number>();
    const pairIndex = new Map<string, number>();
    for (const e of edges) {
      const key = [e.from, e.to].sort().join('↔');
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
    for (const e of edges) {
      const key = [e.from, e.to].sort().join('↔');
      const idx = pairIndex.get(key) ?? 0;
      pairIndex.set(key, idx + 1);
      const count = pairCount.get(key) ?? 1;
      const sameLayer = layerOf.get(e.from) === layerOf.get(e.to);
      // Curve same-layer edges or multi-edges
      const baseCurve = sameLayer ? 60 : count > 1 ? 40 : 0;
      const sign = idx % 2 === 0 ? 1 : -1;
      pairIndex.set(e.id, baseCurve * sign);
    }
    return pairIndex;
  }, [edges, layoutNodes]);

  // ── Render edges ─────────────────────────────────────────────────────────────
  const renderedEdges = useMemo(() => {
    const edgeData = edges.map((edge) => {
      const src = nodePos.get(edge.from);
      const tgt = nodePos.get(edge.to);
      if (!src || !tgt) return null;

      const curvature = edgeCurvatures.get(edge.id) ?? 0;
      const color = RELATION_COLOR[edge.relation] ?? '#64748b';
      const isConcurrent = edge.relation === 'P';
      const isIndependent = edge.relation === 'I';
      const isDashed = isIndependent;

      // Clip endpoints to node borders
      const srcPt = clipToBorder(src.x, src.y, tgt.x, tgt.y, src.width / 2 + 1, NODE_H / 2 + 1);
      const tgtPt = clipToBorder(tgt.x, tgt.y, src.x, src.y, tgt.width / 2 + 6, NODE_H / 2 + 6);

      const path = bezierPath(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature);
      const arrow = arrowPath(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, 9);

      const edgeDx = tgtPt.x - srcPt.x;
      const edgeDy = tgtPt.y - srcPt.y;
      const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) || 1;
      const perpX = -edgeDy / edgeLen;
      const perpY = edgeDx / edgeLen;

      // Stagger bubbles vertically based on horizontal angle to reduce overlap
      const bubbleT = 0.5 + (edgeDx / edgeLen) * 0.15;
      const midPt = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, bubbleT);

      // Source and target label positions
      const srcT = 0.22;
      const tgtT = 0.78;
      const srcL = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, srcT);
      const tgtL = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, tgtT);
      
      const squareAngle = Math.atan2(edgeDy, edgeDx) * 180 / Math.PI;

      return { edge, path, color, isConcurrent, isIndependent, isDashed, srcPt, tgtPt, arrow, midPt, srcL, tgtL, perpX, perpY, edgeDx, edgeDy, squareAngle };
    }).filter(Boolean) as any[];

    return (
      <>
        {/* Pass 1: Render all arcs so they sit behind decorations */}
        {edgeData.map((d) => (
          <path
            key={`path-${d.edge.id}`}
            d={d.path}
            stroke={d.color}
            strokeWidth={d.isConcurrent ? 2 : 1.5}
            strokeDasharray={d.isDashed ? '6 3' : undefined}
            fill="none"
          />
        ))}

        {/* Pass 2: Render all terminators, text, and bubbles on top */}
        {edgeData.map((d) => (
          <g key={`dec-${d.edge.id}`}>
            {/* Arrowhead (Only for Independent relations) */}
            {d.isIndependent && <path d={d.arrow} fill={d.color} />}

            {/* Source square terminator (For all other relations) */}
            {!d.isIndependent && (
              <rect
                x={d.srcPt.x - SQUARE_SIZE / 2}
                y={d.srcPt.y - SQUARE_SIZE / 2}
                width={SQUARE_SIZE}
                height={SQUARE_SIZE}
                fill={d.color}
                transform={`rotate(${d.squareAngle}, ${d.srcPt.x}, ${d.srcPt.y})`}
              />
            )}

            {/* Parallel (P) double bars near source */}
            {d.isConcurrent && (
              <>
                <line x1={d.srcPt.x + d.perpX * 5} y1={d.srcPt.y + d.perpY * 5} x2={d.srcPt.x + d.perpX * 5 + d.edgeDx * 0.1} y2={d.srcPt.y + d.perpY * 5 + d.edgeDy * 0.1} stroke={d.color} strokeWidth={1.8} />
                <line x1={d.srcPt.x - d.perpX * 5} y1={d.srcPt.y - d.perpY * 5} x2={d.srcPt.x - d.perpX * 5 + d.edgeDx * 0.1} y2={d.srcPt.y - d.perpY * 5 + d.edgeDy * 0.1} stroke={d.color} strokeWidth={1.8} />
              </>
            )}

            {/* Source label offset perpendicularly */}
            {d.edge.sourceLabel && (
              <text
                x={d.srcL.x + d.perpX * 12}
                y={d.srcL.y + d.perpY * 12}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={FONT_SIZE_LABEL}
                fontFamily={NODE_FONT_FAMILY}
                fontWeight="600"
                fill={d.color}
              >
                {d.edge.sourceLabel}
              </text>
            )}

            {/* Target label offset perpendicularly */}
            {d.edge.targetLabel && (
              <text
                x={d.tgtL.x + d.perpX * 12}
                y={d.tgtL.y + d.perpY * 12}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={FONT_SIZE_LABEL}
                fontFamily={NODE_FONT_FAMILY}
                fontWeight="600"
                fill={d.color}
              >
                {d.edge.targetLabel}
              </text>
            )}

            {/* Midpoint oval bubble (EC|LC) */}
            {d.edge.bubbleLabel && (
              <g>
                <ellipse
                  cx={d.midPt.x}
                  cy={d.midPt.y}
                  rx={OVAL_RX}
                  ry={OVAL_RY}
                  fill="#ffffff"
                  stroke={d.color}
                  strokeWidth={1.2}
                />
                <text
                  x={d.midPt.x}
                  y={d.midPt.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={FONT_SIZE_BUBBLE}
                  fontFamily={NODE_FONT_FAMILY}
                  fontWeight="600"
                  fill={d.color}
                >
                  {d.edge.bubbleLabel}
                </text>
              </g>
            )}
          </g>
        ))}
      </>
    );
  }, [edges, nodePos, edgeCurvatures]);

  // ── Render nodes ─────────────────────────────────────────────────────────────
  const renderedNodes = useMemo(() =>
    layoutNodes.map((n) => (
      <g key={n.id} transform={`translate(${n.x - n.width / 2}, ${n.y - NODE_H / 2})`}>
        <rect
          width={n.width}
          height={NODE_H}
          rx={NODE_R}
          ry={NODE_R}
          fill={n.color}
          stroke="rgba(0,0,0,0.15)"
          strokeWidth={1}
        />
        <text
          x={n.width / 2}
          y={NODE_H / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={FONT_SIZE_NODE}
          fontWeight={700}
          fontFamily={NODE_FONT_FAMILY}
          fill={n.textColor}
        >
          {n.id}
        </text>
      </g>
    )),
    [layoutNodes],
  );

  // ── Legend ───────────────────────────────────────────────────────────────────
  const relationTypes = useMemo(() => [...new Set(edges.map((e) => e.relation))], [edges]);
  const RELATION_LABEL: Record<string, string> = {
    D: 'Dependent', Di: 'Dependent (inv.)', P: 'Parallel', I: 'Independent', A: 'Abstract',
  };

  // ── Core visualizer ──────────────────────────────────────────────────────────
  const core = (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: computedHeight,
        background: '#f8fafc',
        overflow: 'hidden',
        cursor: panLocked ? 'default' : isPanning.current ? 'grabbing' : 'grab',
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Empty state */}
      {!eventLogId && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderRadius: 12, border: '1px solid #e2e8f0', background: 'white', padding: '20px 28px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>TOTeM Miner</span>
            <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Select an event log to discover its TOTeM model.</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 14px', color: '#991b1b', fontSize: 13, whiteSpace: 'nowrap' }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(4px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', padding: '10px 20px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid #2563eb', borderTopColor: 'transparent', animation: 'totem-spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: '#475569' }}>Discovering TOTeM model…</span>
          </div>
        </div>
      )}

      {/* SVG graph */}
      <svg
        width={svgSize.width}
        height={svgSize.height}
        style={{ display: 'block', userSelect: 'none' }}
      >
        <defs>
          <style>{`@keyframes totem-spin { to { transform: rotate(360deg); } }`}</style>
        </defs>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {renderedEdges}
          {renderedNodes}
        </g>
      </svg>

      {/* Zoom controls — bottom left */}
      <div style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {([
          { icon: <ZoomIn size={14} />, action: handleZoomIn, title: 'Zoom in' },
          { icon: <ZoomOut size={14} />, action: handleZoomOut, title: 'Zoom out' },
          { icon: <Maximize2 size={14} />, action: handleFit, title: 'Fit' },
          { icon: panLocked ? <Lock size={14} /> : <Unlock size={14} />, action: () => setPanLocked((v) => !v), title: panLocked ? 'Unlock pan' : 'Lock pan' },
        ] as const).map((btn, i) => (
          <button
            key={i}
            onClick={btn.action as () => void}
            title={btn.title}
            style={{
              width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0',
              background: 'rgba(255,255,255,0.9)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#475569', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}
          >
            {btn.icon}
          </button>
        ))}
      </div>

      {/* Legend — bottom right */}
      {relationTypes.length > 0 && (
        <div style={{ position: 'absolute', bottom: 14, right: 14, zIndex: 20, background: 'rgba(255,255,255,0.92)', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 12px', fontSize: 11, boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 5, pointerEvents: 'none' }}>
          {relationTypes.map((rel) => (
            <div key={rel} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width={24} height={10}>
                <line x1={0} y1={5} x2={24} y2={5} stroke={RELATION_COLOR[rel] ?? '#64748b'} strokeWidth={rel === 'P' ? 2 : 1.5} strokeDasharray={rel === 'I' ? '4 2' : undefined} />
              </svg>
              <span style={{ color: '#475569', fontWeight: 500 }}>{RELATION_LABEL[rel] ?? rel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (embedded) return core;

  return (
    <Card className="@container/card w-full flex flex-col">
      <CardHeader className="items-center relative z-10 justify-between flex-shrink-0">
        <CardTitle>TOTeM Model</CardTitle>
        <CardAction className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={!eventLogId} className="flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" />
            Reload
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">{core}</CardContent>
    </Card>
  );
}

export default TotemMinerVisualizer;
