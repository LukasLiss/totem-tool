/**
 * The layout panel of an OC-DFG view: opened from the view's toolbar, it
 * changes the layout interactively. Changes are stored where the view keeps
 * its layout (dashboard widget or project); "Reset to defaults" removes them.
 */
import { RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ControlPanel from './ControlPanel';
import { LAYOUT_PANEL_WIDTH, PRESETS, type Aspect } from './options';
import type { LayoutMetrics, LayoutOptions } from './types';

interface LayoutPanelProps {
  options: LayoutOptions;
  /** The view's defaults; presets apply on top of them. */
  defaults: LayoutOptions;
  onChange: (patch: Partial<LayoutOptions>) => void;
  onReset: () => void;
  onClose: () => void;
  onGallery?: (aspect: Aspect) => void;
  laneOrder: string[];
  colors: Record<string, string>;
  metrics?: LayoutMetrics;
  notes: string[];
}

export default function LayoutPanel({
  options,
  defaults,
  onChange,
  onReset,
  onClose,
  onGallery,
  laneOrder,
  colors,
  metrics,
  notes,
}: LayoutPanelProps) {
  return (
    <div
      className="absolute bottom-3 right-3 top-3 z-20 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50/95 shadow-xl backdrop-blur-sm"
      style={{ width: LAYOUT_PANEL_WIDTH, fontFamily: 'var(--font-primary, Inter, sans-serif)' }}
      data-testid="ocdfg-layout-panel"
      // Keep wheel/drag inside the panel from reaching the canvas.
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="text-sm font-semibold text-slate-800">Layout</span>
        <Button type="button" variant="outline" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={onReset} title="Back to the default layout">
          <RotateCcw className="h-3 w-3" /> Reset to defaults
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close layout panel">
          <X className="h-4 w-4" />
        </Button>
      </div>
      {metrics && (
        <div className="flex flex-wrap gap-x-3 border-b border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-500">
          <Metric label="Crossings" value={metrics.crossings} />
          <Metric label="Overlapping arcs" value={metrics.overlaps} />
          <Metric label="Arcs through nodes" value={metrics.nodeHits} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        <select
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
          value=""
          onChange={(e) => {
            const preset = PRESETS.find((p) => p.id === e.target.value);
            if (preset) onChange({ ...defaults, ...preset.options });
          }}
          aria-label="Apply preset"
        >
          <option value="">Apply preset…</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id} title={p.description}>
              {p.label}
            </option>
          ))}
        </select>
        {notes.map((n) => (
          <div key={n} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            {n}
          </div>
        ))}
        <ControlPanel options={options} onChange={onChange} onGallery={onGallery} laneOrder={laneOrder} colors={colors} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span>
      {label} <span className={`font-semibold tabular-nums ${value === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{value}</span>
    </span>
  );
}
