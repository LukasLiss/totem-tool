/**
 * The OC-DFG's animation: the tokens drawn into the canvas' token layer, the
 * playback, and its panel (the shared PlaybackPanel with the shared
 * ActivityChart, as the handover's). The panel is opened from a button of the
 * control pill (PillToggle). The playback state lives here, outside the
 * panel, so closing the panel keeps the animation running.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActivityChart } from '@/components/canvas/ActivityChart';
import { PlaybackPanel, type PlaybackStatus } from '@/components/canvas/PlaybackPanel';
import { defaultSpeed, fmtPlaybackTime } from '@/components/canvas/playback';
import type { PillRegion } from '@/components/canvas/pillSpots';
import {
  ACTIVITY_METRICS,
  computeAgeSeries,
  computeBalanceSeries,
  computeObjectSeries,
  type ActivityMetric,
} from './animationCharts';
import { arcPaths, tokensAt, type TokenPath } from './tokenAnimation';
import type { LayoutResult } from './types';
import type { FlowsState } from './useOcdfgFlows';

const DOT_RADIUS = 4;
/** Opacity of the tokens of the other types while one type is highlighted (as their arcs). */
const FADED_TOKEN_OPACITY = 0.15;
const SVG_NS = 'http://www.w3.org/2000/svg';
const PANEL_SIZE_KEY = 'ocdfg.animationPanelSize';

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
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
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
    if (tokens) setSpeed(defaultSpeed(tokens.timeline.end - tokens.timeline.start));
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

  const seriesFor = useCallback(
    (metric: ActivityMetric) => {
      // Only drawn once there are tokens (status ready).
      if (!tokens) return { kind: 'step' as const, lines: [], valueAt: () => ({}), format: String };
      const mask = shown.length === tokens.count ? shown : shownNow;
      if (metric === 'rate') return computeBalanceSeries(tokens, mask);
      if (metric === 'age') return computeAgeSeries(tokens, mask);
      return computeObjectSeries(tokens, mask, colors);
    },
    [tokens, shown, shownNow, colors],
  );

  let status: PlaybackStatus;
  if (!active || state.status === 'idle' || state.status === 'loading') {
    // Opening the panel starts the animation; until its steps are there.
    status = { kind: 'loading', text: "Loading the objects' steps…" };
  } else if (state.status === 'error') {
    status = { kind: 'message', text: state.message, error: true };
  } else if (!tokens || tokens.count === 0) {
    status = { kind: 'message', text: 'No object moves between two activities here.' };
  } else {
    status = { kind: 'ready' };
  }

  return (
    <PlaybackPanel
      open={open}
      onClose={onClose}
      status={status}
      renderChart={(height) =>
        tokens && (
          <ActivityChart
            metrics={ACTIVITY_METRICS}
            seriesFor={seriesFor}
            timeline={tokens.timeline}
            time={time}
            onScrub={scrub}
            height={height}
            moverRef={playheadMover}
            timeLabel={fmtPlaybackTime(time)}
            testIdPrefix="ocdfg"
          />
        )
      }
      playing={playing}
      onPlay={play}
      onPause={pause}
      loop={loop}
      onLoopChange={setLoop}
      onStop={stop}
      speed={speed}
      onSpeedChange={setSpeed}
      pillRegion={pillRegion}
      sizeKey={PANEL_SIZE_KEY}
      testIdPrefix="ocdfg"
    />
  );
}
