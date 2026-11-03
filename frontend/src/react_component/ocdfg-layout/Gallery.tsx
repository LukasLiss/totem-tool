/**
 * Small multiples: the current layout once per variant of one aspect, or a
 * matrix of two aspects. Click a cell to adopt that combination.
 */
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LabCanvas, { type ViewBox } from './LabCanvas';
import { computeLayout } from './layout';
import { ASPECTS, ASPECT_BY_KEY, type Aspect } from './options';
import type { LabGraph, LayoutExtras, LayoutOptions, LayoutResult } from './types';

interface GalleryProps {
  graph: LabGraph;
  extras: LayoutExtras;
  options: LayoutOptions;
  colors: Record<string, string>;
  aspect: Aspect;
  onPick: (patch: Partial<LayoutOptions>) => void;
  onClose: () => void;
}

interface Cell {
  patch: Partial<LayoutOptions>;
  label: string;
  result: LayoutResult | null;
  error?: string;
}

export default function Gallery({ graph, extras, options, colors, aspect: initial, onPick, onClose }: GalleryProps) {
  const [aspectKey, setAspectKey] = useState<keyof LayoutOptions>(initial.key);
  const [secondKey, setSecondKey] = useState<keyof LayoutOptions | ''>('');
  // One shared view: zooming into a cell shows the same region in all cells.
  const [syncZoom, setSyncZoom] = useState(true);
  const [sharedView, setSharedView] = useState<ViewBox | null>(null);
  const aspect = ASPECT_BY_KEY[aspectKey] ?? initial;
  const second = secondKey ? ASPECT_BY_KEY[secondKey] : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    const rowChoices = second ? second.choices : [null];
    return rowChoices.map((row) =>
      aspect.choices.map((col): Cell => {
        const patch = { [aspect.key]: col.value, ...(row && second ? { [second.key]: row.value } : {}) } as Partial<LayoutOptions>;
        try {
          return { patch, label: col.label, result: computeLayout(graph, { ...options, ...patch }, extras) };
        } catch (e) {
          return { patch, label: col.label, result: null, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  }, [graph, extras, options, aspect, second]);

  const best = useMemo(() => {
    let min = Infinity;
    rows.flat().forEach((c) => {
      if (!c.result) return;
      const score = c.result.metrics.crossings + 3 * c.result.metrics.overlaps + 2 * c.result.metrics.nodeHits;
      min = Math.min(min, score);
    });
    return min;
  }, [rows]);

  const isCurrent = (patch: Partial<LayoutOptions>) =>
    Object.entries(patch).every(([k, v]) => (options as unknown as Record<string, unknown>)[k] === v);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Compare layout variants">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 text-sm">
          <span className="font-semibold text-slate-800">Compare</span>
          <select className="h-8 rounded-md border border-slate-300 px-2 text-xs" value={aspectKey} onChange={(e) => setAspectKey(e.target.value as keyof LayoutOptions)} aria-label="Aspect in the columns">
            {ASPECTS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
          <span className="text-slate-500">×</span>
          <select className="h-8 rounded-md border border-slate-300 px-2 text-xs" value={secondKey} onChange={(e) => setSecondKey(e.target.value as keyof LayoutOptions | '')} aria-label="Aspect in the rows">
            <option value="">(nothing — one row)</option>
            {ASPECTS.filter((a) => a.key !== aspectKey).map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={syncZoom} onChange={(e) => setSyncZoom(e.target.checked)} className="accent-slate-700" /> sync zoom
          </label>
          {sharedView && (
            <button type="button" className="text-xs text-slate-500 underline" onClick={() => setSharedView(null)}>
              reset zoom
            </button>
          )}
          <span className="text-xs text-slate-500">Scroll to zoom, drag to pan. Everything else as currently selected. Green = fewest problems.</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close comparison">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: `${second ? '120px ' : ''}repeat(${aspect.choices.length}, minmax(260px, 1fr))` }}>
            {second && <div />}
            {second &&
              aspect.choices.map((c) => (
                <div key={c.value} className="text-center text-xs font-semibold text-slate-600">
                  {c.label}
                </div>
              ))}
            {rows.map((row, ri) => (
              <RowCells
                key={ri}
                rowLabel={second ? second.choices[ri].label : undefined}
                cells={row}
                options={options}
                colors={colors}
                best={best}
                isCurrent={isCurrent}
                tall={!second}
                view={syncZoom ? sharedView : undefined}
                onViewChange={syncZoom ? setSharedView : undefined}
                onPick={(p) => {
                  onPick(p);
                  onClose();
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowCells({
  rowLabel,
  cells,
  options,
  colors,
  best,
  isCurrent,
  onPick,
  tall,
  view,
  onViewChange,
}: {
  tall: boolean;
  view?: ViewBox | null;
  onViewChange?: (v: ViewBox) => void;
  rowLabel?: string;
  cells: Cell[];
  options: LayoutOptions;
  colors: Record<string, string>;
  best: number;
  isCurrent: (p: Partial<LayoutOptions>) => boolean;
  onPick: (p: Partial<LayoutOptions>) => void;
}) {
  return (
    <>
      {rowLabel !== undefined && <div className="flex items-center text-xs font-semibold text-slate-600">{rowLabel}</div>}
      {cells.map((cell, i) => {
        const m = cell.result?.metrics;
        const score = m ? m.crossings + 3 * m.overlaps + 2 * m.nodeHits : Infinity;
        const current = isCurrent(cell.patch);
        return (
          <div
            key={i}
            className={`flex flex-col overflow-hidden rounded-md border text-left transition hover:shadow-md ${
              current ? 'border-slate-800 ring-2 ring-slate-800' : score === best ? 'border-emerald-500 ring-1 ring-emerald-400' : 'border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1">
              <span className="truncate text-xs font-semibold text-slate-800">{rowLabel ? '' : cell.label}</span>
              {current ? (
                <span className="text-[10px] uppercase text-slate-500">current</span>
              ) : (
                <button type="button" className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-slate-700" onClick={() => onPick(cell.patch)}>
                  Use this
                </button>
              )}
            </div>
            <div className="w-full" style={{ height: tall ? 'min(68vh, 760px)' : 340 }}>
              {cell.result ? (
                <LabCanvas
                  result={cell.result}
                  options={{ ...options, ...cell.patch }}
                  colors={colors}
                  view={view === null ? undefined : view}
                  onViewChange={onViewChange}
                />
              ) : (
                <div className="p-3 text-xs text-red-600">{cell.error}</div>
              )}
            </div>
            {m && (
              <div className="flex flex-wrap gap-x-2 border-t border-slate-100 px-2 py-1 text-[10.5px] tabular-nums text-slate-600">
                <span title="Arc crossings">✕ {m.crossings}</span>
                <span title="Pairs of arcs lying on top of each other">≡ {m.overlaps}</span>
                <span title="Arcs running through nodes">▣ {m.nodeHits}</span>
                <span title="Bends">∠ {m.bends}</span>
                <span title="Drawing size">
                  {m.width}×{m.height}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
