/**
 * The OC-DFG's "Animation" panel: the token animation's start button, the
 * activity chart, the timeline slider and the playback row, plus the drawing
 * of the tokens into the canvas' token layer.
 *
 * Same panel, chart and controls as the OC handover animation
 * (OCHandoverExplorer: the "Animation" FloatingPanel, ActivityChart,
 * AnimPanelResizeGrip), copied with the same styling so both can be unified
 * later. The playback state lives here, outside the collapsible panel body,
 * so collapsing the panel keeps the animation running.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ChevronDown, Loader2, Pause, Play, Repeat, Settings2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { FloatingPanel } from '../orgamining/canvas';
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

const SPEED_OPTIONS = [1, 10, 100, 1000, 5000, 10000, 50000, 100000, 1000000, 10000000, 100000000];
/** The whole log plays in about this many seconds at the initial speed (as in the handover). */
const DEFAULT_PLAY_SECONDS = 30;
const DOT_RADIUS = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Panel position: top right of the view. */
const ANIM_PANEL_TOP = 16;
const ANIM_PANEL_BOTTOM_CLEARANCE = 16;

/** Borderless icon button of the playback row (same as the handover's). */
const ANIM_ICON_BUTTON =
  'flex items-center justify-center h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors';

function snapSpeed(target: number): number {
  return SPEED_OPTIONS.reduce((best, s) =>
    Math.abs(Math.log(s) - Math.log(target)) < Math.abs(Math.log(best) - Math.log(target)) ? s : best,
  );
}

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** Same notation as the handover animation: 1×, 10², 5·10³×, … */
function fmtSpeed(s: number): string {
  if (s === 1) return '1×';
  const exp = Math.log10(s);
  const sup = (n: number) => String(n).split('').map((d) => SUPERSCRIPTS[Number(d)]).join('');
  if (Number.isInteger(exp)) return `10${sup(exp)}×`;
  const e = Math.floor(exp);
  return `${s / Math.pow(10, e)}·10${sup(e)}×`;
}

// --- panel size (same as the handover's, stored under its own key) ----------
type AnimPanelSize = { width: number; chartHeight: number };
const ANIM_PANEL_MIN: AnimPanelSize = { width: 242, chartHeight: 56 };
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
}: {
  tokens: Tokens;
  shown: Uint8Array;
  time: number;
  colors: Record<string, string>;
  onScrub: (time: number) => void;
  height?: number;
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
  const playheadPct = Math.min(100, Math.max(0, ((time - start) / span) * 100));

  return (
    <div className="flex flex-col gap-1" data-testid="ocdfg-activity-chart">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-0.5 hover:text-foreground transition-colors" title={metricInfo.hint}>
              <span>{metricInfo.label}</span>
              <ChevronDown className="h-3 w-3 shrink-0" />
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
        <span className="tabular-nums">
          {series.kind === 'bars'
            ? `peak ${fmtSigned(peak)} / ${fmtSigned(trough)}`
            : `peak ${series.format(peak)}${series.unit ? ` ${series.unit}` : ''}`}
        </span>
      </div>
      <div className="px-2">
        <div
          className="relative cursor-pointer touch-none"
          style={{ height }}
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
          <div className="absolute top-0 bottom-0 w-px bg-foreground/40 pointer-events-none" style={{ left: `${playheadPct}%` }} />
        </div>
      </div>
      <div className="flex items-start gap-2 text-[11px]">
        {series.footnote && <span className="text-muted-foreground whitespace-nowrap">{series.footnote}</span>}
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
  /** Start collapsed to its chip; the DFG always does, like the handover's panel. */
  narrow: boolean;
  /** Whether the animation is on (its steps are loaded while it is). */
  active: boolean;
  onStart: () => void;
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
}

export default function AnimationPanel({
  narrow,
  pillRegion = null,
  active,
  onStart,
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
    for (const dot of tokensAt(tokens, pathByArc, time, showObject)) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', String(dot.x));
      c.setAttribute('cy', String(dot.y));
      c.setAttribute('r', String(DOT_RADIUS));
      c.setAttribute('fill', colors[dot.type] ?? '#64748b');
      c.setAttribute('stroke', '#ffffff');
      c.setAttribute('stroke-width', '1.2');
      g.appendChild(c);
    }
  };

  // --- playback ---------------------------------------------------------------
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(100);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [panelSize, setPanelSize] = useState(loadAnimPanelSize);
  const timeRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const frame = useRef<number | null>(null);
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
    if (tokens) setSpeed(snapSpeed(Math.max(1, (tokens.timeline.end - tokens.timeline.start) / DEFAULT_PLAY_SECONDS)));
  }, [tokens, pause]);

  // Redraw the current moment when anything but the time changes.
  useEffect(() => {
    if (!playing) drawRef.current(timeRef.current);
  }, [tokens, pathByArc, showObject, colors, playing]);

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

  // --- panel body ---------------------------------------------------------------
  let body: React.ReactNode;
  if (!active || state.status === 'idle' || state.status === 'loading') {
    const loading = active && state.status !== 'idle';
    body = (
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={onStart}>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Loading the objects' steps" />
        ) : (
          <>
            <Play className="h-3.5 w-3.5" /> Animate
          </>
        )}
      </Button>
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
    const { start, end } = tokens.timeline;
    body = (
      <>
        <ActivityChart
          tokens={tokens}
          shown={shown.length === tokens.count ? shown : shownNow}
          time={time}
          colors={colors}
          onScrub={scrub}
          height={panelSize.chartHeight}
        />
        <Slider
          min={start}
          max={Math.max(end, start + 1)}
          step={Math.max(1, (end - start) / 2000)}
          value={[time]}
          onValueChange={([v]) => scrub(v)}
          aria-label="Animation time"
        />
        {/* Playback row below the slider, so the slider keeps the chart's full width.
            Equal side columns keep the timestamp centred in the panel. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center -mx-1.5">
          <div className="flex items-center gap-0.5">
            <button type="button" className={ANIM_ICON_BUTTON} onClick={playing ? pause : play} title={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              className={cn(ANIM_ICON_BUTTON, loop && 'text-blue-600 hover:text-blue-700')}
              onClick={() => setLoop((l) => !l)}
              title={loop ? 'Loop on' : 'Loop off'}
              aria-pressed={loop}
            >
              <Repeat className="h-3.5 w-3.5" />
            </button>
          </div>
          <span className="px-1 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
            {new Date(time * 1000).toLocaleDateString([], { month: 'short', day: '2-digit', year: '2-digit' })}{' '}
            {new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <div className="flex items-center justify-end gap-0.5">
            <button type="button" className={ANIM_ICON_BUTTON} onClick={stop} title="Stop">
              <Square className="h-3.5 w-3.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={ANIM_ICON_BUTTON} title={`Playback settings · ${fmtSpeed(speed)}`}>
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">Playback options</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Speed</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={String(speed)}
                  onValueChange={(v) => setSpeed(Number(v))}
                  className="max-h-24 overflow-y-auto"
                >
                  {SPEED_OPTIONS.map((s) => (
                    <DropdownMenuRadioItem key={s} value={String(s)}>
                      {s}×
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </>
    );
  }

  // The panel's reach from the right edge: its offset, content width and padding.
  const bottomClearance = roomBelowForPill(pillRegion, false, {
    fallback: ANIM_PANEL_BOTTOM_CLEARANCE,
    reach: 16 + panelSize.width + 30,
  });

  return (
    <FloatingPanel
      title="Animation"
      icon={<Play style={{ width: 13, height: 13, color: '#64748b' }} />}
      narrow={narrow}
      plainHeading
      // Same header as the object type panel.
      canvasHeader
      style={{
        position: 'absolute',
        top: ANIM_PANEL_TOP,
        right: 16,
        zIndex: 13,
        maxHeight: `calc(100% - ${ANIM_PANEL_TOP + bottomClearance}px)`,
      }}
    >
      <div className="flex flex-col gap-2" style={{ width: panelSize.width }} data-testid="ocdfg-animation-panel">
        {body}
      </div>
      {tokens && tokens.count > 0 && (
        <AnimPanelResizeGrip size={panelSize} onResize={setPanelSize} bottomClearance={bottomClearance} />
      )}
    </FloatingPanel>
  );
}
