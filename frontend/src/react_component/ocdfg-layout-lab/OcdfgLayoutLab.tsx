/**
 * OC-DFG Layout Lab: explore layout algorithms and design variants for
 * object-centric directly-follows graphs interactively.
 *
 * Every aspect of the layout (main flow, block structure, lane order, arc
 * routing, ports, bundling, self loops, arc widths, arrow heads, node style)
 * can be swapped independently; the gallery shows all variants of an aspect
 * (or a matrix of two) side by side with readability metrics.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  ClipboardPaste,
  Download,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  ScanIcon,
  Shuffle,
  Star,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { mapTypesToColors } from '@/utils/objectColors';
import ControlPanel from './ControlPanel';
import { EXAMPLES } from './examples';
import Gallery from './Gallery';
import { filterGraph } from './graph';
import LabCanvas, { type LabCanvasHandle } from './LabCanvas';
import { computeLayout } from './layout';
import { DEFAULT_OPTIONS, PRESETS, randomOptions, withDefaults, type Aspect } from './options';
import type { LabGraph, LayoutExtras, LayoutOptions, LayoutResult } from './types';
import { useEventLogDfg, useInductiveMinerTrees, useProcessAreas } from './useLabData';

const OPTIONS_KEY = 'totem.ocdfgLayoutLab.options.v1';
const FAVORITES_KEY = 'totem.ocdfgLayoutLab.favorites.v1';
const MAX_ARCS = 4000;

interface Favorite {
  id: string;
  name: string;
  options: Partial<LayoutOptions>;
}

interface OcdfgLayoutLabProps {
  fileId?: number;
  fileName?: string;
  filterEnabled?: boolean;
  localFilterParams?: Record<string, string>;
  height?: number;
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings are just not remembered */
  }
}

/** The data filters, which presets, favourites and "reset" leave alone. */
function dataFilters(o: LayoutOptions): Partial<LayoutOptions> {
  return { hiddenTypes: o.hiddenTypes, variantCoverage: o.variantCoverage, arcThreshold: o.arcThreshold };
}

/** Only the options that differ from the defaults (for sharing configs). */
function diffFromDefaults(o: LayoutOptions): Partial<LayoutOptions> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const d = (DEFAULT_OPTIONS as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(v) !== JSON.stringify(d)) out[k] = v;
  }
  return out as Partial<LayoutOptions>;
}

export default function OcdfgLayoutLab({ fileId, fileName, filterEnabled = true, localFilterParams, height = 860 }: OcdfgLayoutLabProps) {
  const [source, setSource] = useState<string>(fileId ? 'log' : EXAMPLES[0].id);
  // Follow the selected event log: a newly selected log replaces the example.
  useEffect(() => {
    setSource(fileId ? 'log' : EXAMPLES[0].id);
  }, [fileId]);

  const [options, setOptions] = useState<LayoutOptions>(() => withDefaults(readStorage<Partial<LayoutOptions>>(OPTIONS_KEY, {})));
  useEffect(() => writeStorage(OPTIONS_KEY, diffFromDefaults(options)), [options]);
  const patch = useCallback((p: Partial<LayoutOptions>) => setOptions((o) => ({ ...o, ...p })), []);

  const [favorites, setFavorites] = useState<Favorite[]>(() => readStorage<Favorite[]>(FAVORITES_KEY, []));
  useEffect(() => writeStorage(FAVORITES_KEY, favorites), [favorites]);

  const [galleryAspect, setGalleryAspect] = useState<Aspect | null>(null);
  const [highlightType, setHighlightType] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);
  const canvasRef = useRef<LabCanvasHandle>(null);

  const fromLog = source === 'log' && !!fileId;
  const logState = useEventLogDfg({ fileId, filterEnabled, localFilterParams, enabled: fromLog });
  const imState = useInductiveMinerTrees({ fileId, filterEnabled, localFilterParams, enabled: fromLog && options.blockDetection === 'im' });
  const areaState = useProcessAreas({ fileId, filterEnabled, localFilterParams, enabled: fromLog && options.laneOrder === 'processAreas' });

  const example = EXAMPLES.find((e) => e.id === source);
  const exampleGraph = useMemo(() => (example ? example.build() : null), [example]);
  const graph: LabGraph | null = fromLog ? (logState.status === 'ready' ? logState.data : null) : exampleGraph;

  const extras: LayoutExtras = useMemo(
    () => ({
      imTrees: imState.status === 'ready' ? imState.data : undefined,
      processAreas: areaState.status === 'ready' ? areaState.data : undefined,
    }),
    [imState, areaState],
  );
  const colors = useMemo(() => mapTypesToColors(graph?.types ?? []), [graph]);
  const deferred = useDeferredValue(options);

  const visibleArcs = useMemo(
    () => (graph ? filterGraph(graph, deferred.hiddenTypes, deferred.variantCoverage, deferred.arcThreshold).arcs.length : 0),
    [graph, deferred.hiddenTypes, deferred.variantCoverage, deferred.arcThreshold],
  );
  const tooLarge = visibleArcs > MAX_ARCS;
  const layout = useMemo((): { result: LayoutResult | null; error?: string } => {
    if (!graph || tooLarge) return { result: null };
    try {
      return { result: computeLayout(graph, deferred, extras) };
    } catch (e) {
      console.error(e);
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [graph, deferred, extras, tooLarge]);
  const result = layout.result;

  const fitKey = `${source}|${deferred.direction}|${deferred.hiddenTypes.join(',')}|${graph?.nodes.length ?? 0}`;

  const legendTypes = useMemo(() => {
    const visible = result?.laneOrder ?? [];
    return [...visible, ...(graph?.types ?? []).filter((t) => !visible.includes(t))];
  }, [result, graph]);

  const moveLane = (type: string, delta: number) => {
    const order = [...(result?.laneOrder ?? [])];
    const i = order.indexOf(type);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    patch({ laneOrder: 'manual', manualLaneOrder: order });
  };

  const toggleType = (type: string) => {
    const hidden = new Set(options.hiddenTypes);
    if (hidden.has(type)) hidden.delete(type);
    else hidden.add(type);
    patch({ hiddenTypes: [...hidden] });
  };

  const copyConfig = async () => {
    const text = JSON.stringify(diffFromDefaults(options), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Layout configuration copied');
    } catch {
      window.prompt('Copy the configuration:', text);
    }
  };

  const pasteConfig = () => {
    const text = window.prompt('Paste a layout configuration (JSON):');
    if (!text) return;
    try {
      setOptions(withDefaults(JSON.parse(text)));
      toast.success('Configuration applied');
    } catch {
      toast.error('That is not a valid configuration');
    }
  };

  const saveFavorite = () => {
    const d = diffFromDefaults(options);
    const name = `${favorites.length + 1}. ${options.edgeStyle} · ${options.laneOrder} · ${options.bundling}`;
    setFavorites((f) => [...f, { id: `${Date.now()}`, name, options: d }]);
    toast.success('Saved as favourite');
  };

  const exportSvg = () => {
    const svg = canvasRef.current?.svg();
    if (!svg || !result) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const b = result.bounds;
    clone.setAttribute('viewBox', `${b.minX - 30} ${b.minY - 30} ${b.maxX - b.minX + 60} ${b.maxY - b.minY + 60}`);
    clone.setAttribute('width', String(Math.round(b.maxX - b.minX + 60)));
    clone.setAttribute('height', String(Math.round(b.maxY - b.minY + 60)));
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ocdfg-layout.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const m = result?.metrics;
  const status = fromLog ? logState : { status: 'ready' as const };

  return (
    <div className="flex w-full flex-col gap-3" data-testid="ocdfg-layout-lab">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
        <span className="text-sm font-semibold text-slate-800">OC-DFG Layout Lab</span>
        <select
          className="h-8 max-w-[260px] rounded-md border border-slate-300 bg-white px-2"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label="Data"
          data-testid="layout-lab-source"
        >
          {fileId && <option value="log">Event log{fileName ? `: ${fileName}` : ''}</option>}
          <optgroup label="Examples">
            {EXAMPLES.map((e) => (
              <option key={e.id} value={e.id} title={e.description}>
                {e.label}
              </option>
            ))}
          </optgroup>
        </select>
        <select
          className="h-8 rounded-md border border-slate-300 bg-white px-2"
          value=""
          onChange={(e) => {
            const preset = PRESETS.find((p) => p.id === e.target.value);
            if (preset) setOptions(withDefaults({ ...preset.options, ...dataFilters(options) }));
          }}
          aria-label="Apply preset"
          data-testid="layout-lab-preset"
        >
          <option value="">Apply preset…</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id} title={p.description}>
              {p.label}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => setOptions((o) => ({ ...randomOptions(o), ...dataFilters(o) }))} title="Random combination of all aspects">
          <Shuffle className="h-3.5 w-3.5" /> Surprise me
        </Button>
        <Button variant="outline" size="sm" onClick={() => setOptions({ ...DEFAULT_OPTIONS, ...dataFilters(options) })} title="Back to the defaults">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
        <Button variant="outline" size="sm" onClick={saveFavorite} title="Remember this combination">
          <Star className="h-3.5 w-3.5" /> Save
        </Button>
        <Button variant="outline" size="sm" onClick={copyConfig} title="Copy the configuration as JSON">
          <ClipboardCopy className="h-3.5 w-3.5" /> Copy config
        </Button>
        <Button variant="outline" size="sm" onClick={pasteConfig} title="Apply a configuration from JSON">
          <ClipboardPaste className="h-3.5 w-3.5" /> Paste
        </Button>
        <Button variant="outline" size="sm" onClick={exportSvg} disabled={!result} title="Download the drawing as SVG">
          <Download className="h-3.5 w-3.5" /> SVG
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => canvasRef.current?.zoom(1 / 1.25)} aria-label="Zoom in">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => canvasRef.current?.zoom(1.25)} aria-label="Zoom out">
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => canvasRef.current?.fit()} aria-label="Fit to view">
            <ScanIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: '300px minmax(0, 1fr)', height }}>
        {/* Controls */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
          <ControlPanel options={options} onChange={patch} onGallery={setGalleryAspect} hasVariantRanks={!!graph?.variantCounts && Object.keys(graph.variantCounts).length > 0} />
          {favorites.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Favourites</div>
              {favorites.map((f) => (
                <div key={f.id} className="flex items-center gap-1">
                  <button type="button" className="flex-1 truncate rounded px-1 py-1 text-left text-slate-700 hover:bg-slate-100" onClick={() => setOptions(withDefaults({ ...f.options, ...dataFilters(options) }))} title={JSON.stringify(f.options)}>
                    {f.name}
                  </button>
                  <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" onClick={() => setFavorites((list) => list.filter((x) => x.id !== f.id))} aria-label={`Delete ${f.name}`}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Canvas */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-3 py-2 text-xs text-slate-600" data-testid="layout-lab-metrics">
            {m ? (
              <>
                <Metric label="Crossings" value={m.crossings} good={m.crossings === 0} />
                <Metric label="Overlapping arcs" value={m.overlaps} good={m.overlaps === 0} />
                <Metric label="Arcs through nodes" value={m.nodeHits} good={m.nodeHits === 0} />
                <Metric label="Bends" value={m.bends} />
                <Metric label="Loop arcs" value={m.backArcs} />
                <span className="text-slate-400">
                  {m.width}×{m.height}px · {result!.nodes.length} nodes · {result!.arcs.length} arcs · {m.ms} ms
                </span>
              </>
            ) : (
              <span className="text-slate-400">No layout yet</span>
            )}
            {imState.status === 'loading' && (
              <span className="flex items-center gap-1 text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" /> running the inductive miner…
              </span>
            )}
            {areaState.status === 'loading' && (
              <span className="flex items-center gap-1 text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" /> computing process areas…
              </span>
            )}
          </div>
          {[...(result?.notes ?? []), ...(imState.status === 'error' ? [`Inductive miner: ${imState.message}`] : []), ...(areaState.status === 'error' ? [`Process areas: ${areaState.message}`] : [])].map((n) => (
            <div key={n} className="border-b border-amber-100 bg-amber-50 px-3 py-1 text-[11px] text-amber-800">
              {n}
            </div>
          ))}
          <div className="relative min-h-0 flex-1">
            {status.status === 'loading' && (
              <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-white/70 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the OC-DFG…
              </div>
            )}
            {status.status === 'error' && <div className="p-4 text-sm text-red-600">{status.message}</div>}
            {tooLarge && (
              <div className="p-4 text-sm text-slate-600">
                {visibleArcs} arcs are too many to explore interactively. Raise the arc frequency filter, lower the variant coverage or hide object types.
              </div>
            )}
            {layout.error && <div className="p-4 text-sm text-red-600">Layout failed: {layout.error}</div>}
            {result && result.nodes.length === 0 && !tooLarge && <div className="p-4 text-sm text-slate-500">Nothing to show — all object types are hidden or the log is empty.</div>}
            {result && result.nodes.length > 0 && (
              <LabCanvas ref={canvasRef} result={result} options={deferred} colors={colors} fitKey={fitKey} highlightType={highlightType} />
            )}
            {/* Legend */}
            {legendTypes.length > 0 && (
              <div className="absolute left-2 top-2 z-10 max-h-[60%] min-w-[150px] overflow-y-auto rounded-md border border-slate-200 bg-white/95 p-2 text-xs shadow-sm" data-testid="layout-lab-legend">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                  onClick={() => setLegendOpen((v) => !v)}
                  aria-expanded={legendOpen}
                >
                  Object types
                  <span className="font-normal normal-case text-slate-400">{legendOpen ? 'lane order ▴' : `${legendTypes.length} ▾`}</span>
                </button>
                {legendOpen && legendTypes.map((t) => {
                  const visible = !options.hiddenTypes.includes(t);
                  const lane = result?.laneOrder.indexOf(t) ?? -1;
                  return (
                    <div key={t} className="flex items-center gap-1.5 py-0.5" onMouseEnter={() => visible && setHighlightType(t)} onMouseLeave={() => setHighlightType(null)}>
                      <input type="checkbox" checked={visible} onChange={() => toggleType(t)} aria-label={`Show ${t}`} className="accent-slate-700" />
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[t] }} />
                      <span className={`flex-1 truncate ${visible ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{t}</span>
                      {visible && lane >= 0 && (
                        <span className="flex">
                          <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30" disabled={lane === 0} onClick={() => moveLane(t, -1)} aria-label={`Move ${t} left`}>
                            <ArrowUp className="h-3 w-3 -rotate-90" />
                          </button>
                          <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30" disabled={lane === (result?.laneOrder.length ?? 0) - 1} onClick={() => moveLane(t, 1)} aria-label={`Move ${t} right`}>
                            <ArrowDown className="h-3 w-3 -rotate-90" />
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {result && result.typeSummaries.length > 0 && (
            <details className="border-t border-slate-100 px-3 py-2 text-xs">
              <summary className="cursor-pointer select-none text-slate-600">Detected structure per object type</summary>
              <table className="mt-2 w-full text-left">
                <thead className="text-[10px] uppercase text-slate-400">
                  <tr>
                    <th className="py-1 pr-2">Lane</th>
                    <th className="pr-2">Type</th>
                    <th className="pr-2">Activities</th>
                    <th className="pr-2">Loop arcs</th>
                    <th className="pr-2">Parallel arcs</th>
                    <th>Block structure (→ sequence, × choice, ∧ parallel, ↺ loop, ✿ unstructured)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.typeSummaries.map((s) => (
                    <tr key={s.type} className="border-t border-slate-100 align-top">
                      <td className="py-1 pr-2 tabular-nums">{s.lane + 1}</td>
                      <td className="pr-2 font-medium" style={{ color: colors[s.type] }}>
                        {s.type}
                      </td>
                      <td className="pr-2 tabular-nums">{s.activities}</td>
                      <td className="pr-2 tabular-nums">{s.backArcs}</td>
                      <td className="pr-2 tabular-nums">{s.interleaveArcs}</td>
                      <td className="break-all font-mono text-[10.5px] text-slate-600">{s.blockTree}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      </div>

      {galleryAspect && graph && (
        <Gallery
          graph={graph}
          extras={extras}
          options={options}
          colors={colors}
          aspect={galleryAspect}
          onPick={patch}
          onClose={() => setGalleryAspect(null)}
        />
      )}
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: number; good?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-slate-500">{label}</span>
      <span className={`rounded px-1.5 font-semibold tabular-nums ${good === undefined ? 'bg-slate-100 text-slate-700' : good ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{value}</span>
    </span>
  );
}
