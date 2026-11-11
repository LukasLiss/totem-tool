/** The option controls of the OC-DFG layout panel, grouped by aspect. */
import { ArrowDown, ArrowUp, LayoutGrid } from 'lucide-react';
import { ASPECTS, NUMERIC_BOUNDS, type Aspect, type AspectGroup, type NumericOption } from './options';
import type { LayoutOptions } from './types';

interface ControlPanelProps {
  options: LayoutOptions;
  onChange: (patch: Partial<LayoutOptions>) => void;
  onGallery?: (aspect: Aspect) => void;
  /** Current lane order (left to right) for the manual reordering list. */
  laneOrder?: string[];
  colors?: Record<string, string>;
}

const GROUPS: AspectGroup[] = ['Structure', 'Object types', 'Arcs', 'Look'];

export default function ControlPanel({ options, onChange, onGallery, laneOrder = [], colors = {} }: ControlPanelProps) {
  const o = options;
  const range = (key: NumericOption, label: string, format: (v: number) => string, hint?: string, onValue?: (v: number) => void) => (
    <Range
      label={label}
      value={o[key]}
      {...NUMERIC_BOUNDS[key]}
      format={format}
      onChange={onValue ?? ((v) => onChange({ [key]: v } as Partial<LayoutOptions>))}
      hint={hint}
    />
  );
  const px = (v: number) => `${v}px`;
  const moveLane = (type: string, delta: number) => {
    const order = [...laneOrder];
    const i = order.indexOf(type);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onChange({ laneOrder: 'manual', manualLaneOrder: order });
  };
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="layout-controls">
      {GROUPS.map((group) => (
        <details key={group} open className="rounded-md border border-slate-200 bg-white">
          <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {group}
          </summary>
          <div className="flex flex-col gap-2.5 px-3 pb-3">
            {ASPECTS.filter((a) => a.group === group).map((aspect) => (
              <AspectSelect key={aspect.key} aspect={aspect} value={String(o[aspect.key])} onChange={onChange} onGallery={onGallery} />
            ))}
            {group === 'Structure' && (
              <>
                {o.blockDetection === 'light' &&
                  range('blockNoise', 'Noise threshold (IMf)', (v) => `${Math.round(v * 100)} %`, "Arcs lighter than this share of their source's heaviest outgoing arc are ignored while searching cuts.")}
                {range('rankGap', 'Layer gap', px)}
              </>
            )}
            {group === 'Object types' && (
              <>
                {laneOrder.length > 1 && (
                  <div className="flex flex-col gap-0.5" data-testid="layout-lane-order">
                    <span className="font-medium text-slate-700">Lanes (left to right)</span>
                    {laneOrder.map((t, i) => (
                      <div key={t} className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[t] ?? '#64748b' }} />
                        <span className="flex-1 truncate text-slate-700">{t}</span>
                        <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30" disabled={i === 0} onClick={() => moveLane(t, -1)} aria-label={`Move ${t} left`}>
                          <ArrowUp className="h-3 w-3 -rotate-90" />
                        </button>
                        <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30" disabled={i === laneOrder.length - 1} onClick={() => moveLane(t, 1)} aria-label={`Move ${t} right`}>
                          <ArrowDown className="h-3 w-3 -rotate-90" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {range('nodeGap', 'Gap between nodes', px)}
                {range('laneGap', 'Gap between lanes', px)}
                <Toggle label="Show lanes" checked={o.showLanes} onChange={(v) => onChange({ showLanes: v })} />
              </>
            )}
            {group === 'Arcs' && (
              <>
                <Toggle label="Merge points (join arcs of a type before a node)" checked={o.mergePoints} onChange={(v) => onChange({ mergePoints: v })} />
                {(o.edgeStyle === 'orthogonal' || o.edgeStyle === 'octilinear') && range('cornerRadius', 'Corner radius', px)}
                {range('trackGap', 'Track gap', px, 'Space between parallel lines (highways, channels, ports).')}
                {range('minWidth', 'Min. width', (v) => v.toFixed(1), undefined, (v) => onChange({ minWidth: v, maxWidth: Math.max(v, o.maxWidth) }))}
                {range('maxWidth', 'Max. width', (v) => v.toFixed(1), undefined, (v) => onChange({ maxWidth: v, minWidth: Math.min(v, o.minWidth) }))}
                {range('arrowSize', 'Arrow size', (v) => `${v.toFixed(2)}×`)}
                {range('arcOpacity', 'Opacity', (v) => `${Math.round(v * 100)} %`)}
                <Toggle label="White halo (crossings read over/under)" checked={o.arcHalo} onChange={(v) => onChange({ arcHalo: v })} />
                <Toggle label="Frequency labels on arcs" checked={o.arcLabels === 'frequency'} onChange={(v) => onChange({ arcLabels: v ? 'frequency' : 'none' })} />
              </>
            )}
            {group === 'Look' && (
              <>
                <Toggle label="Node width fits label" checked={o.fitNodeWidth} onChange={(v) => onChange({ fitNodeWidth: v })} />
                <Toggle label="Show frequencies" checked={o.showFrequencies} onChange={(v) => onChange({ showFrequencies: v })} />
                <Toggle label="Show layers (debug)" checked={o.showRanks} onChange={(v) => onChange({ showRanks: v })} />
              </>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function AspectSelect({
  aspect,
  value,
  onChange,
  onGallery,
}: {
  aspect: Aspect;
  value: string;
  onChange: (patch: Partial<LayoutOptions>) => void;
  onGallery?: (aspect: Aspect) => void;
}) {
  const current = aspect.choices.find((c) => c.value === value);
  const id = `lab-${aspect.key}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="font-medium text-slate-700">
          {aspect.label}
        </label>
        {onGallery && <button
          type="button"
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          onClick={() => onGallery(aspect)}
          title={`Compare all variants of "${aspect.label}" side by side`}
          aria-label={`Compare ${aspect.label}`}
        >
          <LayoutGrid className="h-3 w-3" /> compare
        </button>}
      </div>
      <select
        id={id}
        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-slate-500 focus:outline-none"
        value={value}
        onChange={(e) => onChange({ [aspect.key]: e.target.value } as Partial<LayoutOptions>)}
      >
        {aspect.choices.map((c) => (
          <option key={c.value} value={c.value} title={c.hint}>
            {c.label}
          </option>
        ))}
      </select>
      {current && <p className="leading-snug text-[10.5px] text-slate-500">{current.hint}</p>}
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1" title={hint}>
      <span className="flex justify-between font-medium text-slate-700">
        {label}
        <span className="font-normal tabular-nums text-slate-500">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-slate-700" />
      {hint && <span className="text-[10.5px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-slate-700" />
      {label}
    </label>
  );
}
