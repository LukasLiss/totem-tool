import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Play, Settings, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useFilterVersion } from "@/store/filterStore";
import { useProcessAreaStore, useProcessAreasForFile } from "@/store/processAreaStore";

import { ProcessExecutionStoreSummary } from "./variants/ProcessExecutionStoreSummary";
import { VariantRow } from "./variants/VariantRow";
import { VariantsSettingsPanel } from "./variants/VariantsSettingsPanel";
import {
  isLeadingExtraction,
  settingsBlocker,
  summarizeSettings,
  toAdvancedSettings,
} from "./variants/settings";
import {
  describeRequestError,
  fetchActivities,
  fetchObjectTypes,
  fetchProcessAreas,
  fetchVariants,
  storeProcessExecutions,
} from "./variants/variantsApi";
import {
  DEFAULT_STORE_SETTINGS,
  type AdvancedSettings,
  type ExecutionSettings,
  type Extraction,
  type GroupingSettings,
  type IsoStrategy,
  type StoredExecutionsResponse,
  type StoreSettings,
  type Variant,
} from "./variants/types";

// Re-exported for the dashboard wrapper and other callers that used to
// import these from this file.
export { EXTRACTION_OPTIONS, ISO_OPTIONS } from "./variants/types";
export type {
  AdvancedSettings,
  Extraction,
  IsoStrategy,
  Variant,
  VariantEventNode,
  VariantGraph,
  VariantObject,
} from "./variants/types";

/* ========== main component ========== */
type VariantsExplorerProps = {
  fileId?: number;                                // Event log file ID
  automaticLoading?: boolean;                     // Compute on load and after every settings change
  onVariantsLoad?: (variants: Variant[]) => void; // Optional callback when variants load
  typeColors?: Record<string, string>;            // UI customization
  colWidth?: number;                              // Column width (default: 120)
  embedded?: boolean;                             // When true, removes outer Card wrapper
  defaultLeadingType?: string;                    // Pre-select this type if provided and valid
  defaultExtraction?: Extraction;                 // Persisted settings (dashboard)
  defaultIso?: IsoStrategy;
  defaultTimeoutS?: number;
  defaultBusinessObjectTypes?: string[];
  defaultBusinessActivities?: string[];
  /** Fired whenever a persisted setting changes so a dashboard can store it. */
  onAdvancedChange?: (s: AdvancedSettings) => void;
  /** When provided, overrides internal filter state (controlled mode). */
  filterEnabled?: boolean;
};

type Status = "idle" | "loading" | "ready" | "empty" | "stored" | "error";

const AUTO_RUN_DEBOUNCE_MS = 400;

export default function VariantsExplorer({
  fileId,
  automaticLoading = false,
  onVariantsLoad,
  typeColors,
  colWidth = 120,
  embedded = false,
  defaultLeadingType,
  defaultExtraction = "leading_1hop",
  defaultIso = "wl+vf2",
  defaultTimeoutS = 10,
  defaultBusinessObjectTypes,
  defaultBusinessActivities,
  onAdvancedChange,
  filterEnabled: filterEnabledProp,
}: VariantsExplorerProps) {
  const filterVersion = useFilterVersion();
  const filterEnabled = filterEnabledProp ?? false;
  const effectiveFilterVersion = filterEnabled ? filterVersion : 0;

  // ---- settings -----------------------------------------------------------
  const [execution, setExecution] = useState<ExecutionSettings>(() => ({
    extraction: defaultExtraction,
    leadingType: defaultLeadingType ?? "",
    businessObjectTypes: defaultBusinessObjectTypes ?? [],
    businessActivities: defaultBusinessActivities ?? [],
  }));
  const [grouping, setGrouping] = useState<GroupingSettings>({
    iso: defaultIso,
    timeoutS: defaultTimeoutS,
  });
  const [store, setStore] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(!automaticLoading);

  // Re-seed from the persisted defaults when they change (a dashboard
  // finishing its load). Compared by value so the echo of our own
  // `onAdvancedChange` does not reset anything.
  const defaultsKey = JSON.stringify([
    defaultExtraction, defaultIso, defaultTimeoutS, defaultLeadingType ?? "",
    defaultBusinessObjectTypes ?? [], defaultBusinessActivities ?? [],
  ]);
  const seededKeyRef = useRef(defaultsKey);
  useEffect(() => {
    if (seededKeyRef.current === defaultsKey) return;
    seededKeyRef.current = defaultsKey;
    setExecution((prev) => ({
      extraction: defaultExtraction,
      leadingType: defaultLeadingType ?? prev.leadingType,
      businessObjectTypes: defaultBusinessObjectTypes ?? [],
      businessActivities: defaultBusinessActivities ?? [],
    }));
    setGrouping({ iso: defaultIso, timeoutS: defaultTimeoutS });
  }, [defaultsKey, defaultExtraction, defaultIso, defaultTimeoutS, defaultLeadingType,
      defaultBusinessObjectTypes, defaultBusinessActivities]);

  // Persist whenever a setting changes. Skipped on the initial mount so we
  // don't echo back the values the parent just gave us.
  const isFirstAdvSync = useRef(true);
  useEffect(() => {
    if (isFirstAdvSync.current) {
      isFirstAdvSync.current = false;
      return;
    }
    onAdvancedChange?.(toAdvancedSettings(execution, grouping.iso, grouping.timeoutS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execution, grouping]);

  // ---- log metadata ---------------------------------------------------------
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [availableActivities, setAvailableActivities] = useState<string[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const fileIdRef = useRef<number | undefined>(fileId);
  useEffect(() => {
    fileIdRef.current = fileId;
  }, [fileId]);

  // ---- results --------------------------------------------------------------
  const [variants, setVariants] = useState<Variant[]>([]);
  const [storeResult, setStoreResult] = useState<StoredExecutionsResponse | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [lastRunKey, setLastRunKey] = useState<string | null>(null);
  const runIdRef = useRef(0);

  // ---- UI -------------------------------------------------------------------
  const [zoom, setZoom] = useState(1);
  const [labelMode, setLabelMode] = useState<"compact" | "full">("compact");

  // ---- process areas (shared with the Process Area component) --------------
  const processAreas = useProcessAreasForFile(fileId);
  const [processAreasLoading, setProcessAreasLoading] = useState(false);
  const [processAreasError, setProcessAreasError] = useState<string | null>(null);

  const resetResults = useCallback(() => {
    runIdRef.current += 1;
    setVariants([]);
    setStoreResult(null);
    setStatus("idle");
    setErrorMsg("");
    setLastRunKey(null);
  }, []);

  // Load object types and activities when the file changes.
  useEffect(() => {
    resetResults();
    setAvailableTypes([]);
    setAvailableActivities([]);
    if (!fileId) return;

    const currentFileId = fileId;
    let cancelled = false;
    setOptionsLoading(true);
    (async () => {
      try {
        const [types, activities] = await Promise.all([
          fetchObjectTypes(currentFileId),
          fetchActivities(currentFileId),
        ]);
        if (cancelled || fileIdRef.current !== currentFileId) return;
        setAvailableTypes(types);
        setAvailableActivities(activities);
        setExecution((prev) => {
          if (prev.leadingType && types.includes(prev.leadingType)) return prev;
          const fallback =
            defaultLeadingType && types.includes(defaultLeadingType)
              ? defaultLeadingType
              : types[0] ?? "";
          return fallback === prev.leadingType ? prev : { ...prev, leadingType: fallback };
        });
      } catch (e: unknown) {
        if (cancelled || fileIdRef.current !== currentFileId) return;
        console.error("Failed to load event log metadata:", e);
        setErrorMsg(describeRequestError(e, "Failed to load object types"));
        setStatus("error");
      } finally {
        if (!cancelled && fileIdRef.current === currentFileId) setOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `defaultLeadingType` only seeds the first selection for a file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, resetResults]);

  const blocker = useMemo(() => settingsBlocker(execution, store), [execution, store]);
  const runKey = useMemo(
    () => JSON.stringify({ fileId, execution, grouping, store, filterEnabled, effectiveFilterVersion }),
    [fileId, execution, grouping, store, filterEnabled, effectiveFilterVersion],
  );
  const stale = lastRunKey !== null && lastRunKey !== runKey;
  const optionsReady = !optionsLoading && (availableTypes.length > 0 || !isLeadingExtraction(execution.extraction));
  const canRun = Boolean(fileId) && status !== "loading" && blocker === null && optionsReady;

  const run = useCallback(async () => {
    const currentFileId = fileId;
    if (!currentFileId || blocker !== null) return;
    const runId = ++runIdRef.current;
    const key = runKey;
    const isCurrent = () => runId === runIdRef.current && fileIdRef.current === currentFileId;

    setStatus("loading");
    setErrorMsg("");
    try {
      if (store.enabled) {
        const result = await storeProcessExecutions(currentFileId, execution, grouping, store, filterEnabled);
        if (!isCurrent()) return;
        const list = result.variants ?? [];
        setStoreResult(result);
        setVariants(list);
        setStatus(result.variants === null ? "stored" : list.length ? "ready" : "empty");
        onVariantsLoad?.(list);
        toast.success(
          `Stored ${result.execution_count} process execution${result.execution_count === 1 ? "" : "s"} in column "${result.execution_column}".`,
        );
      } else {
        const result = await fetchVariants(currentFileId, execution, grouping, filterEnabled);
        if (!isCurrent()) return;
        setStoreResult(null);
        setVariants(result.variants);
        setStatus(result.variants.length ? "ready" : "empty");
        onVariantsLoad?.(result.variants);
      }
      setLastRunKey(key);
    } catch (e: unknown) {
      if (!isCurrent()) return;
      setStatus("error");
      setErrorMsg(
        describeRequestError(
          e,
          store.enabled ? "Storing process executions failed." : "Unknown error while loading variants.",
        ),
      );
    }
  }, [fileId, blocker, runKey, store, execution, grouping, filterEnabled, onVariantsLoad]);

  // Automatic mode: (re)compute after every settings change, debounced so a
  // multi-select does not fire one request per click. Storing into the log
  // is always an explicit action.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  useEffect(() => {
    if (!automaticLoading || store.enabled || !fileId || blocker !== null || !optionsReady) return;
    if (lastRunKey === runKey) return;
    const timer = setTimeout(() => void runRef.current(), AUTO_RUN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [automaticLoading, store.enabled, fileId, blocker, optionsReady, runKey, lastRunKey]);

  const computeProcessAreas = useCallback(async () => {
    if (!fileId) return;
    const currentFileId = fileId;
    setProcessAreasLoading(true);
    setProcessAreasError(null);
    try {
      const snapshot = await fetchProcessAreas(currentFileId, filterEnabled);
      if (fileIdRef.current !== currentFileId) return;
      useProcessAreaStore.getState().publish(snapshot);
    } catch (e: unknown) {
      if (fileIdRef.current !== currentFileId) return;
      setProcessAreasError(describeRequestError(e, "Could not compute process areas."));
    } finally {
      if (fileIdRef.current === currentFileId) setProcessAreasLoading(false);
    }
  }, [fileId, filterEnabled]);

  const sortedVariants = useMemo(
    () => [...variants].sort((a, b) => b.support - a.support),
    [variants],
  );
  const totalSupport = useMemo(() => variants.reduce((s, v) => s + v.support, 0), [variants]);
  const summary = summarizeSettings(execution, grouping.iso, store);

  const runLabel = store.enabled
    ? store.computeVariants
      ? "Compute & store"
      : "Store executions"
    : lastRunKey !== null && stale
      ? "Recompute variants"
      : "Compute variants";

  const Wrapper = embedded ? "div" : Card;

  return (
    <Wrapper className="w-full min-w-0">
      <CardHeader className="pb-2">
        {/* Toolbar: wraps on narrow widths instead of overflowing. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
            aria-controls="variants-settings-panel"
            className="shrink-0"
          >
            <Settings className="h-4 w-4" />
            Settings
            {settingsOpen ? <ChevronUp className="h-4 w-4 opacity-60" /> : <ChevronDown className="h-4 w-4 opacity-60" />}
          </Button>
          <p
            className="min-w-0 flex-1 basis-[220px] truncate text-sm text-muted-foreground"
            title={summary}
          >
            {summary}
            {stale && status !== "loading" ? (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                settings changed
              </span>
            ) : null}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2" title="Zoom">
              <ZoomOut size={16} className="text-muted-foreground" />
              <Slider
                value={[zoom]}
                min={0.5}
                max={2}
                step={0.1}
                onValueChange={(v) => setZoom(v[0])}
                className="w-28 sm:w-36"
                aria-label="Zoom"
              />
              <ZoomIn size={16} className="text-muted-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="label-mode" className="whitespace-nowrap text-sm font-medium">
                Compact labels
              </Label>
              <Switch
                id="label-mode"
                checked={labelMode === "compact"}
                onCheckedChange={(checked) => setLabelMode(checked ? "compact" : "full")}
              />
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void run()}
              disabled={!canRun}
              title={blocker ?? undefined}
              className="shrink-0"
            >
              <Play className="h-4 w-4" />
              {runLabel}
            </Button>
          </div>
        </div>

        {settingsOpen ? (
          <div id="variants-settings-panel">
            <VariantsSettingsPanel
              execution={execution}
              onExecutionChange={setExecution}
              grouping={grouping}
              onGroupingChange={setGrouping}
              store={store}
              onStoreChange={setStore}
              availableTypes={availableTypes}
              availableActivities={availableActivities}
              optionsLoading={optionsLoading}
              processAreas={processAreas}
              processAreasLoading={processAreasLoading}
              processAreasError={processAreasError}
              onComputeProcessAreas={() => void computeProcessAreas()}
              disabled={status === "loading"}
            />
            {blocker ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400" role="status">
                {blocker}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="pt-2">
        {!fileId ? (
          <div className="text-sm text-muted-foreground">Select a file to view variants</div>
        ) : null}

        {fileId && status === "idle" ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="text-center text-sm text-muted-foreground">
              {store.enabled
                ? "Computing process executions and writing them into the event log is an explicit step."
                : automaticLoading && blocker
                  ? "Complete the settings above to start the computation."
                  : "Variant computation can take some time for large event logs."}
              <br />
              Click below when ready to start.
            </div>
            <Button onClick={() => void run()} disabled={!canRun} className="min-w-[200px]" title={blocker ?? undefined}>
              <Play className="h-4 w-4" />
              {runLabel}
            </Button>
          </div>
        ) : null}

        {status === "loading" ? (
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm">
              {store.enabled ? "Computing and storing process executions…" : "Loading variants…"}
            </span>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="flex flex-col gap-2" role="alert">
            <div className="text-sm font-semibold text-red-600">
              {store.enabled ? "Storing process executions failed" : "Failed to load variants"}
            </div>
            {errorMsg ? <div className="text-xs text-red-500">{errorMsg}</div> : null}
            <Button variant="outline" size="sm" onClick={() => void run()} className="w-fit" disabled={!canRun}>
              Retry
            </Button>
          </div>
        ) : null}

        {storeResult && status !== "loading" && status !== "error" ? (
          <div className="mb-3">
            <ProcessExecutionStoreSummary result={storeResult} />
          </div>
        ) : null}

        {status === "stored" ? (
          <div className="text-sm text-muted-foreground">
            Variants were not computed. Enable "Also compute variants" in the settings to group the
            stored executions.
          </div>
        ) : null}

        {status === "empty" ? (
          <div className="text-sm text-muted-foreground">No variants found for this file</div>
        ) : null}

        {status === "ready" ? (
          <div className="flex flex-col gap-3">
            <div className="text-sm text-muted-foreground" aria-live="polite">
              Found <span className="font-medium text-foreground">{sortedVariants.length}</span>{" "}
              variant{sortedVariants.length === 1 ? "" : "s"} across{" "}
              <span className="font-medium text-foreground">{totalSupport}</span> process execution
              {totalSupport === 1 ? "" : "s"}
            </div>
            {sortedVariants.map((v) => (
              <VariantRow
                key={v.signature_hash}
                v={v}
                totalSupport={totalSupport}
                zoom={zoom}
                labelMode={labelMode}
                colWidth={colWidth}
                typeColorsOverride={typeColors}
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Wrapper>
  );
}
