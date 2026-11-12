/**
 * Curves of the OC-DFG animation panel's chart.
 *
 * Copied from the OC handover animation (OCHandoverExplorer: computeObjectSeries,
 * computeBalanceSeries, computeAgeSeries) and adapted to the DFG's steps, so
 * both can be unified later. A step here is one object on its way from one
 * event to its next; the curves only count the steps that get a dot (`shown`).
 */
import type { Tokens } from './tokenAnimation';

export const ACTIVITY_W = 1000; // viewBox width; the SVG is stretched to the panel
export const ACTIVITY_H = 56; // default chart height; the panel can be resized taller
const ACTIVITY_MAX_STEPS = 2000; // above this, a step curve is binned
const ACTIVITY_BINS = 240;
const ACTIVITY_SAMPLES = 480; // sample points of the waiting-time curve
const RATE_MAX_WINDOWS = 120; // the balance uses the shortest window giving at most this many
const RATE_WINDOWS: { seconds: number; label: string }[] = [
  { seconds: 60, label: '1 min' },
  { seconds: 5 * 60, label: '5 min' },
  { seconds: 15 * 60, label: '15 min' },
  { seconds: 3600, label: '1 h' },
  { seconds: 6 * 3600, label: '6 h' },
  { seconds: 86400, label: '1 day' },
  { seconds: 7 * 86400, label: '1 week' },
  { seconds: 30 * 86400, label: '30 days' },
  { seconds: 365 * 86400, label: '1 year' },
];
export const NEUTRAL_CURVE_COLOR = '#64748b';
const BALANCE_UP_COLOR = '#16a34a'; // more steps started than completed
const BALANCE_DOWN_COLOR = '#dc2626'; // more completed than started

export type ActivityMetric = 'objects' | 'rate' | 'age';
export const ACTIVITY_METRICS: { value: ActivityMetric; label: string; hint: string }[] = [
  {
    value: 'objects',
    label: 'Objects between events',
    hint: 'Objects on their way from one event to their next, per object type',
  },
  {
    value: 'rate',
    label: 'Step balance',
    hint: 'Steps started minus completed per time window: above zero objects pile up between activities, below zero they drain',
  },
  {
    value: 'age',
    label: 'Time since last event',
    hint: 'How long the objects currently between events have been waiting since their last event, on average',
  },
];

/**
 * A curve point. A step curve holds `v` from `x` until the next point; a line
 * curve joins points straight, and a NaN `v` breaks it; a bar runs from `x` to
 * the next point's `x` (the last to the chart's end) between zero and `v`.
 */
export type CurvePoint = { x: number; v: number };
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

type Timeline = Tokens['timeline'];

const activityXOf = (timeline: Timeline) => {
  const span = Math.max(timeline.end - timeline.start, 1e-9);
  return (time: number) => Math.min(1, Math.max(0, (time - timeline.start) / span)) * ACTIVITY_W;
};
const ACTIVITY_BIN_W = ACTIVITY_W / ACTIVITY_BINS;
const activityBinOf = (x: number) => Math.min(ACTIVITY_BINS - 1, Math.floor(x / ACTIVITY_BIN_W));
export const fmtCount = (v: number) => v.toLocaleString();
export const fmtSigned = (v: number) => (v > 0 ? `+${v.toLocaleString()}` : v < 0 ? `−${(-v).toLocaleString()}` : '0');

/** Same format as the handover's durations. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const s = Math.round(Math.abs(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Indices of the steps that may run at `time` (see tokensAt): started within `longest` before it. */
function runningRange(tokens: Tokens, time: number): [number, number] {
  let lo = 0;
  let hi = tokens.count;
  const from = time - tokens.longest;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens.start[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < tokens.count && tokens.start[end] <= time) end++;
  return [lo, end];
}

const typeOfStep = (tokens: Tokens, i: number) => tokens.objectTypes[tokens.objectType[tokens.object[i]]];

/**
 * Distinct objects between two events per object type over the timeline.
 *
 * An object counts while any of its shown steps runs — the same
 * `start <= t < start + duration` window the dots use — so an object whose
 * 0 s step overlaps its next one (the technical minimum) counts once.
 */
export function computeObjectSeries(tokens: Tokens, shown: Uint8Array, colors: Record<string, string>): ActivitySeries {
  const xOf = activityXOf(tokens.timeline);

  const eventsByType = new Map<string, { time: number; delta: 1 | -1; id: number }[]>();
  for (let i = 0; i < tokens.count; i++) {
    if (!shown[i]) continue;
    const type = typeOfStep(tokens, i);
    let events = eventsByType.get(type);
    if (!events) {
      events = [];
      eventsByType.set(type, events);
    }
    events.push({ time: tokens.start[i], delta: 1, id: tokens.object[i] });
    events.push({ time: tokens.start[i] + tokens.duration[i], delta: -1, id: tokens.object[i] });
  }

  // Fixed type order from the colour map, so a type keeps its place.
  const order = Object.keys(colors);
  const rank = (t: string) => {
    const i = order.indexOf(t);
    return i === -1 ? Infinity : i;
  };
  const types = [...eventsByType.keys()].sort((a, b) => rank(a) - rank(b));

  const lines: ActivitySeries['lines'] = [];
  for (const type of types) {
    const events = eventsByType.get(type)!;
    events.sort((a, b) => a.time - b.time);
    const refs = new Map<number, number>(); // object → its steps currently running
    const changes: { time: number; v: number }[] = [];
    let current = 0;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const n = (refs.get(ev.id) ?? 0) + ev.delta;
      if (n === 0) refs.delete(ev.id);
      else refs.set(ev.id, n);
      if (ev.delta === 1 && n === 1) current++;
      else if (ev.delta === -1 && n === 0) current--;
      // Record once all events at this instant are applied, so a step ending
      // exactly where the next starts doesn't show a dip.
      const last = i === events.length - 1 || events[i + 1].time !== ev.time;
      if (last && (changes.length === 0 || changes[changes.length - 1].v !== current)) {
        changes.push({ time: ev.time, v: current });
      }
    }

    let points: CurvePoint[];
    if (changes.length <= ACTIVITY_MAX_STEPS) {
      points = changes.map((c) => ({ x: xOf(c.time), v: c.v }));
    } else {
      const out = new Array<number>(ACTIVITY_BINS).fill(0);
      for (let i = 0; i < changes.length; i++) {
        // changes[i].v holds until the next change, touching every bin in between
        const b0 = activityBinOf(xOf(changes[i].time));
        const b1 = i + 1 < changes.length ? activityBinOf(xOf(changes[i + 1].time)) : b0;
        for (let k = b0; k <= b1; k++) if (changes[i].v > out[k]) out[k] = changes[i].v;
      }
      points = out.map((v, k) => ({ x: k * ACTIVITY_BIN_W, v }));
    }
    lines.push({ key: type, label: type, color: colors[type] ?? '#94a3b8', points });
  }

  return { kind: 'step', lines, valueAt: (time) => objectsAt(tokens, shown, time), format: fmtCount };
}

/** Exact distinct-object count per object type at one instant. */
export function objectsAt(tokens: Tokens, shown: Uint8Array, time: number): Record<string, number> {
  const ids = new Map<string, Set<number>>();
  const [lo, hi] = runningRange(tokens, time);
  for (let i = lo; i < hi; i++) {
    if (!shown[i] || time >= tokens.start[i] + tokens.duration[i]) continue;
    const type = typeOfStep(tokens, i);
    let set = ids.get(type);
    if (!set) {
      set = new Set();
      ids.set(type, set);
    }
    set.add(tokens.object[i]);
  }
  return Object.fromEntries([...ids].map(([type, set]) => [type, set.size]));
}

/**
 * Steps started (an object leaves an event) minus completed (it reaches its
 * next event) per time window, as bars around zero. Summed from the start,
 * the bars give the number of objects between events.
 */
export function computeBalanceSeries(tokens: Tokens, shown: Uint8Array): ActivitySeries {
  const { timeline } = tokens;
  const xOf = activityXOf(timeline);
  const span = Math.max(timeline.end - timeline.start, 1e-9);
  const win = RATE_WINDOWS.find((w) => span / w.seconds <= RATE_MAX_WINDOWS) ?? RATE_WINDOWS[RATE_WINDOWS.length - 1];
  const count = Math.max(1, Math.ceil(span / win.seconds));
  const indexOf = (time: number) => Math.min(count - 1, Math.max(0, Math.floor((time - timeline.start) / win.seconds)));

  const net = new Array<number>(count).fill(0);
  for (let i = 0; i < tokens.count; i++) {
    if (!shown[i]) continue;
    net[indexOf(tokens.start[i])]++;
    net[indexOf(tokens.start[i] + tokens.duration[i])]--;
  }

  return {
    kind: 'bars',
    lines: [
      {
        key: 'net',
        label: `Started minus completed per ${win.label}`,
        color: BALANCE_UP_COLOR,
        negColor: BALANCE_DOWN_COLOR,
        points: net.map((v, k) => ({ x: xOf(timeline.start + k * win.seconds), v })),
      },
    ],
    valueAt: (time) => ({ net: net[indexOf(time)] }),
    format: fmtSigned,
    footnote: `${win.label} intervals`,
  };
}

/**
 * Average time the objects between events have been waiting since their
 * last event, sampled at ACTIVITY_SAMPLES points. It rises while objects wait
 * and drops when long-waiting ones reach their next event; the line breaks
 * where no object is between events.
 */
export function computeAgeSeries(tokens: Tokens, shown: Uint8Array): ActivitySeries {
  const { timeline } = tokens;
  const xOf = activityXOf(timeline);
  const span = Math.max(timeline.end - timeline.start, 1e-9);

  // Start times relative to the timeline keep the running sum precise
  const events: { time: number; delta: 1 | -1; rel: number }[] = [];
  for (let i = 0; i < tokens.count; i++) {
    if (!shown[i]) continue;
    const rel = tokens.start[i] - timeline.start;
    events.push({ time: tokens.start[i], delta: 1, rel });
    events.push({ time: tokens.start[i] + tokens.duration[i], delta: -1, rel });
  }
  events.sort((a, b) => a.time - b.time);

  const points: CurvePoint[] = [];
  let active = 0;
  let sumRel = 0;
  let next = 0;
  for (let j = 0; j < ACTIVITY_SAMPLES; j++) {
    const t = timeline.start + (span * j) / (ACTIVITY_SAMPLES - 1);
    // A step runs for start <= t < end, so everything at or before t applies
    while (next < events.length && events[next].time <= t) {
      active += events[next].delta;
      sumRel += events[next].delta * events[next].rel;
      next++;
    }
    const v = active > 0 ? t - timeline.start - sumRel / active : NaN;
    points.push({ x: xOf(t), v });
  }

  return {
    kind: 'line',
    lines: [{ key: 'age', label: 'Average time since last event', color: NEUTRAL_CURVE_COLOR, points }],
    valueAt: (time) => ({ age: ageAt(tokens, shown, time) }),
    format: (v) => (Number.isFinite(v) ? fmtDuration(v) : '—'),
  };
}

/** Exact average time since the last event at one instant; NaN when no object is between events. */
export function ageAt(tokens: Tokens, shown: Uint8Array, time: number): number {
  let active = 0;
  let sum = 0;
  const [lo, hi] = runningRange(tokens, time);
  for (let i = lo; i < hi; i++) {
    if (!shown[i] || time >= tokens.start[i] + tokens.duration[i]) continue;
    active++;
    sum += time - tokens.start[i];
  }
  return active > 0 ? sum / active : NaN;
}
