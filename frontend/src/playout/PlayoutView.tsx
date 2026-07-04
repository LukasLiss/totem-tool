/**
 * Object-Centric Playout view.
 *
 * Loads an OCPN or OCCN model (from the corresponding editor session, a
 * JSON file, or a built-in example), lets the user fix the number of
 * objects per object type and the maximum occurrences per activity for
 * one process execution, and then enumerates all object-centric variants
 * the model allows within those limits ("wide" playout). Each variant can
 * be exported as one process execution with its own objects, so the
 * resulting OCEL has perfectly disconnected object components.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CircleDot,
  Download,
  FileJson,
  FlaskConical,
  FolderOpen,
  Play,
  Square,
  Workflow,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { downloadJson, openJsonFile, toFilename } from '@/editors/shared/io';
import {
  detectModelFormat,
  parseOccnModelFile,
  parseOcpnModelFile,
  type OccnModelFile,
  type OcpnModelFile,
} from '@/editors/shared/model-types';
import { loadEditorSession } from '@/editors/shared/sessionCache';
import { exampleModel as ocpnExample } from '@/editors/ocpn/model';
import { buildOccnExample } from '@/editors/occn/model';
import { variantsToJson, variantsToOcel } from './engine/ocel';
import type { PlayoutProgress, PlayoutResult, PlayoutVariant } from './engine/types';
import {
  buildActivityLimits,
  limitRowsFor,
  type PlayoutModelSource,
  type PlayoutRequest,
  type PlayoutWorkerMessage,
} from './model';

const DEFAULT_TIMEOUT_S = 5;
const MAX_STORED_VARIANTS = 2000;
const MAX_STATES = 5_000_000;
const MAX_LISTED_VARIANTS = 100;
const FALLBACK_COLOR = '#64748b';

export function PlayoutView() {
  const [source, setSource] = useState<PlayoutModelSource | null>(null);
  const [objectCounts, setObjectCounts] = useState<Record<string, number>>({});
  const [rowLimits, setRowLimits] = useState<Record<string, number>>({});
  const [timeoutS, setTimeoutS] = useState(DEFAULT_TIMEOUT_S);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PlayoutProgress | null>(null);
  const [result, setResult] = useState<PlayoutResult | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const limitRows = useMemo(() => (source ? limitRowsFor(source) : []), [source]);
  const typeColors = useMemo(() => {
    const colors = new Map<string, string>();
    for (const t of source?.model.objectTypes ?? []) colors.set(t.name, t.color ?? FALLBACK_COLOR);
    return colors;
  }, [source]);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
  }, []);
  useEffect(() => stopWorker, [stopWorker]);

  const adoptSource = (next: PlayoutModelSource) => {
    stopWorker();
    setSource(next);
    setObjectCounts(Object.fromEntries(next.model.objectTypes.map((t) => [t.name, 1])));
    setRowLimits(Object.fromEntries(limitRowsFor(next).map((row) => [row.key, 1])));
    setResult(null);
    setProgress(null);
  };

  const loadFromEditor = (format: 'ocpn' | 'occn') => {
    const cached = loadEditorSession<unknown>(format);
    if (!cached) {
      toast.error(
        format === 'ocpn'
          ? 'No model in the OC Petri Net editor yet — open the editor first or load a JSON file.'
          : 'No model in the OC Causal Net editor yet — open the editor first or load a JSON file.',
      );
      return;
    }
    const parsed = format === 'ocpn' ? parseOcpnModelFile(cached) : parseOccnModelFile(cached);
    if (parsed.ok === false) {
      toast.error(parsed.error);
      return;
    }
    adoptSource(
      format === 'ocpn'
        ? { format, model: parsed.model as OcpnModelFile }
        : { format, model: parsed.model as OccnModelFile },
    );
  };

  const loadFromFile = async () => {
    let raw: unknown;
    try {
      raw = await openJsonFile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    if (raw === null) return;
    const format = detectModelFormat(raw);
    if (format === 'ocpn') {
      const parsed = parseOcpnModelFile(raw);
      if (parsed.ok === false) {
        toast.error(parsed.error);
        return;
      }
      adoptSource({ format: 'ocpn', model: parsed.model });
    } else if (format === 'occn') {
      const parsed = parseOccnModelFile(raw);
      if (parsed.ok === false) {
        toast.error(parsed.error);
        return;
      }
      adoptSource({ format: 'occn', model: parsed.model });
    } else if (format === 'totem-model') {
      toast.error(
        'TOTeM models describe type relations, not behavior — playout needs an OC Petri Net or OC Causal Net.',
      );
    } else {
      toast.error('The file is not a valid OC Petri Net or OC Causal Net model.');
    }
  };

  const run = () => {
    if (!source) return;
    const totalObjects = Object.values(objectCounts).reduce((a, b) => a + b, 0);
    if (totalObjects === 0) {
      toast.error('At least one object is needed for a playout.');
      return;
    }
    stopWorker();
    setResult(null);
    setProgress(null);
    setRunning(true);

    const request: PlayoutRequest = {
      source,
      objectsPerType: objectCounts,
      activityLimits: buildActivityLimits(source, rowLimits, objectCounts),
      timeoutMs: Math.max(1, timeoutS) * 1000,
      maxStoredVariants: MAX_STORED_VARIANTS,
      maxStates: MAX_STATES,
    };
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<PlayoutWorkerMessage>) => {
      const message = e.data;
      if (message.type === 'progress') {
        setProgress(message.progress);
      } else if (message.type === 'done') {
        setResult(message.result);
        stopWorker();
      } else {
        toast.error(message.message);
        stopWorker();
      }
    };
    worker.onerror = (e) => {
      toast.error(`Playout failed: ${e.message}`);
      stopWorker();
    };
    worker.postMessage(request);
  };

  const exportOcel = () => {
    if (!source || !result) return;
    downloadJson(
      `${toFilename(source.model.name, 'playout')}-playout-log`,
      variantsToOcel(result.variants),
    );
  };

  const exportVariants = () => {
    if (!source || !result) return;
    downloadJson(
      `${toFilename(source.model.name, 'playout')}-playout-variants`,
      variantsToJson(result.variants, {
        modelName: source.model.name,
        modelFormat: source.format,
        objectsPerType: objectCounts,
        activityLimits: buildActivityLimits(source, rowLimits, objectCounts),
        variantCount: result.variantCount,
        exhaustive: result.exhaustive,
      }),
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6 max-w-5xl w-full mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Object-Centric Playout</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Enumerates every distinct process execution (object-centric variant) an OC Petri Net or
          OC Causal Net allows, for a fixed number of objects per type and a maximum number of
          occurrences per activity. Executions that only differ by reordering independent events or
          by renaming objects of the same type count as one variant. The result can be exported as
          an OCEL 2.0 log in which every variant uses its own objects.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model</CardTitle>
          <CardDescription>
            Take the model from an editor, load a saved JSON file, or start from an example.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => loadFromEditor('ocpn')}>
              <CircleDot className="w-4 h-4" /> From OC Petri Net editor
            </Button>
            <Button variant="outline" size="sm" onClick={() => loadFromEditor('occn')}>
              <Workflow className="w-4 h-4" /> From OC Causal Net editor
            </Button>
            <Button variant="outline" size="sm" onClick={loadFromFile}>
              <FolderOpen className="w-4 h-4" /> Load JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => adoptSource({ format: 'ocpn', model: ocpnExample() })}
            >
              <FlaskConical className="w-4 h-4" /> Example OCPN
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => adoptSource({ format: 'occn', model: buildOccnExample() })}
            >
              <FlaskConical className="w-4 h-4" /> Example OCCN
            </Button>
          </div>
          {source ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">
                {source.format === 'ocpn' ? 'OC Petri Net' : 'OC Causal Net'}
              </Badge>
              <span className="font-medium">{source.model.name}</span>
              <span className="text-muted-foreground">·</span>
              {source.model.objectTypes.map((t) => (
                <span key={t.name} className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: t.color ?? FALLBACK_COLOR }}
                  />
                  {t.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No model loaded yet.</p>
          )}
        </CardContent>
      </Card>

      {source && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Limits per process execution</CardTitle>
            <CardDescription>
              Objects per object type and maximum occurrences per activity bound the search space
              of one process execution.
              {source.format === 'occn' &&
                ' START/END pseudo activities are limited automatically to the number of objects of their type.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium mb-2">Objects per type</h3>
                <div className="flex flex-col gap-1.5">
                  {source.model.objectTypes.map((t) => (
                    <label key={t.name} className="flex items-center gap-2 text-sm">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: t.color ?? FALLBACK_COLOR }}
                      />
                      <span className="flex-1 truncate" title={t.name}>
                        {t.name}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={12}
                        className="w-20 h-8"
                        value={objectCounts[t.name] ?? 0}
                        onChange={(e) =>
                          setObjectCounts((prev) => ({
                            ...prev,
                            [t.name]: clamp(e.target.value, 0, 12),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Max occurrences per activity</h3>
                <div className="flex flex-col gap-1.5">
                  {limitRows.map((row) => (
                    <label key={row.key} className="flex items-center gap-2 text-sm">
                      <span
                        className={`flex-1 truncate ${row.silent ? 'text-muted-foreground italic' : ''}`}
                        title={row.label}
                      >
                        {row.label}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={20}
                        className="w-20 h-8"
                        value={rowLimits[row.key] ?? 0}
                        onChange={(e) =>
                          setRowLimits((prev) => ({
                            ...prev,
                            [row.key]: clamp(e.target.value, 0, 20),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1 border-t">
              <label className="flex items-center gap-2 text-sm">
                <span>Timeout</span>
                <Input
                  type="number"
                  min={1}
                  max={120}
                  className="w-20 h-8"
                  value={timeoutS}
                  onChange={(e) => setTimeoutS(clamp(e.target.value, 1, 120))}
                />
                <span className="text-muted-foreground">seconds</span>
              </label>
              {running ? (
                <Button variant="destructive" size="sm" onClick={stopWorker}>
                  <Square className="w-4 h-4" /> Cancel
                </Button>
              ) : (
                <Button size="sm" onClick={run}>
                  <Play className="w-4 h-4" /> Run playout
                </Button>
              )}
              {running && (
                <span className="text-sm text-muted-foreground tabular-nums">
                  Searching… {progress ? formatProgress(progress) : ''}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {result && source && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base" data-testid="playout-summary">
              {summaryLine(result)}
            </CardTitle>
            <CardDescription>
              {result.completedRuns.toLocaleString()} complete executions ·{' '}
              {result.statesExplored.toLocaleString()} states explored ·{' '}
              {(result.elapsedMs / 1000).toFixed(result.elapsedMs < 10_000 ? 2 : 1)}s
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {result.warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-sm flex flex-col gap-1">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
            {result.variantCount === 0 && result.exhaustive && (
              <p className="text-sm text-muted-foreground">
                No complete process execution is possible within these limits. Try more objects,
                higher activity limits, or check the model's{' '}
                {source.format === 'ocpn' ? 'initial/final places' : 'marker groups'}.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={exportOcel}
                disabled={result.variants.length === 0}
              >
                <Download className="w-4 h-4" /> Export OCEL 2.0 log
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportVariants}
                disabled={result.variants.length === 0}
              >
                <FileJson className="w-4 h-4" /> Export variants JSON
              </Button>
              {result.variants.length < result.variantCount && (
                <span className="text-xs text-muted-foreground self-center">
                  Exports contain the first {result.variants.length.toLocaleString()} variants.
                </span>
              )}
            </div>
            <VariantList variants={result.variants} typeColors={typeColors} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function clamp(value: string, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function formatProgress(p: PlayoutProgress): string {
  return `${p.variantCount.toLocaleString()} variants · ${p.statesExplored.toLocaleString()} states · ${(p.elapsedMs / 1000).toFixed(0)}s`;
}

function summaryLine(result: PlayoutResult): string {
  const n = result.variantCount.toLocaleString();
  if (!result.exhaustive) {
    const reason = result.timedOut ? 'timeout' : 'state limit';
    return `At least ${n} object-centric variants (search stopped by ${reason})`;
  }
  if (result.approximateDedup) {
    return `${n} object-centric variants (upper bound — highly symmetric executions may be counted twice)`;
  }
  return `${n} object-centric variant${result.variantCount === 1 ? '' : 's'} (exact)`;
}

function VariantList({
  variants,
  typeColors,
}: {
  variants: PlayoutVariant[];
  typeColors: Map<string, string>;
}) {
  if (variants.length === 0) return null;
  const listed = variants.slice(0, MAX_LISTED_VARIANTS);
  return (
    <div className="flex flex-col gap-2">
      {listed.map((variant, i) => (
        <div key={i} className="rounded-md border px-3 py-2">
          <div className="text-xs text-muted-foreground mb-1.5 flex flex-wrap gap-x-3">
            <span className="font-medium text-foreground">Variant {i + 1}</span>
            <span>{variant.events.length} events</span>
            <span>
              {Object.entries(variant.objectCounts)
                .filter(([, count]) => count > 0)
                .map(([ot, count]) => `${count}× ${ot}`)
                .join(', ')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {variant.events.map((event, j) => (
              <span
                key={j}
                className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs"
              >
                <span className="font-medium">{event.activity}</span>
                <span className="inline-flex items-center gap-1">
                  {Object.keys(event.objects)
                    .sort()
                    .flatMap((ot) =>
                      event.objects[ot].map((obj) => (
                        <span
                          key={`${ot}-${obj}`}
                          className="inline-flex items-center gap-1 rounded-sm bg-background border px-1 py-0.5"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full inline-block"
                            style={{ backgroundColor: typeColors.get(ot) ?? FALLBACK_COLOR }}
                          />
                          {obj}
                        </span>
                      )),
                    )}
                </span>
              </span>
            ))}
            {variant.events.length === 0 && (
              <span className="text-xs text-muted-foreground italic">
                Empty execution (no visible events)
              </span>
            )}
          </div>
        </div>
      ))}
      {variants.length > listed.length && (
        <p className="text-xs text-muted-foreground">
          Showing the first {listed.length} of {variants.length.toLocaleString()} stored variants.
        </p>
      )}
    </div>
  );
}
