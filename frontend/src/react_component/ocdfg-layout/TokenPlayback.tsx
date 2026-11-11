/**
 * Playback bar of the OC-DFG token animation (play/pause, speed, timeline)
 * and the drawing of the tokens into the canvas' token layer.
 *
 * Modelled on the OC handover animation: the playhead runs in log time at
 * `speed`× real time, and every frame redraws the dots of the steps that are
 * under way. The layer is plain SVG circles, rebuilt per frame.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ChevronDown, Loader2, Pause, Play, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { arcPaths, tokensAt, type TokenPath } from './tokenAnimation';
import type { LayoutResult } from './types';
import type { FlowsState } from './useOcdfgFlows';

const SPEED_OPTIONS = [1, 10, 100, 1000, 5000, 10000, 50000, 100000, 1000000, 10000000, 100000000];
/** The whole log plays in about this many seconds at the initial speed. */
const DEFAULT_PLAY_SECONDS = 30;
const DOT_RADIUS = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';

function snapSpeed(target: number): number {
  return SPEED_OPTIONS.reduce((best, s) =>
    Math.abs(Math.log(s) - Math.log(target)) < Math.abs(Math.log(best) - Math.log(target)) ? s : best,
  );
}

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** Same notation as the handover animation: 1×, 10², 5·10³×, … */
function formatSpeed(s: number): string {
  if (s === 1) return '1×';
  const exp = Math.log10(s);
  const sup = (n: number) => String(n).split('').map((d) => SUPERSCRIPTS[Number(d)]).join('');
  if (Number.isInteger(exp)) return `10${sup(exp)}×`;
  const e = Math.floor(exp);
  return `${s / Math.pow(10, e)}·10${sup(e)}×`;
}

function formatTime(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.toLocaleDateString([], { month: 'short', day: '2-digit', year: '2-digit' })} ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export interface TokenPlaybackProps {
  state: FlowsState;
  /** The canvas' token layer (inside its SVG, in layout coordinates). */
  layer: RefObject<SVGGElement | null>;
  result: LayoutResult | null;
  colors: Record<string, string>;
  /** Variants view: the legend's number of variants per type; objects of later variants are not animated. */
  variantLimit?: Record<string, number>;
  onClose: () => void;
}

export default function TokenPlayback({ state, layer, result, colors, variantLimit, onClose }: TokenPlaybackProps) {
  const tokens = state.status === 'ready' ? state.tokens : null;

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

  // --- drawing ----------------------------------------------------------------
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
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const frame = useRef<number | null>(null);
  const lastWall = useRef<number | null>(null);
  const frameCount = useRef(0);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setPlaying(false);
  }, []);

  // New data: back to its start, paused, at a speed that plays it in ~30 s.
  useEffect(() => {
    stop();
    const t = tokens ? tokens.timeline.start : 0;
    timeRef.current = t;
    setTime(t);
    if (tokens) setSpeed(snapSpeed(Math.max(1, (tokens.timeline.end - tokens.timeline.start) / DEFAULT_PLAY_SECONDS)));
  }, [tokens, stop]);

  // Redraw the current moment when anything but the time changes.
  useEffect(() => {
    if (!playing) drawRef.current(timeRef.current);
  }, [tokens, pathByArc, showObject, colors, playing]);

  // Leave an empty layer behind.
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
      const next = Math.min(timeRef.current + delta * speedRef.current, end);
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

  // --- bar ----------------------------------------------------------------------
  const bar: React.CSSProperties = {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    zIndex: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 9999,
    padding: '4px 8px 4px 12px',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.14)',
    fontFamily: 'var(--font-primary, Inter, sans-serif)',
  };
  const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-accent disabled:opacity-50';
  const close = (
    <button type="button" className={iconButton} onClick={onClose} title="Close the animation" aria-label="Close the animation">
      <X className="h-4 w-4" />
    </button>
  );
  const stopPointer = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div style={bar} {...stopPointer} data-testid="ocdfg-token-playback">
        <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
        <span className="flex-1 text-xs text-slate-600">Loading the objects' steps…</span>
        {close}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div style={bar} {...stopPointer} data-testid="ocdfg-token-playback">
        <span className="flex-1 text-xs text-red-600">{state.message}</span>
        {close}
      </div>
    );
  }
  if (!tokens || tokens.count === 0) {
    return (
      <div style={bar} {...stopPointer} data-testid="ocdfg-token-playback">
        <span className="flex-1 text-xs text-slate-600">No object moves between two activities here.</span>
        {close}
      </div>
    );
  }

  const { start, end } = tokens.timeline;
  return (
    <div style={bar} {...stopPointer} data-testid="ocdfg-token-playback">
      <button
        type="button"
        className={iconButton}
        onClick={playing ? stop : play}
        title={playing ? 'Pause' : 'Play'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-xs tabular-nums hover:bg-accent"
            title="Playback speed (log time per real second)"
          >
            {formatSpeed(speed)}
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
            {SPEED_OPTIONS.map((s) => (
              <DropdownMenuRadioItem key={s} value={String(s)}>
                {s.toLocaleString()}×
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="min-w-[80px] flex-1 px-1">
        <Slider
          min={start}
          max={Math.max(end, start + 1)}
          step={Math.max(1, (end - start) / 2000)}
          value={[time]}
          onValueChange={([v]) => scrub(v)}
          aria-label="Animation time"
        />
      </div>
      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-600">{formatTime(time)}</span>
      <span
        className="hidden shrink-0 whitespace-nowrap text-xs text-slate-400 md:inline"
        title="Steps between two activities, one per object and pair of consecutive events"
      >
        {tokens.count.toLocaleString()} steps · {state.status === 'ready' ? state.totalObjects.toLocaleString() : 0} objects
      </span>
      {close}
    </div>
  );
}
