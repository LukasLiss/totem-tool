/**
 * SVG renderer of a lab layout. Draws exactly what the layout computed, so
 * every routing/port/arrow variant is visible as is. Supports pan & zoom
 * (interactive mode) or a fixed fit (thumbnails in the gallery).
 */
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { backgroundForTypes, textColorForBackground } from '@/utils/objectColors';
import { HoverTooltip, type TooltipRow } from '../MetricTooltip';
import { dist, pathD, pointAt, polylineLength, trimEnd } from './geometry';
import type { LayoutOptions, LayoutResult, PlacedNode, Pt, RoutedArc } from './types';

export interface LabCanvasHandle {
  fit: () => void;
  zoom: (factor: number) => void;
  svg: () => SVGSVGElement | null;
}

export type ViewBox = { x: number; y: number; w: number; h: number };

interface LabCanvasProps {
  result: LayoutResult;
  /** Controlled view (e.g. zoom shared between gallery cells). */
  view?: ViewBox | null;
  onViewChange?: (view: ViewBox) => void;
  options: LayoutOptions;
  colors: Record<string, string>;
  interactive?: boolean;
  /** Pan and zoom with mouse/wheel (hover highlighting works either way). */
  panZoom?: boolean;
  /** Flowing dashes along the arcs. */
  animate?: boolean;
  /** Screen space (px) kept free around the graph when fitting, e.g. for a legend. */
  fitPadding?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
  /** Largest zoom used when fitting a small graph. */
  maxFitScale?: number;
  /** Changes of this key re-fit the view even after the user panned/zoomed. */
  fitKey?: string;
  highlightType?: string | null;
  className?: string;
}

/** Hovered element and the pointer position (viewport coordinates). */
type Hover =
  | { kind: 'arc'; arc: RoutedArc; x: number; y: number }
  | { kind: 'node'; node: PlacedNode; x: number; y: number }
  | null;

const PAD = 36;
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const LabCanvas = forwardRef<LabCanvasHandle, LabCanvasProps>(function LabCanvas(
  {
    result,
    options,
    colors,
    interactive = true,
    panZoom = interactive,
    animate = false,
    fitPadding,
    maxFitScale = 1.6,
    fitKey,
    highlightType = null,
    className,
    view: controlledView,
    onViewChange,
  },
  ref,
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gid = useId().replace(/:/g, '');
  // Container size, to fit with padding in screen pixels.
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setSize((prev) => (prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const padKey = JSON.stringify(fitPadding ?? {});
  const fitBox = useMemo(() => {
    const b = result.bounds;
    if (!Number.isFinite(b.minX)) return { x: -100, y: -100, w: 200, h: 200 };
    const bw = Math.max(40, b.maxX - b.minX);
    const bh = Math.max(40, b.maxY - b.minY);
    if (size.w < 40 || size.h < 40) {
      return { x: b.minX - PAD, y: b.minY - PAD, w: bw + 2 * PAD, h: bh + 2 * PAD };
    }
    const p = { top: PAD / 2, right: PAD / 2, bottom: PAD / 2, left: PAD / 2, ...JSON.parse(padKey) };
    const availW = Math.max(40, size.w - p.left - p.right);
    const availH = Math.max(40, size.h - p.top - p.bottom);
    const s = Math.min(availW / bw, availH / bh, maxFitScale);
    const offX = p.left + (availW - bw * s) / 2;
    const offY = p.top + (availH - bh * s) / 2;
    return { x: b.minX - offX / s, y: b.minY - offY / s, w: size.w / s, h: size.h / s };
  }, [result.bounds, size, padKey, maxFitScale]);
  const [ownView, setOwnView] = useState(fitBox);
  const view = controlledView ?? ownView;
  const viewRef = useRef(view);
  viewRef.current = view;
  const setView = useCallback(
    (next: ViewBox | ((v: ViewBox) => ViewBox)) => {
      const v = typeof next === 'function' ? next(viewRef.current) : next;
      if (onViewChange) onViewChange(v);
      else setOwnView(v);
    },
    [onViewChange],
  );
  const userMoved = useRef(false);
  const lastFitKey = useRef(fitKey);

  useEffect(() => {
    if (lastFitKey.current !== fitKey) {
      lastFitKey.current = fitKey;
      userMoved.current = false;
    }
    if (!onViewChange && (!userMoved.current || !interactive)) setOwnView(fitBox);
  }, [fitBox, fitKey, interactive, onViewChange]);

  const scaleOf = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return 1;
    return Math.max(view.w / Math.max(1, el.clientWidth), view.h / Math.max(1, el.clientHeight));
  }, [view]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v: ViewBox) => {
      const px = cx ?? v.x + v.w / 2;
      const py = cy ?? v.y + v.h / 2;
      const w = Math.min(20000, Math.max(40, v.w * factor));
      const h = (v.h * w) / v.w;
      return { x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h };
    });
    userMoved.current = true;
  }, [setView]);

  useImperativeHandle(ref, () => ({
    fit: () => {
      userMoved.current = false;
      setView(fitBox);
    },
    zoom: (f) => zoomAt(f),
    svg: () => svgRef.current,
  }), [fitBox, zoomAt, setView]);

  // Wheel zoom must be a non-passive listener to prevent page scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !panZoom) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = el.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = el.getScreenCTM();
      const p = ctm ? pt.matrixTransform(ctm.inverse()) : { x: undefined, y: undefined };
      zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [panZoom, zoomAt]);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!panZoom || e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const s = scaleOf();
    const d = drag.current;
    setView((v: ViewBox) => ({ ...v, x: d.vx - (e.clientX - d.x) * s, y: d.vy - (e.clientY - d.y) * s }));
    userMoved.current = true;
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const [hover, setHover] = useState<Hover>(null);
  const hoverNode = hover?.kind === 'node' ? hover.node.id : null;
  const relPos = (e: React.MouseEvent) => ({ x: e.clientX, y: e.clientY });

  // Hovering a lane title highlights that object type, like the legend does.
  const [laneHover, setLaneHover] = useState<string | null>(null);
  const activeType = laneHover ?? highlightType;
  // Nodes directly connected to the hovered node (arcs in either direction).
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!hoverNode) return set;
    set.add(hoverNode);
    for (const a of result.arcs) {
      if (a.source === hoverNode) set.add(a.target);
      if (a.target === hoverNode) set.add(a.source);
    }
    return set;
  }, [hoverNode, result.arcs]);
  const arcById = useMemo(() => new Map(result.arcs.map((a) => [a.id, a])), [result.arcs]);

  const dimArc = (a: { type: string; source?: string; target?: string }) => {
    if (activeType && a.type !== activeType) return true;
    if (hoverNode && a.source !== hoverNode && a.target !== hoverNode) return true;
    return false;
  };
  const dimNode = (n: PlacedNode) => {
    if (activeType && !n.types.includes(activeType)) return true;
    if (hoverNode && !neighbours.has(n.id)) return true;
    return false;
  };
  /** Trunks and junctions of merge points follow the arcs they join. */
  const dimJoined = (arcIds: string[]) => arcIds.every((id) => {
    const a = arcById.get(id);
    return !a || dimArc(a);
  });

  const color = (t: string) => colors[t] ?? '#64748b';
  const o = options;

  return (
    <div ref={wrapRef} className={`relative h-full w-full overflow-hidden ${className ?? ''}`}>
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        width="100%"
        height="100%"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        className={animate ? 'ocdfg-animate' : undefined}
        style={{ cursor: panZoom ? (drag.current ? 'grabbing' : 'grab') : 'default', fontFamily: FONT, background: '#ffffff', touchAction: panZoom ? 'none' : 'auto' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label="OC-DFG layout"
      >
        {animate && (
          <style>{`@keyframes ocdfg-layout-flow { to { stroke-dashoffset: -20; } }
.ocdfg-animate .ocdfg-arc-body { stroke-dasharray: 10 10; animation: ocdfg-layout-flow 0.9s linear infinite; }`}</style>
        )}
        <defs>
          {o.nodeStyle === 'gradient' &&
            result.nodes
              .filter((n) => n.kind === 'activity' && n.types.length > 1)
              .map((n) => (
                <linearGradient key={n.id} id={`${gid}-g-${cssId(n.id)}`} x1="0" y1="0" x2="1" y2="1">
                  {n.types.map((t, i) => (
                    <stop key={t} offset={`${(i / Math.max(1, n.types.length - 1)) * 100}%`} stopColor={color(t)} />
                  ))}
                </linearGradient>
              ))}
        </defs>

        {o.showLanes &&
          result.lanes.map((l) => {
            const { x: tx, y: ty, anchor } = l.label;
            // Generous invisible hit area around the title.
            const hitW = l.label.width + 16;
            const hitX = anchor === 'start' ? tx - 8 : anchor === 'end' ? tx - hitW + 8 : tx - hitW / 2;
            const active = laneHover === l.type;
            return (
              <g key={`lane-${l.type}`} opacity={activeType && activeType !== l.type ? 0.35 : 1}>
                <rect x={l.x} y={l.y} width={l.width} height={l.height} rx={12} fill={color(l.type)} fillOpacity={active ? 0.1 : 0.06} stroke={color(l.type)} strokeOpacity={active ? 0.45 : 0.18} strokeDasharray="4 4" />
                <g
                  data-testid={`lane-title-${l.type}`}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setLaneHover(l.type)}
                  onMouseLeave={() => setLaneHover((t) => (t === l.type ? null : t))}
                >
                  <rect x={hitX} y={ty - 11} width={hitW} height={22} rx={4} fill={color(l.type)} fillOpacity={active ? 0.12 : 0} />
                  <text
                    x={tx}
                    y={ty}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                    fontSize={11}
                    fontWeight={active ? 700 : 600}
                    fill={color(l.type)}
                    opacity={active ? 1 : 0.8}
                    pointerEvents="none"
                    style={{ letterSpacing: 0.5, textTransform: 'uppercase' }}
                  >
                    {l.type}
                  </text>
                  <title>{`Highlight ${l.type}`}</title>
                </g>
              </g>
            );
          })}

        {o.showRanks &&
          result.rankLines.map((r, i) => (
            <line key={`rank-${i}`} x1={r.a.x} y1={r.a.y} x2={r.b.x} y2={r.b.y} stroke="#94a3b8" strokeOpacity={0.35} strokeDasharray="2 6" />
          ))}

        {/* Halos first, so crossings read as over/under. */}
        {o.arcHalo &&
          result.arcs.map((a) =>
            a.mergedGroup && a.mergedGroup.index > 0 ? null : (
              <path key={`halo-${a.id}`} d={pathD(a.points)} fill="none" stroke="#ffffff" strokeWidth={a.width + 3.5} strokeLinecap="round" strokeLinejoin="round" opacity={dimArc(a) ? 0.3 : 1} />
            ),
          )}

        {result.arcs.map((a) => (
          <ArcShape
            key={a.id}
            arc={a}
            color={color(a.type)}
            options={o}
            dim={dimArc(a)}
            onEnter={(e) => setHover({ kind: 'arc', arc: a, ...relPos(e) })}
            onLeave={() => setHover(null)}
          />
        ))}

        {result.trunks.map((t, i) => {
          const head = t.arrow ? arrowHead(t.points, t.width, o) : null;
          const pts = head ? trimEnd(t.points, head.trim) : t.points;
          return (
            <g key={`trunk-${i}`} opacity={dimJoined(t.arcs) ? 0.08 : o.arcOpacity}>
              <path d={pathD(pts)} fill="none" stroke={color(t.type)} strokeWidth={t.width} strokeLinecap="butt" />
              {head && <HeadShape head={head} color={color(t.type)} width={t.width} />}
            </g>
          );
        })}
        {result.junctions.map((j, i) => (
          <circle key={`j-${i}`} cx={j.x} cy={j.y} r={3.2} fill="#ffffff" stroke={color(j.type)} strokeWidth={2} opacity={dimJoined(j.arcs) ? 0.15 : 1} />
        ))}

        {result.selfLoops.map((s, i) => {
          const c = color(s.type);
          const dim = (activeType !== null && activeType !== s.type) || (hoverNode !== null && hoverNode !== s.node);
          if (s.style === 'badge') {
            return (
              <g key={`self-${i}`} opacity={dim ? 0.2 : 1}>
                <circle cx={s.center.x} cy={s.center.y} r={s.radius} fill="#ffffff" stroke={c} strokeWidth={1.6} />
                <text x={s.center.x} y={s.center.y + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={700} fill={c}>
                  ↻
                </text>
                <title>{`${s.type} self loop · ${s.weight}`}</title>
              </g>
            );
          }
          const head = arrowHead(s.points, s.width, o);
          const pts = head ? trimEnd(s.points, head.trim) : s.points;
          return (
            <g key={`self-${i}`} opacity={dim ? 0.15 : o.arcOpacity}>
              {o.arcHalo && <path d={pathD(s.points)} fill="none" stroke="#fff" strokeWidth={s.width + 3} />}
              <path d={pathD(pts)} fill="none" stroke={c} strokeWidth={s.width} strokeLinecap="round" />
              {head && <HeadShape head={head} color={c} width={s.width} />}
              <title>{`${s.type} self loop · ${s.weight}`}</title>
            </g>
          );
        })}

        {result.nodes.map((n) => (
          <NodeShape
            key={n.id}
            node={n}
            options={o}
            color={color}
            gradientId={`${gid}-g-${cssId(n.id)}`}
            dim={dimNode(n)}
            onEnter={(e) => setHover({ kind: 'node', node: n, ...relPos(e) })}
            onLeave={() => setHover(null)}
          />
        ))}

        {o.arcLabels === 'frequency' &&
          result.arcs.map((a) =>
            a.labelPos && (!a.mergedGroup || a.mergedGroup.index === 0) ? (
              <text
                key={`lbl-${a.id}`}
                x={a.labelPos.x}
                y={a.labelPos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={10}
                fill={a.mergedGroup ? '#334155' : color(a.type)}
                stroke="#ffffff"
                strokeWidth={3}
                paintOrder="stroke"
                opacity={dimArc(a) ? 0.2 : 1}
                pointerEvents="none"
              >
                {a.mergedGroup ? a.mergedGroup.types.length + '×' : a.weight}
              </text>
            ) : null,
          )}
      </svg>

      {interactive && hover && <HoverTooltip x={hover.x} y={hover.y} title={tooltipTitle(result, hover)} rows={tooltipRows(hover)} />}
    </div>
  );
});

export default LabCanvas;

// ---------------------------------------------------------------------------

function cssId(s: string) {
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `_${c.charCodeAt(0)}`);
}

function tooltipTitle(result: LayoutResult, hover: NonNullable<Hover>): string {
  if (hover.kind === 'arc') return `${labelOf(result, hover.arc.source)} → ${labelOf(result, hover.arc.target)}`;
  const n = hover.node;
  return n.kind === 'activity' ? n.label : `${n.objectType} ${n.kind}`;
}

function tooltipRows(hover: NonNullable<Hover>): TooltipRow[] {
  if (hover.kind === 'arc') {
    const rows: TooltipRow[] = [
      { label: 'Object type', value: hover.arc.type },
      { label: 'Frequency', value: hover.arc.weight.toLocaleString() },
    ];
    if (hover.arc.avgLeadTime != null) rows.push({ label: 'Avg Time', value: formatDuration(hover.arc.avgLeadTime) });
    return rows;
  }
  const rows: TooltipRow[] = [];
  if (hover.node.kind === 'activity') rows.push({ label: 'Frequency', value: hover.node.frequency.toLocaleString() });
  rows.push({ label: hover.node.types.length > 1 ? 'Object types' : 'Object type', value: hover.node.types.join(', ') });
  return rows;
}

function labelOf(result: LayoutResult, id: string) {
  const n = result.nodes.find((x) => x.id === id);
  if (!n) return id;
  return n.kind === 'activity' ? n.label : `${n.objectType} ${n.kind}`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 120) return `${Math.round(seconds)} s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} d`;
}

interface Head {
  kind: 'fill' | 'stroke' | 'circle';
  pts: Pt[];
  trim: number;
  r?: number;
  c?: Pt;
}

function endDirection(points: Pt[]): { tip: Pt; d: Pt } | null {
  if (points.length < 2) return null;
  const tip = points[points.length - 1];
  for (let i = points.length - 2; i >= 0; i--) {
    const l = dist(points[i], tip);
    if (l > 2) return { tip, d: { x: (tip.x - points[i].x) / l, y: (tip.y - points[i].y) / l } };
  }
  return null;
}

function arrowHead(points: Pt[], width: number, o: LayoutOptions): Head | null {
  if (o.arrowStyle === 'none' || o.arrowStyle === 'chevrons' || o.arrowStyle === 'tapered') return null;
  const e = endDirection(points);
  if (!e) return null;
  const { tip, d } = e;
  const n = { x: -d.y, y: d.x };
  const s = (6 + width * 1.5) * o.arrowSize;
  const base = { x: tip.x - d.x * s, y: tip.y - d.y * s };
  const halfW = s * 0.55;
  const l = { x: base.x + n.x * halfW, y: base.y + n.y * halfW };
  const r = { x: base.x - n.x * halfW, y: base.y - n.y * halfW };
  switch (o.arrowStyle) {
    case 'triangle':
      return { kind: 'fill', pts: [tip, l, r], trim: s * 0.8 };
    case 'stealth': {
      const inner = { x: tip.x - d.x * s * 0.62, y: tip.y - d.y * s * 0.62 };
      const l2 = { x: tip.x - d.x * s * 1.1 + n.x * halfW, y: tip.y - d.y * s * 1.1 + n.y * halfW };
      const r2 = { x: tip.x - d.x * s * 1.1 - n.x * halfW, y: tip.y - d.y * s * 1.1 - n.y * halfW };
      return { kind: 'fill', pts: [tip, l2, inner, r2], trim: s * 0.6 };
    }
    case 'open':
      return { kind: 'stroke', pts: [l, tip, r], trim: Math.max(1, width * 0.5) };
    case 'circle': {
      const rr = Math.max(2.6, width * 0.95) * o.arrowSize;
      return { kind: 'circle', pts: [], trim: rr * 1.6, r: rr, c: { x: tip.x - d.x * rr, y: tip.y - d.y * rr } };
    }
    default:
      return null;
  }
}

function HeadShape({ head, color, width }: { head: Head; color: string; width: number }) {
  if (head.kind === 'circle') return <circle cx={head.c!.x} cy={head.c!.y} r={head.r} fill={color} />;
  const d = pathD(head.pts) + (head.kind === 'fill' ? 'Z' : '');
  return head.kind === 'fill' ? (
    <path d={d} fill={color} />
  ) : (
    <path d={d} fill="none" stroke={color} strokeWidth={Math.max(1.4, width * 0.75)} strokeLinecap="round" strokeLinejoin="round" />
  );
}

function ArcShape({
  arc,
  color,
  options: o,
  dim,
  onEnter,
  onLeave,
}: {
  arc: RoutedArc;
  color: string;
  options: LayoutOptions;
  dim: boolean;
  onEnter: (e: React.MouseEvent) => void;
  onLeave: () => void;
}) {
  const interleave = arc.cls === 'interleave' && o.parallelArcs === 'dimmed';
  const opacity = dim ? 0.08 : interleave ? Math.min(0.45, o.arcOpacity) : o.arcOpacity;
  const head = arc.arrow && (!arc.mergedGroup || arc.mergedGroup.index === 0) ? arrowHead(arc.points, arc.width, o) : null;
  const pts = head ? trimEnd(arc.points, head.trim) : arc.points;
  const dash = interleave ? `${Math.max(3, arc.width * 2)} ${Math.max(3, arc.width * 2)}` : undefined;
  const headColor = arc.mergedGroup ? '#334155' : color;

  let body: React.ReactNode;
  if (arc.mergedGroup) {
    const L = 9;
    const n = arc.mergedGroup.size;
    body = (
      <path
        d={pathD(pts)}
        fill="none"
        stroke={color}
        strokeWidth={arc.width}
        strokeDasharray={`${L} ${L * (n - 1)}`}
        strokeDashoffset={-arc.mergedGroup.index * L}
        strokeLinecap="butt"
      />
    );
  } else if (o.arrowStyle === 'tapered' && arc.arrow) {
    const pieces = 10;
    const total = polylineLength(pts);
    const parts: React.ReactNode[] = [];
    for (let i = 0; i < pieces; i++) {
      const sub = slice(pts, (i / pieces) * total, ((i + 1) / pieces) * total);
      const w = arc.width * (1.7 - (1.35 * i) / (pieces - 1));
      parts.push(<path key={i} d={pathD(sub)} fill="none" stroke={color} strokeWidth={Math.max(0.6, w)} strokeLinecap="round" strokeDasharray={dash} />);
    }
    body = <>{parts}</>;
  } else {
    body = (
      <path
        className={dash ? undefined : 'ocdfg-arc-body'}
        d={pathD(pts)}
        fill="none"
        stroke={color}
        strokeWidth={arc.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
      />
    );
  }

  let chevrons: React.ReactNode = null;
  if (o.arrowStyle === 'chevrons' && arc.arrow && (!arc.mergedGroup || arc.mergedGroup.index === 0)) {
    const total = polylineLength(arc.points);
    const count = Math.max(1, Math.floor(total / 70));
    const marks: React.ReactNode[] = [];
    for (let i = 1; i <= count; i++) {
      const { p, dir } = pointAt(arc.points, i / (count + 1));
      const s = (3.5 + arc.width * 0.9) * o.arrowSize;
      const n = { x: -dir.y, y: dir.x };
      const a = { x: p.x - dir.x * s + n.x * s, y: p.y - dir.y * s + n.y * s };
      const b = { x: p.x - dir.x * s - n.x * s, y: p.y - dir.y * s - n.y * s };
      marks.push(
        <path
          key={i}
          d={pathD([a, p, b])}
          fill="none"
          stroke={arc.mergedGroup ? '#ffffff' : '#ffffff'}
          strokeWidth={Math.max(1.2, arc.width * 0.45)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.95}
        />,
      );
    }
    chevrons = marks;
  }

  return (
    <g opacity={opacity} onMouseEnter={onEnter} onMouseLeave={onLeave} data-arc-id={arc.id}>
      {/* Wide transparent hit area for hovering thin arcs. */}
      <path d={pathD(arc.points)} fill="none" stroke="transparent" strokeWidth={Math.max(8, arc.width + 6)} />
      {body}
      {head && <HeadShape head={head} color={headColor} width={arc.width} />}
      {chevrons}
    </g>
  );
}

/** Sub-polyline between two arc-length positions. */
function slice(points: Pt[], from: number, to: number): Pt[] {
  const out: Pt[] = [];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const l = dist(a, b);
    const s = acc;
    const e = acc + l;
    if (e >= from && s <= to && l > 0) {
      const t0 = Math.max(0, (from - s) / l);
      const t1 = Math.min(1, (to - s) / l);
      const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      if (out.length === 0) out.push(p0);
      out.push(p1);
    }
    acc = e;
  }
  return out;
}

function NodeShape({
  node: n,
  options: o,
  color,
  gradientId,
  dim,
  onEnter,
  onLeave,
}: {
  node: PlacedNode;
  options: LayoutOptions;
  color: (t: string) => string;
  gradientId: string;
  dim: boolean;
  onEnter: (e: React.MouseEvent) => void;
  onLeave: () => void;
}) {
  const x = n.x - n.width / 2;
  const y = n.y - n.height / 2;
  const common = { opacity: dim ? 0.3 : 1, onMouseEnter: onEnter, onMouseLeave: onLeave, 'data-node-id': n.id };
  const horizontal = o.direction === 'LR' || o.direction === 'RL';

  if (n.kind !== 'activity') {
    const c = color(n.objectType ?? n.types[0]);
    const isStart = n.kind === 'start';
    // Label beside the terminal, away from the flow.
    const label = n.label;
    const lx = horizontal ? n.x : n.x + n.width / 2 + 6;
    const ly = horizontal ? (n.y - n.height / 2 - 8) : n.y;
    const anchor = horizontal ? 'middle' : 'start';
    const text = o.terminalStyle !== 'pill' && (
      <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize={11} fontWeight={600} fill={c}>
        {label}
      </text>
    );
    switch (o.terminalStyle) {
      case 'pill':
        return (
          <g {...common}>
            <rect x={x} y={y} width={n.width} height={n.height} rx={n.height / 2} fill={c} />
            <text x={n.x} y={n.y + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={600} fill="#ffffff">
              {isStart ? `▶ ${label}` : `${label} ■`}
            </text>
          </g>
        );
      case 'dot':
        return (
          <g {...common}>
            <circle cx={n.x} cy={n.y} r={isStart ? 6 : 5} fill={isStart ? c : '#ffffff'} stroke={c} strokeWidth={2.5} />
            {text}
          </g>
        );
      case 'bar':
        return (
          <g {...common}>
            <rect x={x} y={y} width={n.width} height={n.height} rx={2} fill={c} />
            {text}
          </g>
        );
      default:
        return (
          <g {...common}>
            <circle cx={n.x} cy={n.y} r={n.width / 2} fill={c} stroke="#ffffff" strokeWidth={2} />
            {isStart ? (
              <path d={`M${n.x - 3.5},${n.y - 5.5}L${n.x + 5.5},${n.y}L${n.x - 3.5},${n.y + 5.5}Z`} fill="#ffffff" />
            ) : (
              <rect x={n.x - 4.5} y={n.y - 4.5} width={9} height={9} rx={1} fill="#ffffff" />
            )}
            {text}
          </g>
        );
    }
  }

  const label = truncate(n.label, Math.floor((n.width - 14) / 6.2));
  const freq = o.showFrequencies ? <tspan fontSize={10} fill="#64748b">{n.frequency.toLocaleString()}</tspan> : null;
  const labelY = o.showFrequencies ? n.y - 5 : n.y + 0.5;

  switch (o.nodeStyle) {
    case 'gradient': {
      const bg = n.types.length > 1 ? `url(#${gradientId})` : color(n.types[0]);
      const css = backgroundForTypes(n.types, Object.fromEntries(n.types.map((t) => [t, color(t)])));
      const fg = textColorForBackground(css);
      return (
        <g {...common}>
          <rect x={x} y={y} width={n.width} height={n.height} rx={8} fill={bg} stroke="#ffffff" strokeWidth={1.5} />
          <text x={n.x} y={labelY} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={600} fill={fg}>
            {label}
          </text>
          {o.showFrequencies && (
            <text x={n.x} y={n.y + 11} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill={fg} opacity={0.85}>
              {n.frequency.toLocaleString()}
            </text>
          )}
        </g>
      );
    }
    case 'pill': {
      const c = color(n.types[0]);
      return (
        <g {...common}>
          <rect x={x} y={y} width={n.width} height={n.height} rx={n.height / 2} fill="#ffffff" />
          <rect x={x} y={y} width={n.width} height={n.height} rx={n.height / 2} fill={c} fillOpacity={0.12} stroke={c} strokeWidth={1.6} />
          <text x={n.x} y={labelY} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={600} fill="#0f172a">
            {label}
          </text>
          {o.showFrequencies && (
            <text x={n.x} y={n.y + 10} textAnchor="middle" dominantBaseline="middle">
              {freq}
            </text>
          )}
        </g>
      );
    }
    case 'station': {
      const dots = n.types.length;
      const spacing = 10;
      const startX = n.x - ((dots - 1) * spacing) / 2;
      return (
        <g {...common}>
          <rect x={x} y={y} width={n.width} height={n.height} rx={7} fill="#ffffff" stroke="#0f172a" strokeWidth={2.4} />
          <text x={n.x} y={o.showFrequencies ? n.y - 6 : n.y - 3} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#0f172a">
            {label}
          </text>
          {n.types.map((t, i) => (
            <circle key={t} cx={startX + i * spacing} cy={y + n.height - 9} r={3.6} fill={color(t)} />
          ))}
          {o.showFrequencies && (
            <text x={x + n.width - 6} y={y + n.height - 8} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#64748b">
              {n.frequency.toLocaleString()}
            </text>
          )}
        </g>
      );
    }
    case 'minimal': {
      const dots = n.types.length;
      return (
        <g {...common}>
          <rect x={x} y={y} width={n.width} height={n.height} rx={5} fill="#ffffff" fillOpacity={0.88} />
          {n.types.map((t, i) => (
            <circle key={t} cx={x + 7 + i * 7} cy={labelY} r={2.8} fill={color(t)} />
          ))}
          <text x={x + 10 + dots * 7} y={labelY} dominantBaseline="middle" fontSize={12} fontWeight={600} fill="#0f172a">
            {label}
          </text>
          {o.showFrequencies && (
            <text x={x + 10 + dots * 7} y={n.y + 10} dominantBaseline="middle">
              {freq}
            </text>
          )}
        </g>
      );
    }
    default: {
      const stripe = 5;
      const segW = n.width / n.types.length;
      const clipId = `${gradientId}-clip`;
      return (
        <g {...common}>
          <clipPath id={clipId}>
            <rect x={x} y={y} width={n.width} height={n.height} rx={7} />
          </clipPath>
          <rect x={x} y={y} width={n.width} height={n.height} rx={7} fill="#ffffff" />
          <g clipPath={`url(#${clipId})`}>
            {n.types.map((t, i) => (
              <rect key={t} x={x + i * segW} y={y} width={segW + 0.5} height={stripe} fill={color(t)} />
            ))}
          </g>
          <rect x={x} y={y} width={n.width} height={n.height} rx={7} fill="none" stroke="#cbd5e1" strokeWidth={1.2} />
          <text x={n.x} y={labelY + 2} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={600} fill="#0f172a">
            {label}
          </text>
          {o.showFrequencies && (
            <text x={n.x} y={n.y + 12} textAnchor="middle" dominantBaseline="middle">
              {freq}
            </text>
          )}
        </g>
      );
    }
  }
}

function truncate(s: string, max: number) {
  if (max <= 3) return s.slice(0, Math.max(1, max));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
