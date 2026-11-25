import { useEffect, useRef, useState } from "react";
import { Info, ListChecks, LoaderCircle, Play } from "lucide-react";

import {
  MAX_OC_ALIGNMENT_MAX_STATES,
  MAX_OC_ALIGNMENT_TIMEOUT_S,
  MIN_OC_ALIGNMENT_MAX_STATES,
} from "@/api/ocAlignmentApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useAlignmentRun, useBatchRun, useExecutions, useLogOptions, useOcpnAssets } from "./hooks";
import { OCAlignmentBatchView } from "./OCAlignmentBatchView";
import { OCAlignmentResultView } from "./OCAlignmentResultView";
import { OCAlignmentSettingsPanel } from "./OCAlignmentSettingsPanel";
import { alignmentBlocker, batchBlocker, sourceBlocker, sourceKey, type OCAlignmentSettings } from "./settings";

export interface OCAlignmentExplorerProps {
  fileId: number | null | undefined;
  projectId: number | null | undefined;
  settings: OCAlignmentSettings;
  onSettingsChange: (next: OCAlignmentSettings) => void;
  /** Show the model / source / execution pickers (always true outside dashboards). */
  showControls?: boolean;
  /** Compute once on mount when the settings are complete. */
  autoStart?: boolean;
  /** Apply the global filter (default true). */
  filterEnabled?: boolean;
  compact?: boolean;
  onOpenModelAssets?: () => void;
  /** Graph height in px, or "fill" to grow with a flex parent (dashboard tiles). */
  graphHeight?: number | "fill";
}

function runKey(settings: OCAlignmentSettings) {
  const { showSilentMoves: _ignored, ...rest } = settings;
  void _ignored;
  return JSON.stringify(rest);
}

/**
 * Object-centric alignments: pick an OCPN, a process execution (stored in the
 * log, or cut out by a process area / manual business object types and
 * activities) and compute an optimal alignment of the two.
 */
export function OCAlignmentExplorer({
  fileId,
  projectId,
  settings,
  onSettingsChange,
  showControls = true,
  autoStart = false,
  filterEnabled = true,
  compact = false,
  onOpenModelAssets,
  graphHeight,
}: OCAlignmentExplorerProps) {
  const assets = useOcpnAssets(projectId);
  const options = useLogOptions(fileId, showControls);
  const executions = useExecutions(showControls ? fileId : null, settings, filterEnabled);
  const alignment = useAlignmentRun(fileId, filterEnabled);
  const batch = useBatchRun(fileId, filterEnabled);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [lastBatch, setLastBatch] = useState<string | null>(null);
  const batchKey = `${settings.assetId}|${sourceKey(settings)}`;
  const busy = alignment.running || batch.running;
  const blocker = alignmentBlocker(settings);
  const autoStarted = useRef(false);

  // A preselected model that no longer exists is dropped.
  useEffect(() => {
    if (!assets.loading && !assets.error && settings.assetId && assets.assets.length > 0 &&
        !assets.assets.some((a) => a.id === settings.assetId)) {
      onSettingsChange({ ...settings, assetId: null });
    }
  }, [assets.loading, assets.error, assets.assets, settings, onSettingsChange]);

  const run = () => {
    setLastRun(runKey(settings));
    void alignment.run(settings);
  };

  const runAll = () => {
    setLastBatch(batchKey);
    void batch.run(settings);
  };

  // A row of the batch result opens that execution's alignment.
  const openExecution = (executionId: string) => {
    const next = { ...settings, executionId };
    onSettingsChange(next);
    setLastRun(runKey(next));
    void alignment.run(next);
  };

  useEffect(() => {
    if (autoStart && !autoStarted.current && fileId && !alignmentBlocker(settings)) {
      autoStarted.current = true;
      setLastRun(runKey(settings));
      void alignment.run(settings);
    }
  }, [autoStart, fileId, settings, alignment]);

  const stale = alignment.result !== null && lastRun !== null && lastRun !== runKey(settings);

  return (
    <div
      className={`flex min-h-0 flex-col gap-4 ${graphHeight === "fill" ? "flex-1" : ""}`}
      data-testid="oc-alignment-explorer"
    >
      {showControls ? (
        <section className="space-y-4 rounded-md border bg-muted/20 p-4">
          <OCAlignmentSettingsPanel
            settings={settings}
            onChange={onSettingsChange}
            assets={assets.assets}
            assetsLoading={assets.loading}
            assetsError={assets.error}
            onOpenModelAssets={onOpenModelAssets}
            objectTypes={options.objectTypes}
            activities={options.activities}
            columns={options.columns}
            optionsLoading={options.loading}
            processAreas={options.processAreas}
            areasLoading={options.areasLoading}
            areasError={options.areasError}
            onComputeAreas={() => void options.computeAreas()}
            executions={executions.data}
            executionsLoading={executions.loading}
            executionsError={executions.error}
            executionsBlocker={fileId ? sourceBlocker(settings) : "Select an event log first."}
            onRetryExecutions={executions.retry}
            disabled={busy}
            compact={compact}
          />
          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="oc-alignment-max-states">State limit</Label>
              <Input
                id="oc-alignment-max-states"
                type="number"
                className="h-9 w-32"
                min={MIN_OC_ALIGNMENT_MAX_STATES}
                max={MAX_OC_ALIGNMENT_MAX_STATES}
                step={10_000}
                value={settings.maxStates}
                disabled={busy}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    onSettingsChange({
                      ...settings,
                      maxStates: Math.min(MAX_OC_ALIGNMENT_MAX_STATES, Math.max(MIN_OC_ALIGNMENT_MAX_STATES, Math.round(n))),
                    });
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oc-alignment-timeout">Time limit (s)</Label>
              <Input
                id="oc-alignment-timeout"
                type="number"
                className="h-9 w-24"
                min={1}
                max={MAX_OC_ALIGNMENT_TIMEOUT_S}
                value={settings.timeoutS}
                disabled={busy}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    onSettingsChange({ ...settings, timeoutS: Math.min(MAX_OC_ALIGNMENT_TIMEOUT_S, Math.max(1, n)) });
                  }
                }}
              />
            </div>
            <Button type="button" onClick={run} disabled={Boolean(blocker) || busy || !fileId}>
              {alignment.running ? <LoaderCircle className="animate-spin" /> : <Play />}
              {alignment.running ? "Computing alignment" : "Compute alignment"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={runAll}
              disabled={Boolean(batchBlocker(settings)) || busy || !fileId}
              title="Align every process execution of the source (at most 50,000 states and 5 s each, 4 minutes in total)"
            >
              {batch.running ? <LoaderCircle className="animate-spin" /> : <ListChecks />}
              {batch.running
                ? "Aligning all executions"
                : `Compute for all executions${executions.data ? ` (${executions.data.total.toLocaleString()})` : ""}`}
            </Button>
            {batch.running ? (
              <Button type="button" variant="ghost" size="sm" onClick={batch.cancel}>
                Cancel
              </Button>
            ) : null}
            {blocker && !busy ? (
              <p className="pb-2 text-xs text-muted-foreground">{blocker}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {batch.error ? (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {batch.error}
        </div>
      ) : null}
      {batch.running && !batch.result ? (
        <div role="status" className="flex items-center gap-2 rounded-md border bg-muted/30 p-4 text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Aligning every process execution — progress is shown in the computation panel.
        </div>
      ) : null}
      {batch.result ? (
        <>
          {lastBatch !== batchKey && showControls ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="size-3.5" /> The model or the execution source changed since these alignments were computed.
            </p>
          ) : null}
          <OCAlignmentBatchView
            result={batch.result}
            onOpenExecution={busy ? undefined : openExecution}
            selectedExecutionId={alignment.result?.execution_id}
            compact={compact}
          />
        </>
      ) : null}

      {alignment.error ? (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {alignment.error}
        </div>
      ) : null}
      {stale && showControls ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="size-3.5" /> The settings changed since this alignment was computed.
        </p>
      ) : null}

      {alignment.running && !alignment.result ? (
        <div role="status" className="flex items-center gap-2 rounded-md border bg-muted/30 p-4 text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Searching the synchronous product for an optimal alignment…
        </div>
      ) : alignment.result ? (
        <OCAlignmentResultView
          result={alignment.result}
          showSilentMoves={settings.showSilentMoves}
          onShowSilentMovesChange={(showSilentMoves) => onSettingsChange({ ...settings, showSilentMoves })}
          compact={compact}
          graphHeight={graphHeight}
        />
      ) : batch.result || batch.running ? null : !showControls ? (
        <div role="status" className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <p>{blocker ?? "Compute the alignment of the preselected process execution."}</p>
          {!blocker ? (
            <Button type="button" size="sm" onClick={run} disabled={!fileId}>
              <Play /> Compute alignment
            </Button>
          ) : null}
        </div>
      ) : (
        <div role="status" className="flex items-start gap-2 rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            An optimal object-centric alignment relates every event of the process execution to the model
            behaviour that is most similar to it, respecting the dependencies between the objects. Deviations
            show up as log moves (happened, but the model does not allow it) and model moves (required by the
            model, but missing in the log).
          </span>
        </div>
      )}
    </div>
  );
}
