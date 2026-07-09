/**
 * TOTeM Miner Visualizer
 *
 * Renders the TOTeM temporal graph as a force-directed graph, matching the
 * thesis paper layout:
 *  - Each object type is a coloured rounded-rectangle node
 *  - Arcs are drawn with relation-specific colours/styles
 *  - Each arc carries:
 *      · A source-end label  (log_cardinality reformatted: "1..n" → "1,*")
 *      · A midpoint oval bubble  (event_cardinality | log_cardinality, e.g. "0|1")
 *      · A small filled square at the source endpoint
 *  - A HUD shows Fitness / Precision / τ
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

/** Relation types used in tempgraph */
type RelationType = 'D' | 'P' | 'I' | 'A' | 'Di' | string;

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  relation: RelationType;
  /** log_cardinality reformatted for source label, e.g. "1,*" */
  sourceLabel: string;
  /** EC | LC bubble label, e.g. "0|1" */
  bubbleLabel: string;
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

/** Colour per relation type (matching thesis: black for D/Di, red for P, blue for I, grey for A) */
const RELATION_COLOR: Record<string, string> = {
  D: '#0f172a',
  Di: '#0f172a',
  P: '#dc2626',
  I: '#2563eb',
  A: '#64748b',
};

const NODE_W = 110;
const NODE_H = 36;
const NODE_R = 8; // border-radius
const OVAL_RX = 22;
const OVAL_RY = 10;
const SQUARE_SIZE = 7;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert backend cardinality string ("1..n", "0..1", "1..1") to compact form ("1,*", "0..1", "1") */
function formatCardinality(raw: string | null): string {
  if (!raw) return '';
  const s = raw.trim();
  if (s === '1..1' || s === '1') return '1';
  if (s === '1..n' || s === '1..*' || s === '1..N') return '1,*';
  if (s === '0..n' || s === '0..*' || s === '0..N') return '0,*';
  if (s === '0..1') return '0..1';
  // fallback: replace .. with , if it ends in n
  return s.replace(/\.\.[nN]/, ',*');
}

/** Build a two-char bubble label from EC and LC, e.g. "0|1" */
function bubbleLabel(ec: string | null, lc: string | null): string {
  const ecShort = ec ? (ec.startsWith('0') ? '0' : '1') : '0';
  const lcShort = lc ? (lc.startsWith('0') ? '0' : '1') : '0';
  return `${ecShort}|${lcShort}`;
}

/** Extract all edges from the tempgraph by relation key */
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
        sourceLabel: formatCardinality(card?.log_cardinality ?? null),
        bubbleLabel: bubbleLabel(
          card?.event_cardinality ?? null,
          card?.log_cardinality ?? null,
        ),
      });
    });
  }
  return edges;
}

// ─── D3-style force layout (pure JS, no d3 import needed) ────────────────────

type SimNode = { id: string; x: number; y: number; vx: number; vy: number; fx?: number; fy?: number };
type SimEdge = { from: string; to: string };

function runForceLayout(
  nodeIds: string[],
  edges: SimEdge[],
  width: number,
  height: number,
  iterations = 400,
): Map<string, { x: number; y: number }> {
  if (nodeIds.length === 0) return new Map();

  const nodes: SimNode[] = nodeIds.map((id, i) => ({
    id,
    x: width / 2 + Math.cos((i / nodeIds.length) * 2 * Math.PI) * Math.min(width, height) * 0.35,
    y: height / 2 + Math.sin((i / nodeIds.length) * 2 * Math.PI) * Math.min(width, height) * 0.35,
    vx: 0,
    vy: 0,
  }));

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const REPULSION = 8000;
  const SPRING_LENGTH = 180;
  const SPRING_K = 0.04;
  const DAMPING = 0.85;
  const CENTER_GRAVITY = 0.01;
  const cx = width / 2;
  const cy = height / 2;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Spring attraction along edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.from);
      const b = nodeMap.get(edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const stretch = dist - SPRING_LENGTH;
      const force = SPRING_K * stretch;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Center gravity
    for (const n of nodes) {
      n.vx += (cx - n.x) * CENTER_GRAVITY;
      n.vy += (cy - n.y) * CENTER_GRAVITY;
    }

    // Integrate
    for (const n of nodes) {
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  return new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

// ─── Arc path utilities ───────────────────────────────────────────────────────

/** Clip a line from (cx,cy) to (tx,ty) at the border of a rectangle centred at (cx,cy). */
function clipToBorder(
  cx: number, cy: number,
  tx: number, ty: number,
  halfW: number, halfH: number,
): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy };
  const scaleX = Math.abs(dx) > 0.001 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = Math.abs(dy) > 0.001 ? halfH / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** Midpoint of two points, offset perpendicularly by `offset` pixels. */
function midpointOffset(
  x1: number, y1: number,
  x2: number, y2: number,
  offset: number,
): { x: number; y: number } {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: mx - (dy / len) * offset, y: my + (dx / len) * offset };
}

/** Arrowhead path at point (tx,ty) pointing from (sx,sy) → (tx,ty). */
function arrowPath(sx: number, sy: number, tx: number, ty: number, size = 9): string {
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const ax = tx - ux * size;
  const ay = ty - uy * size;
  return `M ${tx} ${ty} L ${ax + px * size * 0.42} ${ay + py * size * 0.42} L ${ax - px * size * 0.42} ${ay - py * size * 0.42} Z`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

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

  // Pan & zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panLocked, setPanLocked] = useState(false);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ width: 800, height: 600 });

  const effectiveReloadSignal = reloadSignal ?? 0;

  // ── Fetch data ──────────────────────────────────────────────────────────────
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

  // ── Container size observer ─────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setSvgSize({ width: el.clientWidth, height: el.clientHeight });
    });
    obs.observe(el);
    setSvgSize({ width: el.clientWidth, height: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  // ── Build graph data ────────────────────────────────────────────────────────
  const { nodes: nodeIds, edges, colorMap } = useMemo(() => {
    if (!rawData?.tempgraph) return { nodes: [], edges: [], colorMap: {} };
    const nodes = rawData.tempgraph.nodes as string[] ?? [];
    const edges = extractEdges(rawData.tempgraph, rawData.cardinalities ?? []);
    const colorMap = mapTypesToColors(nodes);
    return { nodes, edges, colorMap };
  }, [rawData]);

  // ── Force layout ────────────────────────────────────────────────────────────
  const layoutMap = useMemo(() => {
    if (nodeIds.length === 0) return new Map<string, { x: number; y: number }>();
    return runForceLayout(
      nodeIds,
      edges.map((e) => ({ from: e.from, to: e.to })),
      svgSize.width,
      svgSize.height,
    );
  }, [nodeIds, edges, svgSize.width, svgSize.height]);

  // Build positioned node objects
  const layoutNodes: LayoutNode[] = useMemo(
    () =>
      nodeIds.map((id) => {
        const pos = layoutMap.get(id) ?? { x: 100, y: 100 };
        const color = colorMap[id] ?? '#2563eb';
        const textColor = textColorForBackground(color, { minContrast: 3.8, gradientSamples: [] });
        return { id, x: pos.x, y: pos.y, width: NODE_W, height: NODE_H, color, textColor };
      }),
    [nodeIds, layoutMap, colorMap],
  );
  const nodePos = useMemo(
    () => new Map(layoutNodes.map((n) => [n.id, n])),
    [layoutNodes],
  );

  // ── Auto-fit on data load ───────────────────────────────────────────────────
  useEffect(() => {
    if (layoutNodes.length === 0) return;
    const xs = layoutNodes.map((n) => n.x);
    const ys = layoutNodes.map((n) => n.y);
    const minX = Math.min(...xs) - NODE_W / 2 - 40;
    const maxX = Math.max(...xs) + NODE_W / 2 + 40;
    const minY = Math.min(...ys) - NODE_H / 2 - 40;
    const maxY = Math.max(...ys) + NODE_H / 2 + 40;
    const graphW = maxX - minX;
    const graphH = maxY - minY;
    const scaleX = svgSize.width / graphW;
    const scaleY = svgSize.height / graphH;
    const newZoom = Math.min(scaleX, scaleY, 1.5);
    const newPanX = (svgSize.width - graphW * newZoom) / 2 - minX * newZoom;
    const newPanY = (svgSize.height - graphH * newZoom) / 2 - minY * newZoom;
    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [layoutNodes, svgSize]);

  // ── Zoom handlers ───────────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom((z) => Math.max(0.2, Math.min(4, z * factor)));
  }, []);

  const handleZoomIn = () => setZoom((z) => Math.min(4, z * 1.2));
  const handleZoomOut = () => setZoom((z) => Math.max(0.2, z / 1.2));
  const handleFit = () => {
    if (layoutNodes.length === 0) return;
    const xs = layoutNodes.map((n) => n.x);
    const ys = layoutNodes.map((n) => n.y);
    const minX = Math.min(...xs) - NODE_W / 2 - 40;
    const maxX = Math.max(...xs) + NODE_W / 2 + 40;
    const minY = Math.min(...ys) - NODE_H / 2 - 40;
    const maxY = Math.max(...ys) + NODE_H / 2 + 40;
    const graphW = maxX - minX;
    const graphH = maxY - minY;
    const scaleX = svgSize.width / graphW;
    const scaleY = svgSize.height / graphH;
    const newZoom = Math.min(scaleX, scaleY, 1.5);
    setZoom(newZoom);
    setPan({
      x: (svgSize.width - graphW * newZoom) / 2 - minX * newZoom,
      y: (svgSize.height - graphH * newZoom) / 2 - minY * newZoom,
    });
  };

  // ── Pan handlers ─────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (panLocked) return;
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    panOrigin.current = { x: pan.x, y: pan.y };
  }, [pan, panLocked]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setPan({ x: panOrigin.current.x + dx, y: panOrigin.current.y + dy });
  }, []);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);

  // Expose controls
  useEffect(() => {
    onControlsReady?.({
      processAreaScale: zoom,
      onProcessAreaScaleChange: setZoom,
      autoZoomEnabled: !panLocked,
      onAutoZoomToggle: () => setPanLocked((v) => !v),
      minScale: 0.2,
      maxScale: 4,
      scaleStep: 0.05,
    });
  }, [zoom, panLocked, onControlsReady]);

  // ── Resolve height ──────────────────────────────────────────────────────────
  const computedHeight = typeof height === 'number' ? `${height}px` : height;

  // ── Render graph edges ──────────────────────────────────────────────────────
  const renderedEdges = useMemo(() => {
    return edges.map((edge) => {
      const src = nodePos.get(edge.from);
      const tgt = nodePos.get(edge.to);
      if (!src || !tgt) return null;

      const color = RELATION_COLOR[edge.relation] ?? '#64748b';
      const isConcurrent = edge.relation === 'P'; // parallel = double-bar arrowhead

      // Clip line to node borders
      const srcPt = clipToBorder(src.x, src.y, tgt.x, tgt.y, NODE_W / 2 + 2, NODE_H / 2 + 2);
      const tgtPt = clipToBorder(tgt.x, tgt.y, src.x, src.y, NODE_W / 2 + 8, NODE_H / 2 + 8);

      // Arrowhead at target
      const arrow = arrowPath(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, 9);

      // Bubble midpoint (slightly offset to avoid overlap)
      const bubblePt = midpointOffset(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y, 0);

      // Source label position (near source endpoint)
      const labelT = 0.22;
      const labelX = srcPt.x + (tgtPt.x - srcPt.x) * labelT;
      const labelY = srcPt.y + (tgtPt.y - srcPt.y) * labelT;

      // Small offset for readability
      const dx = tgtPt.x - srcPt.x;
      const dy = tgtPt.y - srcPt.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const perpX = -dy / len;
      const perpY = dx / len;

      return (
        <g key={edge.id}>
          {/* Main arc line */}
          <line
            x1={srcPt.x} y1={srcPt.y}
            x2={tgtPt.x} y2={tgtPt.y}
            stroke={color}
            strokeWidth={isConcurrent ? 2 : 1.5}
            strokeDasharray={edge.relation === 'I' ? '6 3' : undefined}
          />

          {/* Arrowhead */}
          <path d={arrow} fill={color} />

          {/* Source square terminator */}
          <rect
            x={srcPt.x - SQUARE_SIZE / 2}
            y={srcPt.y - SQUARE_SIZE / 2}
            width={SQUARE_SIZE}
            height={SQUARE_SIZE}
            fill={color}
            transform={`rotate(${Math.atan2(dy, dx) * 180 / Math.PI}, ${srcPt.x}, ${srcPt.y})`}
          />

          {/* Parallel double-bar (P relation) */}
          {isConcurrent && (
            <>
              <line
                x1={srcPt.x + perpX * 5} y1={srcPt.y + perpY * 5}
                x2={srcPt.x + perpX * 5 + dx * 0.08} y2={srcPt.y + perpY * 5 + dy * 0.08}
                stroke={color} strokeWidth={2}
              />
              <line
                x1={srcPt.x - perpX * 5} y1={srcPt.y - perpY * 5}
                x2={srcPt.x - perpX * 5 + dx * 0.08} y2={srcPt.y - perpY * 5 + dy * 0.08}
                stroke={color} strokeWidth={2}
              />
            </>
          )}

          {/* Source label (log cardinality), e.g. "1,*" */}
          {edge.sourceLabel && (
            <text
              x={labelX + perpX * 11}
              y={labelY + perpY * 11}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
              fontWeight="500"
              fill={color}
            >
              {edge.sourceLabel}
            </text>
          )}

          {/* Bubble (EC | LC) at midpoint */}
          {edge.bubbleLabel && (
            <g>
              <ellipse
                cx={bubblePt.x}
                cy={bubblePt.y}
                rx={OVAL_RX}
                ry={OVAL_RY}
                fill="white"
                stroke={color}
                strokeWidth={1.2}
              />
              <text
                x={bubblePt.x}
                y={bubblePt.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9.5}
                fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
                fontWeight="600"
                fill={color}
              >
                {edge.bubbleLabel}
              </text>
            </g>
          )}
        </g>
      );
    });
  }, [edges, nodePos]);

  // ── Render nodes ────────────────────────────────────────────────────────────
  const renderedNodes = useMemo(() =>
    layoutNodes.map((n) => (
      <g key={n.id} transform={`translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})`}>
        <rect
          width={NODE_W}
          height={NODE_H}
          rx={NODE_R}
          ry={NODE_R}
          fill={n.color}
          stroke="rgba(0,0,0,0.18)"
          strokeWidth={1}
        />
        <text
          x={NODE_W / 2}
          y={NODE_H / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={12}
          fontWeight={600}
          fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
          fill={n.textColor}
        >
          {n.id}
        </text>
      </g>
    )),
    [layoutNodes],
  );

  // ── Legend for relation types ────────────────────────────────────────────────
  const relationTypes = useMemo(
    () => [...new Set(edges.map((e) => e.relation))],
    [edges],
  );
  const RELATION_LABEL: Record<string, string> = {
    D: 'Dependent', Di: 'Dependent (inv.)', P: 'Parallel', I: 'Independent', A: 'Abstract',
  };

  const visualizerCore = (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: computedHeight, background: '#f8fafc', overflow: 'hidden', cursor: panLocked ? 'default' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Empty state */}
      {!eventLogId && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,250,252,0.85)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderRadius: 12, border: '1px solid #e2e8f0', background: 'white', padding: '20px 28px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>TOTeM Miner</span>
            <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Select an event log to discover its TOTeM model.</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 14px', color: '#991b1b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(4px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', padding: '10px 20px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #2563eb', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: '#475569' }}>Discovering TOTeM model…</span>
          </div>
        </div>
      )}

      {/* Top HUD: Fitness / Precision / τ */}
      <div
        style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20, display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(255,255,255,0.94)', border: '1px solid #e2e8f0',
          borderRadius: 9999, padding: '5px 14px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.07)', pointerEvents: 'none',
          backdropFilter: 'blur(6px)', fontSize: 12,
        }}
      >
        <span style={{ color: '#64748b', fontWeight: 500 }}>
          Fitness:&nbsp;<span style={{ fontWeight: 700, color: fitness != null ? '#ea580c' : '#94a3b8' }}>
            {fitness != null ? fitness.toFixed(2) : '—'}
          </span>
        </span>
        <span style={{ color: '#e2e8f0' }}>|</span>
        <span style={{ color: '#64748b', fontWeight: 500 }}>
          Precision:&nbsp;<span style={{ fontWeight: 700, color: '#0f172a' }}>
            {precision != null ? precision.toFixed(2) : '—'}
          </span>
        </span>
        <span style={{ color: '#e2e8f0' }}>|</span>
        <span style={{ color: '#64748b', fontWeight: 500 }}>
          τ:&nbsp;<span style={{ fontWeight: 700, color: '#0f172a' }}>{tau.toFixed(2)}</span>
        </span>
      </div>

      {/* SVG canvas */}
      <svg
        ref={svgRef}
        width={svgSize.width}
        height={svgSize.height}
        style={{ display: 'block', userSelect: 'none' }}
      >
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Edges first (below nodes) */}
          {renderedEdges}
          {/* Nodes on top */}
          {renderedNodes}
        </g>
      </svg>

      {/* Bottom-right zoom controls */}
      <div
        style={{
          position: 'absolute', bottom: 14, left: 14, zIndex: 20,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}
      >
        {[
          { icon: <ZoomIn size={15} />, action: handleZoomIn, title: 'Zoom in' },
          { icon: <ZoomOut size={15} />, action: handleZoomOut, title: 'Zoom out' },
          { icon: <Maximize2 size={15} />, action: handleFit, title: 'Fit view' },
          { icon: panLocked ? <Lock size={15} /> : <Unlock size={15} />, action: () => setPanLocked((v) => !v), title: panLocked ? 'Unlock pan' : 'Lock pan' },
        ].map((btn, i) => (
          <button
            key={i}
            onClick={btn.action}
            title={btn.title}
            style={{
              width: 30, height: 30, borderRadius: 6, border: '1px solid #e2e8f0',
              background: 'rgba(255,255,255,0.92)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#475569', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              backdropFilter: 'blur(4px)',
            }}
          >
            {btn.icon}
          </button>
        ))}
      </div>

      {/* Bottom-right legend */}
      {relationTypes.length > 0 && (
        <div
          style={{
            position: 'absolute', bottom: 14, right: 14, zIndex: 20,
            background: 'rgba(255,255,255,0.92)', border: '1px solid #e2e8f0',
            borderRadius: 8, padding: '8px 12px', fontSize: 11,
            boxShadow: '0 1px 6px rgba(0,0,0,0.06)', backdropFilter: 'blur(4px)',
            display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none',
          }}
        >
          {relationTypes.map((rel) => (
            <div key={rel} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <svg width={24} height={10}>
                <line x1={0} y1={5} x2={24} y2={5}
                  stroke={RELATION_COLOR[rel] ?? '#64748b'}
                  strokeWidth={rel === 'P' ? 2 : 1.5}
                  strokeDasharray={rel === 'I' ? '4 2' : undefined}
                />
              </svg>
              <span style={{ color: '#475569', fontWeight: 500 }}>
                {RELATION_LABEL[rel] ?? rel}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (embedded) return visualizerCore;

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
      <CardContent className="p-0 flex-1 min-h-0">
        {visualizerCore}
      </CardContent>
    </Card>
  );
}

export default TotemMinerVisualizer;
