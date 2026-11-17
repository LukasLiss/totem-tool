/**
 * The shared pieces of the canvas animations (the DFG's tokens, the
 * handover's dots) that are no components: the chart's data shape, the
 * playback speeds and the stored panel size. Kept apart from
 * PlaybackPanel.tsx and ActivityChart.tsx, which export components only
 * (Fast Refresh).
 */

/** viewBox width of the activity chart; the SVG is stretched to the panel. */
export const ACTIVITY_W = 1000;
/** Default chart height; the panel can be resized taller. */
export const ACTIVITY_H = 56;
/** Colour of a curve without a type of its own (the zero value of a signed one, the age). */
export const NEUTRAL_CURVE_COLOR = '#64748b';

/**
 * A curve point. A step curve holds `v` from `x` until the next point; a line
 * curve joins points straight, and a NaN `v` breaks it; a bar runs from `x` to
 * the next point's `x` (the last to the chart's end) between zero and `v`.
 */
export type CurvePoint = { x: number; v: number };

/** What the activity chart draws for one metric. */
export type ActivitySeries = {
  kind: 'step' | 'line' | 'bars';
  /** `negColor` marks a signed line: it colours negative bars and the legend dot of a negative value. */
  lines: { key: string; label: string; color: string; negColor?: string; points: CurvePoint[] }[];
  /** Each line's value at `time`, for the legend. */
  valueAt: (time: number) => Record<string, number>;
  format: (v: number) => string;
  unit?: string;
  /** Shown bottom left, e.g. the bin size. */
  footnote?: string;
};

/** A metric of the chart's dropdown. */
export type ActivityMetricOption<M extends string = string> = { value: M; label: string; hint: string };

export const fmtSigned = (v: number) => (v > 0 ? `+${v.toLocaleString()}` : v < 0 ? `−${(-v).toLocaleString()}` : '0');

// --- playback speed ---------------------------------------------------------------

/** The playback speeds (seconds of the log per second): 1, 2, 5, 10, 20, 50, … up to 100,000,000. */
export const SPEED_STEPS: readonly number[] = Array.from({ length: 25 }, (_, i) => [1, 2, 5][i % 3] * 10 ** Math.floor(i / 3));

/** The whole log plays in about this many seconds at the initial speed. */
const DEFAULT_PLAY_SECONDS = 30;

/** The index of the speed step closest to `target`, on a log scale (the speed slider's value). */
export function speedIndex(target: number): number {
  let best = 0;
  SPEED_STEPS.forEach((s, i) => {
    if (Math.abs(Math.log(s) - Math.log(target)) < Math.abs(Math.log(SPEED_STEPS[best]) - Math.log(target))) best = i;
  });
  return best;
}

/** The speed step that plays a timeline of `span` seconds in about 30 s. */
export const defaultSpeed = (span: number) => SPEED_STEPS[speedIndex(Math.max(1, span / DEFAULT_PLAY_SECONDS))];

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 0 });
/** A speed as a multiplier: 5×, 200×, 5,000×, 20K×, 1M×. */
export const fmtSpeed = (s: number) => `${s < 10000 ? s.toLocaleString('en') : COMPACT.format(s)}×`;

/** The moment shown above the playhead: "Mar 04, 24 14:30". */
export const fmtPlaybackTime = (time: number) =>
  `${new Date(time * 1000).toLocaleDateString([], { month: 'short', day: '2-digit', year: '2-digit' })} ${new Date(
    time * 1000,
  ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

// --- panel size -------------------------------------------------------------------

export type PlaybackPanelSize = { width: number; chartHeight: number };
/**
 * The narrowest the panel gets: wide enough for the bottom row (play, loop,
 * stop, "Speed", its slider and the longest value, "100M×") on one line.
 */
export const PLAYBACK_PANEL_MIN: PlaybackPanelSize = { width: 260, chartHeight: 56 };
export const PLAYBACK_PANEL_MAX: PlaybackPanelSize = { width: 720, chartHeight: 420 };

export const clampPlaybackPanelSize = (size: PlaybackPanelSize): PlaybackPanelSize => ({
  width: Math.min(PLAYBACK_PANEL_MAX.width, Math.max(PLAYBACK_PANEL_MIN.width, size.width)),
  chartHeight: Math.min(PLAYBACK_PANEL_MAX.chartHeight, Math.max(PLAYBACK_PANEL_MIN.chartHeight, size.chartHeight)),
});

/** The size this viewer left the panel at (under `key`); storage may be unavailable. */
export function loadPlaybackPanelSize(key: string): PlaybackPanelSize {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.width === 'number' && typeof parsed?.chartHeight === 'number') return clampPlaybackPanelSize(parsed);
    }
  } catch {
    /* fall back to the default */
  }
  return PLAYBACK_PANEL_MIN;
}

export function savePlaybackPanelSize(key: string, size: PlaybackPanelSize) {
  try {
    localStorage.setItem(key, JSON.stringify(size));
  } catch {
    /* not persisted */
  }
}
