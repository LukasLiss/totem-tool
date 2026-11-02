/** The option controls of the layout lab, grouped by aspect. */
import { LayoutGrid } from 'lucide-react';
import { ASPECTS, type Aspect, type AspectGroup } from './options';
import type { LayoutOptions } from './types';

interface ControlPanelProps {
  options: LayoutOptions;
  onChange: (patch: Partial<LayoutOptions>) => void;
  onGallery: (aspect: Aspect) => void;
  hasVariantRanks: boolean;
}

const GROUPS: AspectGroup[] = ['Structure', 'Object types', 'Arcs', 'Look'];

export default function ControlPanel({ options, onChange, onGallery, hasVariantRanks }: ControlPanelProps) {
  const o = options;
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="layout-lab-controls">
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
                {o.blockDetection === 'light' && (
                  <Range label="Noise threshold (IMf)" value={o.blockNoise} min={0} max={0.5} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => onChange({ blockNoise: v })} hint="Arcs lighter than this share of their source's heaviest outgoing arc are ignored while searching cuts." />
                )}
                <Range label="Layer gap" value={o.rankGap} min={24} max={140} step={2} format={(v) => `${v}px`} onChange={(v) => onChange({ rankGap: v })} />
              </>
            )}
            {group === 'Object types' && (
              <>
                <Range label="Gap between nodes" value={o.nodeGap} min={8} max={90} step={2} format={(v) => `${v}px`} onChange={(v) => onChange({ nodeGap: v })} />
                <Range label="Gap between lanes" value={o.laneGap} min={0} max={160} step={4} format={(v) => `${v}px`} onChange={(v) => onChange({ laneGap: v })} />
                <Toggle label="Show lanes" checked={o.showLanes} onChange={(v) => onChange({ showLanes: v })} />
              </>
            )}
            {group === 'Arcs' && (
              <>
                <Toggle label="Merge points (join arcs of a type before a node)" checked={o.mergePoints} onChange={(v) => onChange({ mergePoints: v })} />
                {(o.edgeStyle === 'orthogonal' || o.edgeStyle === 'octilinear') && (
                  <Range label="Corner radius" value={o.cornerRadius} min={0} max={30} step={1} format={(v) => `${v}px`} onChange={(v) => onChange({ cornerRadius: v })} />
                )}
                <Range label="Track gap" value={o.trackGap} min={1} max={16} step={0.5} format={(v) => `${v}px`} onChange={(v) => onChange({ trackGap: v })} hint="Space between parallel lines (highways, channels, ports)." />
                <Range label="Min. width" value={o.minWidth} min={0.5} max={8} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => onChange({ minWidth: v, maxWidth: Math.max(v, o.maxWidth) })} />
                <Range label="Max. width" value={o.maxWidth} min={0.5} max={16} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => onChange({ maxWidth: v, minWidth: Math.min(v, o.minWidth) })} />
                <Range label="Arrow size" value={o.arrowSize} min={0.4} max={2.5} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => onChange({ arrowSize: v })} />
                <Range label="Opacity" value={o.arcOpacity} min={0.2} max={1} step={0.05} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => onChange({ arcOpacity: v })} />
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
      <div className="flex flex-col gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Data</div>
        <Range
          label="Min. arc frequency"
          value={o.arcThreshold}
          min={0}
          max={0.5}
          step={0.01}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(v) => onChange({ arcThreshold: v })}
          hint="Hide arcs lighter than this share of their object type's heaviest arc."
        />
        {hasVariantRanks && (
          <Range
            label="Variant coverage"
            value={o.variantCoverage}
            min={0.01}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={(v) => onChange({ variantCoverage: v })}
            hint="Only arcs of the most frequent variants of each object type (share of all variants)."
          />
        )}
      </div>
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
  onGallery: (aspect: Aspect) => void;
}) {
  const current = aspect.choices.find((c) => c.value === value);
  const id = `lab-${aspect.key}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="font-medium text-slate-700">
          {aspect.label}
        </label>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          onClick={() => onGallery(aspect)}
          title={`Compare all variants of "${aspect.label}" side by side`}
          aria-label={`Compare ${aspect.label}`}
        >
          <LayoutGrid className="h-3 w-3" /> compare
        </button>
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
