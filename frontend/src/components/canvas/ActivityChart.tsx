/**
 * The chart of the canvas animations (PlaybackPanel): the curves of a metric
 * over the whole log, which is also the timeline. Clicking or dragging on it
 * jumps to a moment, the keys move like on a slider; the moment is shown
 * above the playhead. The highest value is marked by a faint dashed line
 * (and for signed bars the lowest too). Clicking a legend entry shows only
 * that line.
 *
 * What is drawn comes from the visualizer (`seriesFor`, per metric): the
 * DFG's steps, the handover's flows.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ACTIVITY_H,
  ACTIVITY_W,
  NEUTRAL_CURVE_COLOR,
  fmtSigned,
  type ActivityMetricOption,
  type ActivitySeries,
} from './playback';

const legendDotColor = (line: { color: string; negColor?: string }, v: number) =>
  !line.negColor ? line.color : v > 0 ? line.color : v < 0 ? line.negColor : NEUTRAL_CURVE_COLOR;
/** Chart y of `v` on a scale from `trough` (bottom) to `peak` (top) in a chart `height` tall. */
const activityY = (v: number, peak: number, trough: number, height: number) =>
  2 + ((peak - v) / (peak - trough > 0 ? peak - trough : 1)) * (height - 3);

export interface ActivityChartProps<M extends string> {
  metrics: readonly ActivityMetricOption<M>[];
  /** The curves of a metric (keep it stable, e.g. useCallback: it is recomputed when it changes). */
  seriesFor: (metric: M) => ActivitySeries;
  timeline: { start: number; end: number };
  time: number;
  onScrub: (time: number) => void;
  height?: number;
  /** The current moment as text, shown above the playhead. */
  timeLabel?: string;
  /**
   * Set to a function that moves the playhead (and its label) to a moment
   * directly, without a render: playback calls it on every frame.
   */
  moverRef?: RefObject<((time: number) => void) | null>;
  /** Prefix of the test ids (`${prefix}-activity-chart`, …). */
  testIdPrefix?: string;
}

export function ActivityChart<M extends string>({
  metrics,
  seriesFor,
  timeline,
  time,
  onScrub,
  height = ACTIVITY_H,
  timeLabel,
  moverRef,
  testIdPrefix = 'playback',
}: ActivityChartProps<M>) {
  const [metric, setMetric] = useState<M>(metrics[0].value);
  const metricInfo = metrics.find((m) => m.value === metric) ?? metrics[0];
  const series = useMemo(() => seriesFor(metric), [seriesFor, metric]);
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

  const { start, end } = timeline;
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
    <div className="flex flex-col gap-2" data-testid={`${testIdPrefix}-activity-chart`}>
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
                setMetric(v as M);
                setSolo(null);
              }}
            >
              {metrics.map((m) => (
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
            data-testid={`${testIdPrefix}-animation-time`}
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
          data-testid={`${testIdPrefix}-activity-plot`}
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
              data-testid={`${testIdPrefix}-activity-peak-line`}
            />
            {/* Signed bars also go below zero: the lowest value likewise, labelled above. */}
            {series.kind === 'bars' && trough < 0 && (
              <line
                x1={0}
                x2={ACTIVITY_W}
                y1={activityY(trough, peak, trough, height)}
                y2={activityY(trough, peak, trough, height)}
                stroke="#cbd5e1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                data-testid={`${testIdPrefix}-activity-trough-line`}
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
            data-testid={`${testIdPrefix}-activity-peak`}
            className="pointer-events-none absolute left-0.5 rounded-sm bg-white/75 px-0.5 text-[10px] leading-3 tabular-nums text-slate-400"
            style={{ top: activityY(peak, peak, trough, height) + 2 }}
          >
            {series.kind === 'bars' ? fmtSigned(peak) : series.format(peak)}
          </span>
          {series.kind === 'bars' && trough < 0 && (
            <span
              data-testid={`${testIdPrefix}-activity-trough`}
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

export default ActivityChart;
