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
import { RefreshCcw, Plus, Minus, Scan, Lock, Unlock } from 'lucide-react';
import { mapTypesToColors, textColorForBackground } from '../utils/objectColors';

// ─── Types ───────────────────────────────────────────────────────────────────

type TotemCardinality = {
  from: string;
  to: string;
  model_cardinality?: string | null;
  log_cardinality: string | null;
  event_cardinality: string | null;
};

type TotemRelationStat = {
  from: string;
  to: string;
  lc_total: number;
  ec_total: number;
  tr_total: number;
  lc_percentages: Record<string, number>;
  ec_percentages: Record<string, number>;
  tr_percentages: Record<string, number>;
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
  relations_stats?: TotemRelationStat[];
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
  relayoutSignal?: number;
  title?: string;
  topInset?: number;
  embedded?: boolean;
  onControlsReady?: (controls: TotemMinerVisualizerControls) => void;
  tau?: number;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BACKEND = 'http://localhost:8000';

const RELATION_COLOR: Record<string, string> = {
  D: '#0f172a',
  Di: '#0f172a',
  P: '#0f172a',
  I: '#0f172a',
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
  const ecFormatted = formatCardinality(ec) || '0';
  const lcFormatted = formatCardinality(lc) || '0';
  return `${ecFormatted}|${lcFormatted}`;
}

// Helper functions for frontend relation discovery based on tau
function getMostPreciseLc(
  lcPercentages: Record<string, number> | undefined,
  tau: number
): string {
  if (!lcPercentages) return 'None';
  if (lcPercentages['0'] >= tau) return '0';
  if (lcPercentages['1'] >= tau) return '1';
  if (lcPercentages['0...1'] >= tau) return '0...1';
  if (lcPercentages['1..*'] >= tau) return '1..*';
  if (lcPercentages['0...*'] >= tau) return '0...*';
  return 'None';
}

function getMostPreciseEc(
  ecPercentages: Record<string, number> | undefined,
  tau: number
): string {
  if (!ecPercentages) return 'None';
  if (ecPercentages['0'] >= tau) return '0';
  if (ecPercentages['1'] >= tau) return '1';
  if (ecPercentages['0...1'] >= tau) return '0...1';
  if (ecPercentages['1..*'] >= tau) return '1..*';
  if (ecPercentages['0...*'] >= tau) return '0...*';
  return 'None';
}

function hasValidEventCardinalityPair(
  ec: string,
  inverseEc: string,
  tau: number
): boolean {
  if (tau < 1) return true;
  return !(
    (ec === '1' && inverseEc === '0') ||
    (ec === '0' && inverseEc === '1')
  );
}

function getMostPreciseTr(
  trPercentages: Record<string, number> | undefined,
  tau: number
): string {
  if (!trPercentages) return 'None';
  if (trPercentages['D'] >= tau) return 'D';
  if (trPercentages['Di'] >= tau) return 'Di';
  if (trPercentages['I'] >= tau) return 'I';
  if (trPercentages['Ii'] >= tau) return 'Ii';
  if (trPercentages['P'] >= tau) return 'P';
  return 'None';
}


// ─── Extract edges from tempgraph ────────────────────────────────────────────

function extractEdges(
  tempgraph: TotemApiResponse['tempgraph'],
  cardinalities: TotemCardinality[],
): GraphEdge[] {
  const cardMap = new Map<string, TotemCardinality>();
  cardinalities.forEach((c) => cardMap.set(`${c.from}→${c.to}`, c));

  const edges: GraphEdge[] = [];
  const RELATION_KEYS = ['D', 'Di', 'P', 'I', 'Ii', 'A'];

  for (const key of RELATION_KEYS) {
    const list = tempgraph[key];
    if (!Array.isArray(list)) continue;
    (list as string[][]).forEach((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return;
      let [from, to] = pair;
      let relation = key;
      // Inverse relations are rendered by reversing the arc direction so each
      // marker keeps the same meaning as in the paper.
      if (key === 'Di') {
        [from, to] = [to, from];
        relation = 'D';
      } else if (key === 'Ii') {
        [from, to] = [to, from];
        relation = 'I';
      }
      const card = cardMap.get(`${from}→${to}`);
      edges.push({
        id: `${key}::${from}→${to}`,
        from,
        to,
        relation,
        sourceLabel: formatCardinality(card?.model_cardinality) || '1',
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
  if (nodeIds.length === 1) {
    return new Map([[nodeIds[0], { x: width / 2, y: height / 2 }]]);
  }

  // Count degree (incoming + outgoing) of each node
  const degree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const e of edges) {
    if (degree.has(e.from)) degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    if (degree.has(e.to)) degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  // Find hub node (node with maximum degree)
  let hubNode = nodeIds[0];
  let maxDeg = -1;
  for (const [id, deg] of degree.entries()) {
    if (deg > maxDeg) {
      maxDeg = deg;
      hubNode = id;
    }
  }

  const nonHubNodes = nodeIds.filter((id) => id !== hubNode);

  // Build adjacency list for non-hub nodes (subgraph)
  const nonHubAdj = new Map<string, string[]>(nonHubNodes.map((id) => [id, []]));
  for (const e of edges) {
    if (e.from === hubNode || e.to === hubNode) continue;
    if (nonHubAdj.has(e.from) && nonHubAdj.has(e.to)) {
      nonHubAdj.get(e.from)!.push(e.to);
      nonHubAdj.get(e.to)!.push(e.from);
    }
  }

  // Sort non-hub nodes alphabetically to ensure stable DFS traversal starting node order
  const sortedNonHubNodes = [...nonHubNodes].sort();

  // Traverse the non-hub subgraph using DFS to order the nodes circularly to minimize crossings
  const visited = new Set<string>();
  const sortedNonHub: string[] = [];

  function dfs(node: string) {
    visited.add(node);
    sortedNonHub.push(node);
    for (const nb of nonHubAdj.get(node) ?? []) {
      if (!visited.has(nb)) {
        dfs(nb);
      }
    }
  }

  // Start DFS with endpoints of paths (nodes of degree <= 1 in the non-hub subgraph)
  for (const node of sortedNonHubNodes) {
    if (!visited.has(node) && (nonHubAdj.get(node) ?? []).length <= 1) {
      dfs(node);
    }
  }
  // Fallback for remaining nodes (e.g. cycle components)
  for (const node of sortedNonHubNodes) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.max(180, width * 0.32);
  const ry = Math.max(130, height * 0.3);

  const positions = new Map<string, { x: number; y: number }>();
  positions.set(hubNode, { x: cx, y: cy });

  // Map sorted non-hub nodes around a circle starting from bottom-left (1.92 rad ~ 110 degrees)
  const startAngle = 1.92;
  const angleStep = (2 * Math.PI) / sortedNonHub.length;

  sortedNonHub.forEach((id, idx) => {
    const angle = startAngle + idx * angleStep;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    positions.set(id, { x, y });
  });

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
  relayoutSignal,
  embedded = false,
  onControlsReady,
  tau = 0.8,
}: TotemMinerVisualizerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawData, setRawData] = useState<TotemApiResponse | null>(null);

  // Pan & zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panLocked, setPanLocked] = useState(true);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const [manualNodePositions, setManualNodePositions] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(),
  );
  const manualPositionsRef = useRef(manualNodePositions);
  const draggedNode = useRef<{
    id: string;
    origin: { x: number; y: number };
    pointer: { x: number; y: number };
  } | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  manualPositionsRef.current = manualNodePositions;

  const [layoutPositions, setLayoutPositions] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ width: 800, height: 600 });
  const [stableSvgSize, setStableSvgSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setStableSvgSize(svgSize);
    }, 250);
    return () => clearTimeout(timer);
  }, [svgSize]);

  const effectiveReloadSignal = reloadSignal ?? 0;

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!eventLogId) { setRawData(null); return; }
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get<TotemApiResponse>(
        `${backendBaseUrl}/api/files/${eventLogId}/discover_totem/`,
      );
      setRawData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load TOTeM data');
      setRawData(null);
    } finally {
      setLoading(false);
    }
  }, [backendBaseUrl, eventLogId]);

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
  const { nodeIds, edges, colorMap, rawCardinalities } = useMemo(() => {
    if (!rawData) return { nodeIds: [], edges: [], colorMap: {}, rawCardinalities: [] };

    const nodes = new Set<string>();
    const tempgraph: Record<string, string[][]> = {
      P: [],
      I: [],
      D: []
    };
    const cardinalities: TotemCardinality[] = [];

    const typeRelations = rawData.type_relations || [];
    const relationsData = rawData.relations_stats || [];

    const relMap = new Map<string, any>();
    relationsData.forEach((rel) => {
      relMap.set(`${rel.from}→${rel.to}`, rel);
    });

    typeRelations.forEach((pair) => {
      if (pair.length < 2) return;
      const [t1, t2] = pair;
      nodes.add(t1);
      nodes.add(t2);

      const rel12 = relMap.get(`${t1}→${t2}`);
      const rel21 = relMap.get(`${t2}→${t1}`);

      const lc = getMostPreciseLc(rel12?.lc_percentages, tau);
      const lc_i = getMostPreciseLc(rel21?.lc_percentages, tau);
      const ec = getMostPreciseEc(rel12?.ec_percentages, tau);
      const ec_i = getMostPreciseEc(rel21?.ec_percentages, tau);

      if (!hasValidEventCardinalityPair(ec, ec_i, tau)) {
        return;
      }

      const tr = getMostPreciseTr(rel12?.tr_percentages, tau);
      const tr_i = getMostPreciseTr(rel21?.tr_percentages, tau);

      if (tr === 'Di' || tr === 'Ii') {
        const inverseTr = tr === 'Di' ? 'D' : 'I';
        if (tr_i && (tr_i === 'D' || tr_i === 'I' || tr_i === 'P')) {
          tempgraph[tr_i] = tempgraph[tr_i] || [];
          tempgraph[tr_i].push([t2, t1]);
        } else {
          tempgraph[inverseTr] = tempgraph[inverseTr] || [];
          tempgraph[inverseTr].push([t2, t1]);
        }
      } else {
        if (tr && (tr === 'D' || tr === 'I' || tr === 'P')) {
          tempgraph[tr] = tempgraph[tr] || [];
          tempgraph[tr].push([t1, t2]);
        }
      }

      cardinalities.push({
        from: t1,
        to: t2,
        log_cardinality: lc === 'None' ? null : lc,
        event_cardinality: ec === 'None' ? null : ec
      });
      cardinalities.push({
        from: t2,
        to: t1,
        log_cardinality: lc_i === 'None' ? null : lc_i,
        event_cardinality: ec_i === 'None' ? null : ec_i
      });
    });

    const nodeIds = Array.from(nodes).sort();
    const edges = extractEdges(tempgraph, cardinalities);

    const colorMap = mapTypesToColors(nodeIds, {
      'Forklift': '#f59e0b',
      'Vehicle': '#22c55e',
      'Transport Document': '#ef4444',
      'Customer Order': '#10b981',
      'Container': '#2563eb',
      'Handling Unit': '#7c3aed',
      'Truck': '#06b6d4',
    });

    return { nodeIds, edges, colorMap, rawCardinalities: cardinalities };
  }, [rawData, tau]);

  // Node widths (auto-sized to label)
  const widthMap = useMemo(
    () => new Map(nodeIds.map((id) => [id, nodeWidth(id)])),
    [nodeIds],
  );

  // ── Hierarchical layout & Relayout controls ──────────────────────────────────
  const handleRelayout = useCallback(() => {
    if (nodeIds.length === 0 || !stableSvgSize) return;
    const newLayout = computeHierarchicalLayout(nodeIds, edges, stableSvgSize.width, stableSvgSize.height, widthMap);
    setLayoutPositions(newLayout);
    setManualNodePositions(new Map());
  }, [nodeIds, edges, stableSvgSize, widthMap]);

  useEffect(() => {
    if (relayoutSignal && relayoutSignal > 0) {
      handleRelayout();
    }
  }, [relayoutSignal, handleRelayout]);

  // Run layout on initial load or if layoutPositions is empty
  useEffect(() => {
    if (nodeIds.length > 0 && layoutPositions.size === 0 && stableSvgSize) {
      const initialLayout = computeHierarchicalLayout(nodeIds, edges, stableSvgSize.width, stableSvgSize.height, widthMap);
      setLayoutPositions(initialLayout);
    }
  }, [nodeIds, edges, stableSvgSize, widthMap, layoutPositions.size]);

  useEffect(() => {
    setLayoutPositions(new Map());
    setManualNodePositions(new Map());
  }, [eventLogId]);

  const layoutNodes: LayoutNode[] = useMemo(
    () =>
      nodeIds.map((id) => {
        // Manual positions override the layout positions.
        const pos = manualNodePositions.get(id) ?? layoutPositions.get(id) ?? { x: 100, y: 100 };
        const color = colorMap[id] ?? '#2563eb';
        const textColor = textColorForBackground(color, { minContrast: 3.8, gradientSamples: [] });
        return { id, x: pos.x, y: pos.y, width: widthMap.get(id) ?? 80, height: NODE_H, color, textColor };
      }),
    [nodeIds, layoutPositions, colorMap, widthMap, manualNodePositions],
  );

  const nodePos = useMemo(
    () => new Map(layoutNodes.map((n) => [n.id, n])),
    [layoutNodes],
  );

  useEffect(() => {
    const knownNodeIds = new Set(nodeIds);
    setManualNodePositions((positions) => {
      const next = new Map([...positions].filter(([id]) => knownNodeIds.has(id)));
      return next.size === positions.size ? positions : next;
    });
  }, [nodeIds]);

  useEffect(() => {
    setManualNodePositions(new Map());
  }, [eventLogId]);

  // ── Auto-fit on layout change ────────────────────────────────────────────────
  useEffect(() => {
    if (layoutNodes.length === 0 || !stableSvgSize) return;
    if (manualPositionsRef.current.size > 0) return;
    const xs = layoutNodes.map((n) => n.x);
    const ys = layoutNodes.map((n) => n.y);
    const minX = Math.min(...xs) - 80;
    const maxX = Math.max(...xs) + 80;
    const minY = Math.min(...ys) - 60;
    const maxY = Math.max(...ys) + 60;
    const gW = maxX - minX;
    const gH = maxY - minY;
    const newZoom = Math.min(stableSvgSize.width / gW, stableSvgSize.height / gH, 1.6);
    setZoom(newZoom);
    setPan({
      x: (stableSvgSize.width - gW * newZoom) / 2 - minX * newZoom,
      y: (stableSvgSize.height - gH * newZoom) / 2 - minY * newZoom,
    });
  }, [layoutPositions, layoutNodes, stableSvgSize]);

  // ── Zoom / pan handlers ──────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelRaw = (e: WheelEvent) => {
      if (panLocked) return;
      e.preventDefault();
      
      const rect = container.getBoundingClientRect();
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
    };

    container.addEventListener('wheel', handleWheelRaw, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheelRaw);
    };
  }, [panLocked]);

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
    if (layoutNodes.length === 0 || !stableSvgSize) return;
    const xs = layoutNodes.map((n) => n.x);
    const ys = layoutNodes.map((n) => n.y);
    const minX = Math.min(...xs) - 80, maxX = Math.max(...xs) + 80;
    const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60;
    const gW = maxX - minX, gH = maxY - minY;
    const nz = Math.min(stableSvgSize.width / gW, stableSvgSize.height / gH, 1.6);
    setZoom(nz);
    setPan({
      x: (stableSvgSize.width - gW * nz) / 2 - minX * nz,
      y: (stableSvgSize.height - gH * nz) / 2 - minY * nz,
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

  const handleNodeMouseDown = useCallback((e: React.MouseEvent<SVGGElement>, nodeId: string) => {
    if (e.button !== 0) return;
    const node = nodePos.get(nodeId);
    if (!node) return;

    e.preventDefault();
    e.stopPropagation();
    draggedNode.current = {
      id: nodeId,
      origin: { x: node.x, y: node.y },
      pointer: { x: e.clientX, y: e.clientY },
    };
    setDraggingNodeId(nodeId);
  }, [nodePos]);

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      const drag = draggedNode.current;
      if (!drag) return;

      setManualNodePositions((positions) => {
        const next = new Map(positions);
        next.set(drag.id, {
          x: drag.origin.x + (e.clientX - drag.pointer.x) / zoom,
          y: drag.origin.y + (e.clientY - drag.pointer.y) / zoom,
        });
        return next;
      });
    };
    const handleWindowMouseUp = () => {
      draggedNode.current = null;
      setDraggingNodeId(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [zoom]);

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
      // Curve same-layer edges or multi-edges, but keep precedes (I) edges direct.
      const baseCurve = e.relation === 'I' ? 0 : sameLayer ? 60 : count > 1 ? 40 : 0;
      const sign = idx % 2 === 0 ? 1 : -1;
      pairIndex.set(e.id, baseCurve * sign);
    }
    return pairIndex;
  }, [edges, layoutNodes]);

  // ── Render edges ─────────────────────────────────────────────────────────────
  const renderedEdges = useMemo(() => {
    const cardMap = new Map<string, TotemCardinality>();
    rawCardinalities.forEach((c) => cardMap.set(`${c.from}→${c.to}`, c));

    // Keep track of occupied space to avoid overlaps
    const occupiedRects: { x1: number; y1: number; x2: number; y2: number }[] = [];
    
    // Add all nodes as occupied
    layoutNodes.forEach(n => {
       occupiedRects.push({
         x1: n.x - n.width/2 - 10,
         y1: n.y - NODE_H/2 - 10,
         x2: n.x + n.width/2 + 10,
         y2: n.y + NODE_H/2 + 10
       });
    });

    function isOccupied(cx: number, cy: number, w: number, h: number) {
      const rx1 = cx - w/2;
      const ry1 = cy - h/2;
      const rx2 = cx + w/2;
      const ry2 = cy + h/2;
      return occupiedRects.some(r => !(rx2 < r.x1 || rx1 > r.x2 || ry2 < r.y1 || ry1 > r.y2));
    }

    const edgeData = edges.map((edge) => {
      const src = nodePos.get(edge.from);
      const tgt = nodePos.get(edge.to);
      if (!src || !tgt) return null;

      const curvature = edgeCurvatures.get(edge.id) ?? 0;
      const color = RELATION_COLOR[edge.relation] ?? '#64748b';
      const isParallel = edge.relation === 'P';
      const isInitiating = edge.relation === 'I';

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
      const parallelSource = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, 0.08);
      const parallelTarget = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, 0.92);

      // Stagger bubbles vertically based on horizontal angle to reduce overlap
      let bubbleT = 0.5 + (edgeDx / edgeLen) * 0.15;
      let midPt = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, bubbleT);

      const bubbleLabel = edge.bubbleLabel || '0|0';
      const bubbleW = Math.max(40, estimateTextWidth(bubbleLabel, FONT_SIZE_BUBBLE) + 16);
      
      if (bubbleW > 0) {
        const shifts = [0.1, -0.1, 0.2, -0.2, 0.3, -0.3];
        let sIdx = 0;
        while (isOccupied(midPt.x, midPt.y, bubbleW, 24) && sIdx < shifts.length) {
          const testT = Math.max(0.15, Math.min(0.85, (0.5 + (edgeDx / edgeLen) * 0.15) + shifts[sIdx]));
          midPt = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, testT);
          sIdx++;
        }
        occupiedRects.push({
          x1: midPt.x - bubbleW/2,
          y1: midPt.y - 12,
          x2: midPt.x + bubbleW/2,
          y2: midPt.y + 12,
        });
      }

      // Source and target label positions
      let srcT = 0.22;
      let tgtT = 0.78;
      let srcL = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, srcT);
      let tgtL = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, tgtT);
      
      let srcPerpSign = 1;
      let tgtPerpSign = 1;

      let srcLText = { x: srcL.x + perpX * 12 * srcPerpSign, y: srcL.y + perpY * 12 * srcPerpSign };
      const srcW = edge.sourceLabel ? estimateTextWidth(edge.sourceLabel, FONT_SIZE_LABEL) + 10 : 0;
      if (srcW > 0) {
         if (isOccupied(srcLText.x, srcLText.y, srcW, 16)) {
            srcPerpSign = -1; // try other side
            srcLText = { x: srcL.x + perpX * 12 * srcPerpSign, y: srcL.y + perpY * 12 * srcPerpSign };
            if (isOccupied(srcLText.x, srcLText.y, srcW, 16)) {
               // try sliding
               const shifts = [0.05, -0.05, 0.1, -0.1, 0.15, -0.15];
               let sIdx = 0;
               while (isOccupied(srcLText.x, srcLText.y, srcW, 16) && sIdx < shifts.length) {
                 srcT = Math.max(0.05, Math.min(0.95, 0.22 + shifts[sIdx]));
                 srcL = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, srcT);
                 srcPerpSign = 1;
                 srcLText = { x: srcL.x + perpX * 12 * srcPerpSign, y: srcL.y + perpY * 12 * srcPerpSign };
                 if (!isOccupied(srcLText.x, srcLText.y, srcW, 16)) break;
                 srcPerpSign = -1;
                 srcLText = { x: srcL.x + perpX * 12 * srcPerpSign, y: srcL.y + perpY * 12 * srcPerpSign };
                 sIdx++;
               }
            }
         }
         occupiedRects.push({ x1: srcLText.x - srcW/2, y1: srcLText.y - 8, x2: srcLText.x + srcW/2, y2: srcLText.y + 8 });
      }

      let tgtLText = { x: tgtL.x + perpX * 12 * tgtPerpSign, y: tgtL.y + perpY * 12 * tgtPerpSign };
      const tgtW = edge.targetLabel ? estimateTextWidth(edge.targetLabel, FONT_SIZE_LABEL) + 10 : 0;
      if (tgtW > 0) {
         if (isOccupied(tgtLText.x, tgtLText.y, tgtW, 16)) {
            tgtPerpSign = -1; // try other side
            tgtLText = { x: tgtL.x + perpX * 12 * tgtPerpSign, y: tgtL.y + perpY * 12 * tgtPerpSign };
            if (isOccupied(tgtLText.x, tgtLText.y, tgtW, 16)) {
               // try sliding
               const shifts = [0.05, -0.05, 0.1, -0.1, 0.15, -0.15];
               let sIdx = 0;
               while (isOccupied(tgtLText.x, tgtLText.y, tgtW, 16) && sIdx < shifts.length) {
                 tgtT = Math.max(0.05, Math.min(0.95, 0.78 + shifts[sIdx]));
                 tgtL = bezierPoint(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, curvature, tgtT);
                 tgtPerpSign = 1;
                 tgtLText = { x: tgtL.x + perpX * 12 * tgtPerpSign, y: tgtL.y + perpY * 12 * tgtPerpSign };
                 if (!isOccupied(tgtLText.x, tgtLText.y, tgtW, 16)) break;
                 tgtPerpSign = -1;
                 tgtLText = { x: tgtL.x + perpX * 12 * tgtPerpSign, y: tgtL.y + perpY * 12 * tgtPerpSign };
                 sIdx++;
               }
            }
         }
         occupiedRects.push({ x1: tgtLText.x - tgtW/2, y1: tgtLText.y - 8, x2: tgtLText.x + tgtW/2, y2: tgtLText.y + 8 });
      }

      return { edge, path, color, isParallel, isInitiating, srcPt, tgtPt, arrow, midPt, srcLText, tgtLText, perpX, perpY, parallelSource, parallelTarget, bubbleWidth: bubbleW, bubbleLabel };
    }).filter(Boolean) as any[];

    return (
      <>
        {/* Pass 1: Render all arcs so they sit behind decorations */}
        {edgeData.map((d) => (
          <path
            key={`path-${d.edge.id}`}
            d={d.path}
            stroke={d.color}
            strokeWidth={d.isParallel ? 2 : 1.5}
            fill="none"
          />
        ))}

        {/* Pass 2: Render all terminators, text, and bubbles on top */}
        {edgeData.map((d) => (
          <g key={`dec-${d.edge.id}`}>
            {/* During (D): the box sits next to the containing target type. */}
            {d.edge.relation === 'D' && (
              <rect
                x={d.tgtPt.x - SQUARE_SIZE / 2}
                y={d.tgtPt.y - SQUARE_SIZE / 2}
                width={SQUARE_SIZE}
                height={SQUARE_SIZE}
                fill={d.color}
              />
            )}

            {/* Precedes (I): a triangle points toward the later target type. */}
            {d.isInitiating && <path d={d.arrow} fill={d.color} />}

            {/* Parallel (P): tee markers at both ends form the paper's || relation. */}
            {d.isParallel && (
              <>
                <line x1={d.parallelSource.x + d.perpX * 7} y1={d.parallelSource.y + d.perpY * 7} x2={d.parallelSource.x - d.perpX * 7} y2={d.parallelSource.y - d.perpY * 7} stroke={d.color} strokeWidth={1.8} />
                <line x1={d.parallelTarget.x + d.perpX * 7} y1={d.parallelTarget.y + d.perpY * 7} x2={d.parallelTarget.x - d.perpX * 7} y2={d.parallelTarget.y - d.perpY * 7} stroke={d.color} strokeWidth={1.8} />
              </>
            )}

            {/* Source label offset perpendicularly */}
            {d.edge.sourceLabel && (
              <text
                x={d.srcLText.x}
                y={d.srcLText.y}
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
                x={d.tgtLText.x}
                y={d.tgtLText.y}
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
            {d.bubbleLabel && (
              <g>
                <ellipse
                  cx={d.midPt.x}
                  cy={d.midPt.y}
                  rx={d.bubbleWidth / 2}
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
                  {d.bubbleLabel}
                </text>
              </g>
            )}
          </g>
        ))}
      </>
    );
  }, [edges, nodePos, edgeCurvatures, rawCardinalities]);

  // ── Render nodes ─────────────────────────────────────────────────────────────
  const renderedNodes = useMemo(() =>
    layoutNodes.map((n) => (
      <g
        key={n.id}
        transform={`translate(${n.x - n.width / 2}, ${n.y - NODE_H / 2})`}
        onMouseDown={(e) => handleNodeMouseDown(e, n.id)}
        style={{ cursor: draggingNodeId === n.id ? 'grabbing' : 'grab' }}
      >
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
    [layoutNodes, handleNodeMouseDown, draggingNodeId],
  );

  // ── Legend ───────────────────────────────────────────────────────────────────
  // ── Core visualizer ──────────────────────────────────────────────────────────
  const core = (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: computedHeight,
        background: '#ffffff',
        overflow: 'hidden',
        cursor: panLocked ? 'default' : isPanning.current ? 'grabbing' : 'grab',
      }}
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
      {(loading || !stableSvgSize) && (
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
      <div style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleZoomIn}
          className="rounded-full h-9 w-9 bg-white/95 shadow-sm border-slate-200 text-slate-600 hover:text-slate-900"
          title="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleZoomOut}
          className="rounded-full h-9 w-9 bg-white/95 shadow-sm border-slate-200 text-slate-600 hover:text-slate-900"
          title="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleFit}
          className="rounded-full h-9 w-9 bg-white/95 shadow-sm border-slate-200 text-slate-600 hover:text-slate-900"
          title="Fit"
        >
          <Scan className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={panLocked ? 'secondary' : 'outline'}
          size="icon"
          onClick={() => setPanLocked((v) => !v)}
          className="rounded-full h-9 w-9 bg-white/95 shadow-sm border-slate-200 text-slate-600 hover:text-slate-900"
          title={panLocked ? 'Unlock pan' : 'Lock pan'}
        >
          {panLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
        </Button>
      </div>

      {/* Legend — bottom right */}
    </div>
  );

  if (embedded) return core;

  return (
    <Card className="@container/card w-full flex flex-col">
      <CardHeader className="items-center relative z-10 justify-between flex-shrink-0">
        <CardTitle>TOTeM Model</CardTitle>
        <CardAction className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRelayout} disabled={!eventLogId} className="flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" />
            Relayout
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">{core}</CardContent>
    </Card>
  );
}

export default TotemMinerVisualizer;
