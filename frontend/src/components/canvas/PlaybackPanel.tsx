/**
 * The "Animation" panel of the graph canvases (the DFG's tokens, the
 * handover's dots), opened from the control pill (PillToggle) and drawn in
 * the shared CanvasPanel frame, top right:
 *  - the activity chart, which is also the timeline (the visualizer renders
 *    it, ActivityChart, at the height the panel gives it);
 *  - play / pause, loop and stop on the left, the speed slider (a multiplier
 *    of real time) on the right; an optional extra row below (e.g. the
 *    handover's connectors);
 *  - a grip in the bottom-left corner to make it wider and the chart taller.
 *    The size is kept per viewer under `sizeKey`; with less room (a small
 *    box, the pill below it) the chart is shown only as tall as fits.
 *
 * The panel is only the controls: the visualizer runs the playback and draws
 * the animation, so closing the panel keeps it running.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Pause, Play, Repeat, Square } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { CanvasPanel } from './CanvasPanel';
import { PANEL_ICON_BUTTON_CLASS } from './panelHeader';
import { roomBelowForPill, type PillRegion } from './pillSpots';
import {
  PLAYBACK_PANEL_MIN,
  SPEED_STEPS,
  clampPlaybackPanelSize,
  fmtSpeed,
  loadPlaybackPanelSize,
  savePlaybackPanelSize,
  speedIndex,
  type PlaybackPanelSize,
} from './playback';

/** Distance of the panel from the canvas' right edge, and from its bottom without the pill below it. */
const EDGE = 16;
/** Panel padding and border around its content (CanvasPanel), for its reach from the right edge. */
const PANEL_CHROME_WIDTH = 30;

/** Buttons of the playback row: the canvas panels' header buttons. */
const ICON_BUTTON = PANEL_ICON_BUTTON_CLASS;

/**
 * The thin slider of the canvas panels (as the object type panel's filters):
 * thin slate track, the part up to the thumb darker, a small round thumb.
 * (Class names written out in full, so Tailwind finds them.)
 */
const THIN_SLIDER =
  '[&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-slate-200 [&_[data-slot=slider-range]]:bg-slate-600 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-slate-600';

/**
 * Drag grip in the panel's bottom-left corner. The panel is pinned top right,
 * so dragging left widens it and dragging down makes the chart taller, until
 * the panel reaches the room's bottom. The size is stored when the drag ends.
 */
function ResizeGrip({
  size,
  onResize,
  top,
  bottomClearance,
  sizeKey,
}: {
  size: PlaybackPanelSize;
  onResize: (size: PlaybackPanelSize) => void;
  top: number;
  /** Room kept free below the panel (the canvas edge, or the control pill). */
  bottomClearance: number;
  sizeKey: string;
}) {
  const drag = useRef<{ x: number; y: number; start: PlaybackPanelSize; last: PlaybackPanelSize; maxChart: number } | null>(null);
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d) savePlaybackPanelSize(sizeKey, d.last);
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
        // The grip sits in the panel, the panel in the canvas: the chart may
        // grow by whatever room is left below the panel.
        const panel = e.currentTarget.offsetParent as HTMLElement | null;
        const canvas = panel?.offsetParent as HTMLElement | null;
        const room = panel && canvas ? canvas.clientHeight - top - bottomClearance - panel.scrollHeight : Infinity;
        drag.current = { x: e.clientX, y: e.clientY, start: size, last: size, maxChart: size.chartHeight + Math.max(0, room) };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.last = clampPlaybackPanelSize({
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

/** What the panel shows: the loading line, a message (with Stop), or the chart and the controls. */
export type PlaybackStatus =
  | { kind: 'loading'; text: string }
  | { kind: 'message'; text: string; error?: boolean }
  | { kind: 'ready' };

export interface PlaybackPanelProps {
  /** Whether the panel is shown (the pill button); the animation runs on while it is not. */
  open: boolean;
  onClose: () => void;
  status: PlaybackStatus;
  /** The chart at the height the panel has for it (see ActivityChart). */
  renderChart: (height: number) => ReactNode;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  /** Stop: the animation ends (the visualizer also closes the panel). */
  onStop: () => void;
  /** Seconds of the log per second; the slider snaps to SPEED_STEPS. */
  speed: number;
  onSpeedChange: (speed: number) => void;
  /** Below the playback row, e.g. the handover's connectors. */
  extraRow?: ReactNode;
  /** Where the canvas' control pill sits: the panel ends above it when it is below the panel. */
  pillRegion?: PillRegion | null;
  /** Distance from the canvas' top (below chips there, if any). */
  top?: number;
  /** localStorage key of the panel size. */
  sizeKey: string;
  /** Prefix of the test ids (`${prefix}-animation-panel`). */
  testIdPrefix?: string;
}

export function PlaybackPanel({
  open,
  onClose,
  status,
  renderChart,
  playing,
  onPlay,
  onPause,
  loop,
  onLoopChange,
  onStop,
  speed,
  onSpeedChange,
  extraRow,
  pillRegion = null,
  top = EDGE,
  sizeKey,
  testIdPrefix = 'playback',
}: PlaybackPanelProps) {
  const [panelSize, setPanelSize] = useState(() => loadPlaybackPanelSize(sizeKey));
  const bottomClearance = roomBelowForPill(pillRegion, false, {
    fallback: EDGE,
    reach: EDGE + panelSize.width + PANEL_CHROME_WIDTH,
  });

  // --- the chart gives way ------------------------------------------------------
  // With less room (the pill below the panel, a small box) the chart is shown
  // only as tall as fits, so the panel does not scroll; with room again it is
  // back at the height chosen with the grip (panelSize, which stays as it is).
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [chartRoom, setChartRoom] = useState<number | null>(null);
  const chartHeight = Math.max(PLAYBACK_PANEL_MIN.chartHeight, Math.min(panelSize.chartHeight, chartRoom ?? Infinity));
  const chartHeightRef = useRef(chartHeight);
  chartHeightRef.current = chartHeight;
  const ready = status.kind === 'ready';
  useEffect(() => {
    const panel = panelRef.current;
    const canvas = panel?.offsetParent as HTMLElement | null;
    if (!open || !ready || !panel || !canvas || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // Room the canvas leaves the panel, less everything in it but the chart (borders included).
      const room = canvas.clientHeight - top - bottomClearance;
      const rest = panel.scrollHeight + (panel.offsetHeight - panel.clientHeight) - chartHeightRef.current;
      const next = Math.floor(room - rest);
      setChartRoom((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, ready, bottomClearance, top]);

  if (!open) return null;

  let body: ReactNode;
  if (status.kind === 'loading') {
    body = (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={status.text} />
        {status.text}
      </div>
    );
  } else if (status.kind === 'message') {
    body = (
      <div className="flex items-center gap-2">
        <span className={cn('flex-1 text-xs', status.error ? 'text-red-600' : 'text-muted-foreground')}>{status.text}</span>
        <button type="button" className={ICON_BUTTON} onClick={onStop} title="Stop">
          <Square className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  } else {
    body = (
      <>
        {renderChart(chartHeight)}
        {/* Play, loop and stop on the left, a short speed slider with its value on the right
            (the chart above is the timeline). */}
        <div className="flex items-center gap-2 -ml-1">
          <button type="button" className={ICON_BUTTON} onClick={playing ? onPause : onPlay} title={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className={cn(ICON_BUTTON, loop && 'bg-slate-100 text-slate-900')}
            onClick={() => onLoopChange(!loop)}
            title={loop ? 'Loop on' : 'Loop off'}
            aria-pressed={loop}
          >
            <Repeat className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={ICON_BUTTON} onClick={onStop} title="Stop">
            <Square className="h-3.5 w-3.5" />
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="text-[11px] text-slate-500">Speed</span>
            <Slider
              min={0}
              max={SPEED_STEPS.length - 1}
              step={1}
              value={[speedIndex(speed)]}
              onValueChange={([i]) => onSpeedChange(SPEED_STEPS[i])}
              thumbAriaLabel="Playback speed"
              className={cn('w-20', THIN_SLIDER)}
            />
            <span className="w-10 shrink-0 whitespace-nowrap text-right text-[11px] font-medium tabular-nums text-slate-700">
              {fmtSpeed(speed)}
            </span>
          </div>
        </div>
        {extraRow}
      </>
    );
  }

  return (
    <CanvasPanel
      title="Animation"
      onClose={onClose}
      panelRef={panelRef}
      style={{
        position: 'absolute',
        top,
        right: EDGE,
        zIndex: 13,
        maxHeight: `calc(100% - ${top + bottomClearance}px)`,
      }}
    >
      <div className="flex flex-col gap-3" style={{ width: panelSize.width }} data-testid={`${testIdPrefix}-animation-panel`}>
        {body}
      </div>
      {ready && (
        // Resizing starts from the chart as shown.
        <ResizeGrip
          size={{ ...panelSize, chartHeight }}
          onResize={setPanelSize}
          top={top}
          bottomClearance={bottomClearance}
          sizeKey={sizeKey}
        />
      )}
    </CanvasPanel>
  );
}

export default PlaybackPanel;
