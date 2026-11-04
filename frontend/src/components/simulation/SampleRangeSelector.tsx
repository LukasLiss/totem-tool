import React from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";

const HIST_HEIGHT_PX = 56;

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** Display unit + conversions for the number inputs, chosen by the max value. */
function inputUnit(maxVal: number) {
  if (maxVal <= 300)
    return { label: "s", toDisplay: (s: number) => Math.round(s), toSeconds: (v: number) => v, step: 1 };
  if (maxVal <= 18000)
    return {
      label: "min",
      toDisplay: (s: number) => Math.round((s / 60) * 10) / 10,
      toSeconds: (v: number) => v * 60,
      step: 0.5,
    };
  return {
    label: "h",
    toDisplay: (s: number) => Math.round((s / 3600) * 100) / 100,
    toSeconds: (v: number) => v * 3600,
    step: 0.25,
  };
}

type Seg = { w: number; a: number; b: number };

/** Clip the histogram to [lo, hi]; each bin contributes its overlap fraction. */
function clippedSegments(edges: number[], counts: number[], lo: number, hi: number) {
  const segs: Seg[] = [];
  let total = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (!c) continue;
    const e0 = edges[i];
    const e1 = edges[i + 1] ?? edges[i];
    if (e1 <= e0) {
      if (lo <= e0 && e0 <= hi) {
        segs.push({ w: c, a: e0, b: e0 });
        total += c;
      }
      continue;
    }
    const a = Math.max(e0, lo);
    const b = Math.min(e1, hi);
    if (b <= a) continue;
    const w = (c * (b - a)) / (e1 - e0);
    segs.push({ w, a, b });
    total += w;
  }
  return { segs, total };
}

/** p-quantile of the empirical distribution restricted to [lo, hi]. */
function quantileInRange(edges: number[], counts: number[], lo: number, hi: number, p: number): number {
  const { segs, total } = clippedSegments(edges, counts, lo, hi);
  if (total <= 0) return lo;
  const target = p * total;
  let cum = 0;
  for (const s of segs) {
    if (cum + s.w >= target) {
      const frac = s.w > 0 ? (target - cum) / s.w : 0;
      return s.a + frac * (s.b - s.a);
    }
    cum += s.w;
  }
  return hi;
}

/** Histogram of an empirical duration distribution with a selectable range. */
export const SampleRangeSelector: React.FC<{
  edges: number[];
  counts: number[];
  minS: number;
  maxS: number;
  selMin: number;
  selMax: number;
  onChange: (a: number, b: number) => void;
}> = ({ edges, counts, minS, maxS, selMin, selMax, onChange }) => {
  const domainLo = edges[0] ?? 0;
  const domainHi = edges[edges.length - 1] ?? 0;
  const total = counts.reduce((a, b) => a + b, 0);
  const maxCount = Math.max(...counts, 1);

  const emit = (a: number, b: number) => {
    const lo = Math.max(domainLo, Math.min(a, b));
    const hi = Math.min(domainHi, Math.max(a, b));
    onChange(lo, hi);
  };
  const presetKeepBelow = (removeTop: number) =>
    emit(domainLo, quantileInRange(edges, counts, domainLo, domainHi, 1 - removeTop));

  const { total: usedRaw } = clippedSegments(edges, counts, selMin, selMax);
  const used = Math.round(usedRaw);
  const pct = total > 0 ? (usedRaw / total) * 100 : 100;
  const median = quantileInRange(edges, counts, selMin, selMax, 0.5);
  const p90 = quantileInRange(edges, counts, selMin, selMax, 0.9);
  const trimmed = selMin > domainLo + 1e-6 || selMax < domainHi - 1e-6;

  const unit = inputUnit(domainHi);
  const sliderStep = Math.max(1, Math.round((domainHi - domainLo) / 300));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {[
            { label: "Alle", fn: () => emit(domainLo, domainHi) },
            { label: "Top 1%", fn: () => presetKeepBelow(0.01) },
            { label: "Top 5%", fn: () => presetKeepBelow(0.05) },
            { label: "Top 10%", fn: () => presetKeepBelow(0.1) },
          ].map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={p.fn}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {used} / {total} Samples · {pct.toFixed(1)}%
        </span>
      </div>

      {/* Histogram: bars inside the selected range are solid, outside are muted. */}
      <div className="flex items-end gap-px" style={{ height: HIST_HEIGHT_PX }}>
        {counts.map((count, i) => {
          const e0 = edges[i];
          const e1 = edges[i + 1] ?? edges[i];
          const center = (e0 + e1) / 2;
          const inRange = center >= selMin && center <= selMax;
          const h = Math.max(2, (count / maxCount) * HIST_HEIGHT_PX);
          return (
            <div
              key={i}
              title={`${formatDuration(e0)} – ${formatDuration(e1)} · ${count} sample(s)`}
              className={`flex-1 min-w-[2px] rounded-sm transition-colors ${
                inRange ? "bg-primary" : "bg-muted"
              }`}
              style={{ height: h }}
            />
          );
        })}
      </div>

      <Slider
        value={[selMin, selMax]}
        min={domainLo}
        max={domainHi}
        step={sliderStep}
        onValueChange={([a, b]) => emit(a, b)}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Min</span>
          <Input
            type="number"
            min={unit.toDisplay(domainLo)}
            step={unit.step}
            value={unit.toDisplay(selMin)}
            onChange={(e) => emit(unit.toSeconds(parseFloat(e.target.value) || 0), selMax)}
            className="h-6 w-24 text-xs"
          />
          <span className="text-[10px] text-muted-foreground w-4">{unit.label}</span>
          <span className="text-[10px] text-muted-foreground">Max</span>
          <Input
            type="number"
            min={0}
            step={unit.step}
            value={unit.toDisplay(selMax)}
            onChange={(e) => emit(selMin, unit.toSeconds(parseFloat(e.target.value) || 0))}
            className="h-6 w-24 text-xs"
          />
          <span className="text-[10px] text-muted-foreground w-4">{unit.label}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          Median {formatDuration(median)} · P90 {formatDuration(p90)} · Max{" "}
          {formatDuration(selMax)}
          {trimmed ? "" : ` · voller Bereich ${formatDuration(minS)}–${formatDuration(maxS)}`}
        </span>
      </div>
    </div>
  );
};

export default SampleRangeSelector;
