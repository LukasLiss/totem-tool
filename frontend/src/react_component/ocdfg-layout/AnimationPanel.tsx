/**
 * The OC-DFG's "Animation" panel: the token animation's start button, the
 * activity chart, the timeline slider and the playback row, plus the drawing
 * of the tokens into the canvas' token layer.
 *
 * Same panel, chart and controls as the OC handover animation
 * (OCHandoverExplorer: the "Animation" FloatingPanel, ActivityChart,
 * AnimPanelResizeGrip), copied with the same styling so both can be unified
 * later. The panel is opened from a button of the control pill (PillToggle)
 * and drawn in the shared CanvasPanel frame. The playback state lives here,
 * outside that frame, so closing the panel keeps the animation running.
 */
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ChevronDown, Loader2, Pause, Play, Repeat, Square } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CanvasPanel } from '@/components/canvas/CanvasPanel';
import { PANEL_ICON_BUTTON_CLASS } from '@/components/canvas/panelHeader';
import { roomBelowForPill, type PillRegion } from '@/components/canvas/pillSpots';
import {
  ACTIVITY_H,
  ACTIVITY_METRICS,
  ACTIVITY_W,
  NEUTRAL_CURVE_COLOR,
  computeAgeSeries,
  computeBalanceSeries,
  computeObjectSeries,
  fmtSigned,
  type ActivityMetric,
} from './animationCharts';
import { arcPaths, tokensAt, type TokenPath, type Tokens } from './tokenAnimation';
import type { LayoutResult } from './types';
import type { FlowsState } from './useOcdfgFlows';

/** The playback speeds (multiples of real time): 1, 2, 5, 10, 20, 50, … up to 100,000,000. */
const SPEED_STEPS: readonly number[] = Array.from({ length: 25 }, (_, i) => [1, 2, 5][i % 3] * 10 ** Math.floor(i / 3));
/** The whole log plays in about this many seconds at the initial speed (as in the handover). */
const DEFAULT_PLAY_SECONDS = 30;
const DOT_RADIUS = 4;
/** Opacity of the tokens of the other types while one type is highlighted (as their arcs). */
const FADED_TOKEN_OPACITY = 0.15;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Panel position: top right of the view. */
const ANIM_PANEL_TOP = 16;
const ANIM_PANEL_BOTTOM_CLEARANCE = 16;

/** Buttons of the playback row: the canvas panels' header buttons. */
const ANIM_ICON_BUTTON = PANEL_ICON_BUTTON_CLASS;

/** The index of the speed step closest to `target`, on a log scale (the speed slider's value). */
function speedIndex(target: number): number {
  let best = 0;
  SPEED_STEPS.forEach((s, i) => {
    if (Math.abs(Math.log(s) - Math.log(target)) < Math.abs(Math.log(SPEED_STEPS[best]) - Math.log(target))) best = i;
  });
  return best;
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 0 });
/** A speed as a multiplier: 5×, 200×, 5,000×, 20K×, 1M×. */
const fmtSpeed = (s: number) => `${s < 10000 ? s.toLocaleString('en') : COMPACT.format(s)}×`;

/**
 * The thin slider of the canvas panels (as the object type panel's filters):
 * thin slate track, the part up to the thumb darker, a small round thumb.
 * (Class names written out in full, so Tailwind finds them.)
 */
const THIN_SLIDER =
  '[&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-slate-200 [&_[data-slot=slider-range]]:bg-slate-600 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-slate-600';

// --- panel size (same as the handover's, stored under its own key) ----------
type AnimPanelSize = { width: number; chartHeight: number };
// The narrowest the panel gets: wide enough for the bottom row (play, loop,
// stop, "Speed", its slider and the longest value, "100M×") on one line.
const ANIM_PANEL_MIN: AnimPanelSize = { width: 260, chartHeight: 56 };
const ANIM_PANEL_MAX: AnimPanelSize = { width: 720, chartHeight: 420 };
const ANIM_PANEL_SIZE_KEY = 'ocdfg.animationPanelSize';

const clampAnimPanelSize = (size: AnimPanelSize): AnimPanelSize => ({
  width: Math.min(ANIM_PANEL_MAX.width, Math.max(ANIM_PANEL_MIN.width, size.width)),
  chartHeight: Math.min(ANIM_PANEL_MAX.chartHeight, Math.max(ANIM_PANEL_MIN.chartHeight, size.chartHeight)),
});

/** The size this viewer left the panel at; storage may be unavailable. */
function loadAnimPanelSize(): AnimPanelSize {
  try {
    const raw = localStorage.getItem(ANIM_PANEL_SIZE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.width === 'number' && typeof parsed?.chartHeight === 'number') {
        return clampAnimPanelSize(parsed);
      }
    }
  } catch {
    /* fall back to the default */
  }
  return ANIM_PANEL_MIN;
}

/**
 * Drag grip in the panel's bottom-left corner. The panel is pinned top right,
 * so dragging left widens it and dragging down makes the chart taller, until
 * the panel reaches the bottom of the view. The size is stored when the drag ends.
 */
function AnimPanelResizeGrip({
  size,
  onResize,
  bottomClearance,
}: {
  size: AnimPanelSize;
  onResize: (size: AnimPanelSize) => void;
  /** Room kept free below the panel (the view's edge, or the control pill). */
  bottomClearance: number;
}) {
  const drag = useRef<{ x: number; y: number; start: AnimPanelSize; last: AnimPanelSize; maxChart: number } | null>(null);
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try {
      localStorage.setItem(ANIM_PANEL_SIZE_KEY, JSON.stringify(d.last));
    } catch {
      /* not persisted */
    }
  };
  return (
    <div
      role="separator"
      aria-label="Resize animation panel"
      title="Drag to resize"
      className="absolute left-0 bottom-0 h-3.5 w-3.5 cursor-nesw-resize touch-none text-muted-foreground/60 hover:text-muted-foreground"
      onPointerDown={(e) => {
        e.preventDefault(); // no text selection while dragging
        e.currentTarget.setPointerCapture(e.pointerId);
        // The grip sits in the panel, the panel in the view: the chart may
        // grow by whatever room is left below the panel.
        const panel = e.currentTarget.offsetParent as HTMLElement | null;
        const view = panel?.offsetParent as HTMLElement | null;
        const room =
          panel && view ? view.clientHeight - ANIM_PANEL_TOP - bottomClearance - panel.scrollHeight : Infinity;
        drag.current = { x: e.clientX, y: e.clientY, start: size, last: size, maxChart: size.chartHeight + Math.max(0, room) };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.last = clampAnimPanelSize({
          width: d.start.width + (d.x - e.clientX),
          chartHeight: Math.min(d.maxChart, d.start.chartHeight + (e.clientY - d.y)),
        });
        onResize(d.last);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <svg viewBox="0 0 14 14" className="h-full w-full" aria-hidden>
        <path d="M3 4 L10 11 M3 8 L6 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// --- activity chart (the handover's ActivityChart, on DFG steps) -------------
const legendDotColor = (line: { color: string; negColor?: string }, v: number) =>
  !line.negColor ? line.color : v > 0 ? line.color : v < 0 ? line.negColor : NEUTRAL_CURVE_COLOR;
/** Chart y of `v` on a scale from `trough` (bottom) to `peak` (top) in a chart `height` tall. */
const activityY = (v: number, peak: number, trough: number, height: number) =>
  2 + ((peak - v) / (peak - trough > 0 ? peak - trough : 1)) * (height - 3);

/**
 * Curves of the selected metric, drawn above the animation slider. Clicking
 * or dragging on it scrubs, like the slider.
 */
function ActivityChart({
  tokens,
  shown,
  time,
  colors,
  onScrub,
  height = ACTIVITY_H,
  timeLabel,
  moverRef,
}: {
  tokens: Tokens;
  shown: Uint8Array;
  time: number;
  colors: Record<string, string>;
  onScrub: (time: number) => void;
  height?: number;
  /** The current moment as text, shown above the playhead. */
  timeLabel?: string;
  /**
   * Set to a function that moves the playhead (and its label) to a moment
   * directly, without a render: playback calls it on every frame.
   */
  moverRef?: RefObject<((time: number) => void) | null>;
}) {
  const [metric, setMetric] = useState<ActivityMetric>('objects');
  const metricInfo = ACTIVITY_METRICS.find((m) => m.value === metric)!;
  const series = useMemo(() => {
    if (metric === 'rate') return computeBalanceSeries(tokens, shown);
    if (metric === 'age') return computeAgeSeries(tokens, shown);
    return computeObjectSeries(tokens, shown, colors);
  }, [tokens, shown, metric, colors]);
  const values = useMemo(() => series.valueAt(time), [series, time]);

  // Clicking a legend entry shows only that line, rescaled to its own peak
  const [solo, setSolo] = useState<string | null>(null);
  const visible = useMemo(
    () => (series.lines.some((l) => l.key === solo) ? series.lines.filter((l) => l.key === solo) : series.lines),
    [series, solo],
  );
  // Scale from the lowest to the highest visible value, always including zero
  const { peak, trough } = useMemo(() => {
    let hi = 0;
    let lo = 0;
    for (const line of visible)
      for (const p of line.points) {
        if (p.v > hi) hi = p.v;
        if (p.v < lo) lo = p.v;
      }
    return { peak: hi, trough: lo };
  }, [visible]);

  const paths = useMemo(() => {
    const y = (v: number) => activityY(v, peak, trough, height).toFixed(2);
    return visible.map(({ points }) => {
      if (series.kind === 'bars') {
        let up = '';
        let down = '';
        points.forEach((p, i) => {
          if (p.v === 0) return;
          const x0 = p.x.toFixed(2);
          const x1 = (points[i + 1]?.x ?? ACTIVITY_W).toFixed(2);
          const rect = `M${x0} ${y(0)}H${x1}V${y(p.v)}H${x0}Z`;
          if (p.v > 0) up += rect;
          else down += rect;
        });
        return { up, down };
      }
      if (series.kind === 'step') {
        return { line: `M0 ${y(0)}` + points.map((p) => `H${p.x.toFixed(2)}V${y(p.v)}`).join('') + `H${ACTIVITY_W}` };
      }
      let d = '';
      let pen = false;
      for (const p of points) {
        if (!Number.isFinite(p.v)) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${p.x.toFixed(2)} ${y(p.v)}`;
        pen = true;
      }
      return { line: d };
    });
  }, [series, visible, peak, trough, height]);

  const { start, end } = tokens.timeline;
  const span = Math.max(end - start, 1e-9);
  const scrubFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onScrub(start + frac * span);
  };

  // The playhead and its label are moved directly (on every frame while
  // playing), the line snapped to whole screen pixels so it does not shimmer
  // between two; the label centred on it, kept inside the chart.
  const plotRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const shownTime = useRef(time);
  const place = useCallback(
    (t: number) => {
      shownTime.current = t;
      const plot = plotRef.current;
      if (!plot) return;
      const dpr = window.devicePixelRatio || 1;
      const snap = (px: number) => Math.round(px * dpr) / dpr;
      const width = plot.clientWidth;
      const x = snap(Math.min(1, Math.max(0, (t - start) / span)) * width);
      if (lineRef.current) lineRef.current.style.transform = `translateX(${x}px)`;
      const label = labelRef.current;
      if (label) {
        const w = label.offsetWidth;
        label.style.transform = `translateX(${snap(Math.min(Math.max(x - w / 2, 0), Math.max(0, width - w)))}px)`;
      }
    },
    [start, span],
  );
  useLayoutEffect(() => {
    place(time);
    if (moverRef) moverRef.current = place;
  }, [place, time, timeLabel, moverRef]);
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => place(shownTime.current));
    observer.observe(plot);
    return () => observer.disconnect();
  }, [place]);
  /** Keyboard on the chart, as on a slider: arrows 1 %, page keys 10 %, Home/End. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 0.01, ArrowUp: 0.01, ArrowLeft: -0.01, ArrowDown: -0.01, PageUp: 0.1, PageDown: -0.1 }[e.key];
    let next: number | null = null;
    if (step != null) next = time + step * span;
    else if (e.key === 'Home') next = start;
    else if (e.key === 'End') next = end;
    if (next == null) return;
    e.preventDefault();
    onScrub(Math.min(end, Math.max(start, next)));
  };

  return (
    <div className="flex flex-col gap-2" data-testid="ocdfg-activity-chart">
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-0.5 text-xs text-slate-700 transition-colors hover:text-slate-900" title={metricInfo.hint}>
              <span>{metricInfo.label}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={metric}
              onValueChange={(v) => {
                setMetric(v as ActivityMetric);
                setSolo(null);
              }}
            >
              {ACTIVITY_METRICS.map((m) => (
                <DropdownMenuRadioItem key={m.value} value={m.value}>
                  {m.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {timeLabel != null && (
        // Above the playhead; near the edges it keeps inside the chart.
        <div className="relative mx-2 h-3.5">
          <span
            ref={labelRef}
            data-testid="ocdfg-animation-time"
            className="absolute left-0 top-0 whitespace-nowrap text-[11px] leading-3.5 font-medium tabular-nums text-slate-600 will-change-transform"
          >
            {timeLabel}
          </span>
        </div>
      )}
      <div className="px-2">
        {/* The timeline: click or drag to a moment, or use the keys like a slider. */}
        <div
          ref={plotRef}
          className="relative cursor-pointer touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          style={{ height }}
          data-testid="ocdfg-activity-plot"
          role="slider"
          tabIndex={0}
          aria-label="Animation time"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={time}
          aria-valuetext={timeLabel}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            scrubFromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubFromPointer(e);
          }}
        >
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${ACTIVITY_W} ${height}`} preserveAspectRatio="none">
            {visible.map((line, i) =>
              series.kind === 'bars' ? (
                <g key={line.key}>
                  <path d={paths[i].up} fill={line.color} />
                  <path d={paths[i].down} fill={line.negColor ?? line.color} />
                </g>
              ) : (
                <path
                  key={line.key}
                  d={paths[i].line}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
            {/* The highest value: a faint dashed line at its height (the chart's top), labelled below. */}
            <line
              x1={0}
              x2={ACTIVITY_W}
              y1={activityY(peak, peak, trough, height)}
              y2={activityY(peak, peak, trough, height)}
              stroke="#cbd5e1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              data-testid="ocdfg-activity-peak-line"
            />
            {/* Step balance (bars) also goes below zero: the lowest value likewise, labelled above. */}
            {series.kind === 'bars' && trough < 0 && (
              <line
                x1={0}
                x2={ACTIVITY_W}
                y1={activityY(trough, peak, trough, height)}
                y2={activityY(trough, peak, trough, height)}
                stroke="#cbd5e1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                data-testid="ocdfg-activity-trough-line"
              />
            )}
            {/* Zero line, on top so it stays visible through bars */}
            <line
              x1={0}
              x2={ACTIVITY_W}
              y1={activityY(0, peak, trough, height)}
              y2={activityY(0, peak, trough, height)}
              className="text-border"
              stroke="currentColor"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span
            data-testid="ocdfg-activity-peak"
            className="pointer-events-none absolute left-0.5 rounded-sm bg-white/75 px-0.5 text-[10px] leading-3 tabular-nums text-slate-400"
            style={{ top: activityY(peak, peak, trough, height) + 2 }}
          >
            {series.kind === 'bars' ? fmtSigned(peak) : series.format(peak)}
          </span>
          {series.kind === 'bars' && trough < 0 && (
            <span
              data-testid="ocdfg-activity-trough"
              className="pointer-events-none absolute left-0.5 rounded-sm bg-white/75 px-0.5 text-[10px] leading-3 tabular-nums text-slate-400"
              style={{ top: activityY(trough, peak, trough, height) - 14 }}
            >
              {fmtSigned(trough)}
            </span>
          )}
          <div ref={lineRef} className="absolute top-0 bottom-0 left-0 w-px bg-slate-500/60 pointer-events-none will-change-transform" />
        </div>
      </div>
      <div className="flex items-start gap-2 text-[11px] text-slate-600">
        {series.footnote && <span className="text-slate-500 whitespace-nowrap">{series.footnote}</span>}
        <div className="ml-auto flex flex-wrap justify-end gap-x-3 gap-y-0.5">
          {series.lines.map((line) => (
            <button
              key={line.key}
              type="button"
              className={`flex items-center gap-1 transition-opacity${visible.includes(line) ? '' : ' opacity-40'}`}
              title={solo === line.key ? `${line.label} · click to show all` : `${line.label} · click to show only this`}
              onClick={() => setSolo((s) => (s === line.key ? null : line.key))}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: legendDotColor(line, values[line.key] ?? 0) }} />
              <span className="tabular-nums">{series.format(values[line.key] ?? 0)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- the panel -----------------------------------------------------------------
export interface AnimationPanelProps {
  /** Whether the panel is shown (the pill button); the animation runs on while it is not. */
  open: boolean;
  onClose: () => void;
  /** Whether the animation is on (its steps are loaded while it is). */
  active: boolean;
  /** Stop: the animation ends and the panel closes. */
  onStop: () => void;
  state: FlowsState;
  /** The canvas' token layer (inside its SVG, in layout coordinates). */
  layer: RefObject<SVGGElement | null>;
  result: LayoutResult | null;
  colors: Record<string, string>;
  /** Variants view: the legend's number of variants per type; objects of later variants are not animated. */
  variantLimit?: Record<string, number>;
  /** Where the view's control pill sits: the panel ends above it when it is below the panel. */
  pillRegion?: PillRegion | null;
  /** The object type highlighted in the legend (hover): the other types' tokens fade. */
  highlightType?: string | null;
}

export default function AnimationPanel({
  open,
  onClose,
  pillRegion = null,
  highlightType = null,
  active,
  onStop,
  state,
  layer,
  result,
  colors,
  variantLimit,
}: AnimationPanelProps) {
  const tokens = state.status === 'ready' ? state.tokens : null;

  // Only what is drawn moves and counts: arcs the layout draws, objects of shown variants.
  const pathByArc = useMemo((): Array<TokenPath | null> => {
    if (!tokens || !result) return [];
    const paths = arcPaths(result);
    return tokens.arcKeys.map((k) => paths.get(k) ?? null);
  }, [tokens, result]);

  const showObject = useMemo(() => {
    if (!tokens?.objectRank || !variantLimit) return undefined;
    const rank = tokens.objectRank;
    const limitByType = tokens.objectTypes.map((t) => variantLimit[t]);
    return (object: number) => {
      const limit = limitByType[tokens.objectType[object]];
      const r = rank[object];
      return limit === undefined || r === 0 || r <= limit;
    };
  }, [tokens, variantLimit]);

  const shownNow = useMemo(() => {
    const mask = new Uint8Array(tokens?.count ?? 0);
    if (!tokens) return mask;
    for (let i = 0; i < tokens.count; i++) {
      mask[i] = pathByArc[tokens.arc[i]] && (!showObject || showObject(tokens.object[i])) ? 1 : 0;
    }
    return mask;
  }, [tokens, pathByArc, showObject]);
  // The chart follows legend changes without holding up the sliders.
  const shown = useDeferredValue(shownNow);

  // --- drawing --------------------------------------------------------------
  const drawRef = useRef<(time: number) => void>(() => undefined);
  drawRef.current = (time: number) => {
    const g = layer.current;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (!tokens) return;
    // While a type is highlighted (legend hover), the others' tokens fade like
    // their arcs; the highlighted ones are drawn last, so they lie on top.
    const dots = tokensAt(tokens, pathByArc, time, showObject);
    const faded = (type: string) => highlightType != null && type !== highlightType;
    for (const pass of [true, false]) {
      for (const dot of dots) {
        if (faded(dot.type) !== pass) continue;
        const c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('cx', String(dot.x));
        c.setAttribute('cy', String(dot.y));
        c.setAttribute('r', String(DOT_RADIUS));
        c.setAttribute('fill', colors[dot.type] ?? '#64748b');
        c.setAttribute('stroke', '#ffffff');
        c.setAttribute('stroke-width', '1.2');
        if (pass) c.setAttribute('opacity', String(FADED_TOKEN_OPACITY));
        g.appendChild(c);
      }
    }
  };

  // --- playback ---------------------------------------------------------------
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(100);
  const speedStep = speedIndex(speed);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [panelSize, setPanelSize] = useState(loadAnimPanelSize);
  const timeRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const frame = useRef<number | null>(null);
  /** Moves the chart's playhead without a render (set by ActivityChart). */
  const playheadMover = useRef<((time: number) => void) | null>(null);
  const lastWall = useRef<number | null>(null);
  const frameCount = useRef(0);

  const pause = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setPlaying(false);
  }, []);

  // New data: back to its start, paused, at a speed that plays it in ~30 s.
  useEffect(() => {
    pause();
    const t = tokens ? tokens.timeline.start : 0;
    timeRef.current = t;
    setTime(t);
    if (tokens) setSpeed(SPEED_STEPS[speedIndex(Math.max(1, (tokens.timeline.end - tokens.timeline.start) / DEFAULT_PLAY_SECONDS))]);
  }, [tokens, pause]);

  // Redraw the current moment when anything but the time changes.
  useEffect(() => {
    if (!playing) drawRef.current(timeRef.current);
  }, [tokens, pathByArc, showObject, colors, highlightType, playing]);

  // Stop the frames and leave an empty layer behind.
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      const g = layer.current;
      if (g) while (g.firstChild) g.removeChild(g.firstChild);
    },
    [layer],
  );

  const play = useCallback(() => {
    if (!tokens || tokens.count === 0) return;
    const { start, end } = tokens.timeline;
    if (timeRef.current >= end) timeRef.current = start;
    lastWall.current = null;
    setPlaying(true);
    const tick = (wall: number) => {
      if (lastWall.current === null) lastWall.current = wall;
      const delta = (wall - lastWall.current) / 1000;
      lastWall.current = wall;
      let next = Math.min(timeRef.current + delta * speedRef.current, end);
      if (next >= end && loopRef.current) next = start;
      timeRef.current = next;
      drawRef.current(next);
      playheadMover.current?.(next);
      frameCount.current = (frameCount.current + 1) % 4;
      if (frameCount.current === 0 || next >= end) setTime(next);
      if (next < end) frame.current = requestAnimationFrame(tick);
      else {
        frame.current = null;
        setPlaying(false);
      }
    };
    frame.current = requestAnimationFrame(tick);
  }, [tokens]);

  const scrub = (t: number) => {
    timeRef.current = t;
    setTime(t);
    if (!playing) drawRef.current(t);
  };

  const stop = () => {
    pause();
    onStop();
  };

  // The panel's reach from the right edge: its offset, content width and padding.
  const bottomClearance = roomBelowForPill(pillRegion, false, {
    fallback: ANIM_PANEL_BOTTOM_CLEARANCE,
    reach: 16 + panelSize.width + 30,
  });

  // --- the chart gives way ------------------------------------------------------
  // With less room (the pill below the panel, a small box) the chart is shown
  // only as tall as fits, so the panel does not scroll; with room again it is
  // back at the height chosen with the grip (panelSize, which stays as it is).
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [chartRoom, setChartRoom] = useState<number | null>(null);
  const chartHeight = Math.max(ANIM_PANEL_MIN.chartHeight, Math.min(panelSize.chartHeight, chartRoom ?? Infinity));
  const chartHeightRef = useRef(chartHeight);
  chartHeightRef.current = chartHeight;
  const hasChart = Boolean(tokens && tokens.count > 0);
  useEffect(() => {
    const panel = panelRef.current;
    const view = panel?.offsetParent as HTMLElement | null;
    if (!open || !hasChart || !panel || !view || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // Room the view leaves the panel, less everything in it but the chart (borders included).
      const room = view.clientHeight - ANIM_PANEL_TOP - bottomClearance;
      const rest = panel.scrollHeight + (panel.offsetHeight - panel.clientHeight) - chartHeightRef.current;
      const next = Math.floor(room - rest);
      setChartRoom((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, hasChart, bottomClearance]);

  // --- panel body ---------------------------------------------------------------
  let body: React.ReactNode;
  if (!active || state.status === 'idle' || state.status === 'loading') {
    // Opening the panel starts the animation; until its steps are there.
    body = (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Loading the objects' steps" />
        Loading the objects' steps…
      </div>
    );
  } else if (state.status === 'error' || !tokens || tokens.count === 0) {
    body = (
      <div className="flex items-center gap-2">
        <span className={cn('flex-1 text-xs', state.status === 'error' ? 'text-red-600' : 'text-muted-foreground')}>
          {state.status === 'error' ? state.message : 'No object moves between two activities here.'}
        </span>
        <button type="button" className={ANIM_ICON_BUTTON} onClick={stop} title="Stop">
          <Square className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <ActivityChart
          tokens={tokens}
          shown={shown.length === tokens.count ? shown : shownNow}
          time={time}
          colors={colors}
          onScrub={scrub}
          height={chartHeight}
          moverRef={playheadMover}
          timeLabel={`${new Date(time * 1000).toLocaleDateString([], { month: 'short', day: '2-digit', year: '2-digit' })} ${new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
        />
        {/* Play, loop and stop on the left, a short speed slider with its value on the right
            (the chart above is the timeline). */}
        <div className="flex items-center gap-2 -ml-1">
          <button type="button" className={ANIM_ICON_BUTTON} onClick={playing ? pause : play} title={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className={cn(ANIM_ICON_BUTTON, loop && 'bg-slate-100 text-slate-900')}
            onClick={() => setLoop((l) => !l)}
            title={loop ? 'Loop on' : 'Loop off'}
            aria-pressed={loop}
          >
            <Repeat className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={ANIM_ICON_BUTTON} onClick={stop} title="Stop">
            <Square className="h-3.5 w-3.5" />
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="text-[11px] text-slate-500">Speed</span>
            <Slider
              min={0}
              max={SPEED_STEPS.length - 1}
              step={1}
              value={[speedStep]}
              onValueChange={([i]) => setSpeed(SPEED_STEPS[i])}
              thumbAriaLabel="Playback speed"
              className={cn('w-20', THIN_SLIDER)}
            />
            <span className="w-10 shrink-0 whitespace-nowrap text-right text-[11px] font-medium tabular-nums text-slate-700">
              {fmtSpeed(speed)}
            </span>
          </div>
        </div>
      </>
    );
  }

  if (!open) return null;

  return (
    <CanvasPanel
      title="Animation"
      onClose={onClose}
      panelRef={panelRef}
      style={{
        position: 'absolute',
        top: ANIM_PANEL_TOP,
        right: 16,
        zIndex: 13,
        maxHeight: `calc(100% - ${ANIM_PANEL_TOP + bottomClearance}px)`,
      }}
    >
      <div className="flex flex-col gap-3" style={{ width: panelSize.width }} data-testid="ocdfg-animation-panel">
        {body}
      </div>
      {tokens && tokens.count > 0 && (
        // Resizing starts from the chart as shown.
        <AnimPanelResizeGrip size={{ ...panelSize, chartHeight }} onResize={setPanelSize} bottomClearance={bottomClearance} />
      )}
    </CanvasPanel>
  );
}
