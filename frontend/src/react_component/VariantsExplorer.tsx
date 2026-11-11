import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Database, Play, SlidersHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import ComputationStatus from "@/components/ComputationStatus";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { VisualizerEmptyState } from "@/components/ui/VisualizerEmptyState";
import { useFilterVersion } from "@/store/filterStore";
import { useProcessAreaStore, useProcessAreasForFile } from "@/store/processAreaStore";

import { ProcessAreaSettingsPanel } from "./variants/ProcessAreaSettingsPanel";
import { ProcessAreaVariantTabs } from "./variants/ProcessAreaVariantTabs";
import { ProcessExecutionStoreSummary } from "./variants/ProcessExecutionStoreSummary";
import { VariantRow } from "./variants/VariantRow";
import { VariantsSettingsPanel } from "./variants/VariantsSettingsPanel";
import {
  existingColumns,
  isLeadingExtraction,
  processAreaColumnsBlocker,
  settingsBlocker,
  summarizeSettings,
  toAdvancedSettings,
} from "./variants/settings";
import {
  computeProcessAreaVariants,
  describeRequestError,
  fetchActivities,
  fetchEventColumnNames,
  fetchObjectTypes,
  fetchProcessAreas,
  fetchVariants,
  orderProcessAreas,
  storeProcessExecutions,
  toProcessAreaRequest,
} from "./variants/variantsApi";
import {
  DEFAULT_PROCESS_AREA_COLUMNS,
  DEFAULT_STORE_SETTINGS,
  DEFAULT_VARIANTS_MODE,
  type AdvancedSettings,
  type ExecutionSettings,
  type Extraction,
  type GroupingSettings,
  type IsoStrategy,
  type ProcessAreaColumns,
  type ProcessAreaVariantsResponse,
  type StoredExecutionsResponse,
  type StoreSettings,
  type Variant,
  type VariantsMode,
} from "./variants/types";

// Re-exported for other callers that used to import these from this file.
export type {
  AdvancedSettings,
  Extraction,
  IsoStrategy,
  Variant,
  VariantsMode,
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
  defaultMode?: VariantsMode;                     // "process_areas" (default) or "custom"
  defaultProcessAreaColumns?: ProcessAreaColumns; // Columns the process-area mode writes
  defaultExtraction?: Extraction;                 // Persisted settings (dashboard)
  defaultIso?: IsoStrategy;
  defaultTimeoutS?: number;
  defaultBusinessObjectTypes?: string[];
  defaultBusinessActivities?: string[];
  /** Fired whenever a persisted setting changes so a dashboard can store it. */
  onAdvancedChange?: (s: AdvancedSettings) => void;
  /** When provided, overrides internal filter state (controlled mode). */
  filterEnabled?: boolean;
  localFilterParams?: Record<string, string>;
};

type Status = "idle" | "loading" | "ready" | "empty" | "stored" | "error";

const AUTO_RUN_DEBOUNCE_MS = 400;

const MODE_OPTIONS: { value: VariantsMode; label: string; hint: string }[] = [
  {
    value: "process_areas",
    label: "Connected components per process area",
    hint: "Recommended. One variant list per process area; results are stored in the event log.",
  },
  {
    value: "custom",
    label: "Custom extraction",
    hint: "Choose the extraction technique, leading type, grouping and storing yourself.",
  },
];

export default function VariantsExplorer({
  fileId,
  automaticLoading = false,
  onVariantsLoad,
  typeColors,
  colWidth = 120,
  embedded = false,
  defaultLeadingType,
  defaultMode = DEFAULT_VARIANTS_MODE,
  defaultProcessAreaColumns,
  defaultExtraction = "leading_1hop",
  defaultIso = "wl+vf2",
  defaultTimeoutS = 10,
  defaultBusinessObjectTypes,
  defaultBusinessActivities,
  onAdvancedChange,
  filterEnabled: filterEnabledProp,
  localFilterParams,
}: VariantsExplorerProps) {
  const filterVersion = useFilterVersion();
  const filterEnabled = filterEnabledProp ?? true;
  const localFilterActive = !!localFilterParams && Object.keys(localFilterParams).length > 0;
  const effectiveFilterVersion = localFilterActive ? 0 : (filterEnabled ? filterVersion : 0);

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
  const [mode, setMode] = useState<VariantsMode>(defaultMode);
  const [areaColumns, setAreaColumns] = useState<ProcessAreaColumns>(
    defaultProcessAreaColumns ?? DEFAULT_PROCESS_AREA_COLUMNS,
  );
  const isAreaMode = mode === "process_areas";
  // The advanced options stay hidden unless the user asks for them (or the
  // persisted settings already use a custom extraction that needs input).
  const [settingsOpen, setSettingsOpen] = useState(defaultMode === "custom" && !automaticLoading);

  // Re-seed from the persisted defaults when they change (a dashboard
  // finishing its load). Compared by value so the echo of our own
  // `onAdvancedChange` does not reset anything.
  const defaultsKey = JSON.stringify([
    defaultExtraction, defaultIso, defaultTimeoutS, defaultLeadingType ?? "",
    defaultBusinessObjectTypes ?? [], defaultBusinessActivities ?? [],
    defaultMode, defaultProcessAreaColumns ?? null,
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
    setMode(defaultMode);
    if (defaultProcessAreaColumns) setAreaColumns(defaultProcessAreaColumns);
  }, [defaultsKey, defaultExtraction, defaultIso, defaultTimeoutS, defaultLeadingType,
      defaultBusinessObjectTypes, defaultBusinessActivities, defaultMode, defaultProcessAreaColumns]);

  // Persist whenever a setting changes. Skipped on the initial mount so we
  // don't echo back the values the parent just gave us.
  const isFirstAdvSync = useRef(true);
  useEffect(() => {
    if (isFirstAdvSync.current) {
      isFirstAdvSync.current = false;
      return;
    }
    onAdvancedChange?.(
      toAdvancedSettings(execution, grouping.iso, grouping.timeoutS, mode, areaColumns),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execution, grouping, mode, areaColumns]);

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
  const [areaResult, setAreaResult] = useState<ProcessAreaVariantsResponse | null>(null);
  /** Existing columns the user must confirm overwriting before a store run. */
  const [pendingOverwrite, setPendingOverwrite] = useState<string[] | null>(null);
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
    setAreaResult(null);
    setPendingOverwrite(null);
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

  const blocker = useMemo(
    () => (isAreaMode ? processAreaColumnsBlocker(areaColumns) : settingsBlocker(execution, store)),
    [isAreaMode, areaColumns, execution, store],
  );
  // The process areas take part in the key so recomputing them in the
  // Process Area component marks the shown variants as outdated.
  const runKey = useMemo(
    () =>
      JSON.stringify(
        isAreaMode
          ? { mode, fileId, areaColumns, grouping, areas: processAreas?.computedAt ?? null, filterEnabled, effectiveFilterVersion, localFilterParams }
          : { mode, fileId, execution, grouping, store, filterEnabled, effectiveFilterVersion, localFilterParams },
      ),
    [isAreaMode, mode, fileId, areaColumns, processAreas?.computedAt, execution, grouping, store, filterEnabled, effectiveFilterVersion, localFilterParams],
  );
  const stale = lastRunKey !== null && lastRunKey !== runKey;
  const optionsReady = isAreaMode
    || (!optionsLoading && (availableTypes.length > 0 || !isLeadingExtraction(execution.extraction)));
  const canRun = Boolean(fileId) && status !== "loading" && blocker === null && optionsReady;

  /**
   * Connected components per process area. ``store`` writes the result into
   * the log; unless ``confirmed``, existing columns are first shown to the
   * user, who can cancel.
   */
  const runProcessAreas = useCallback(async (storeInLog: boolean, confirmed: boolean) => {
    const currentFileId = fileId;
    if (!currentFileId || blocker !== null) return;
    const runId = ++runIdRef.current;
    const key = runKey;
    const isCurrent = () => runId === runIdRef.current && fileIdRef.current === currentFileId;

    setPendingOverwrite(null);
    setStatus("loading");
    setErrorMsg("");
    try {
      if (storeInLog && !confirmed) {
        const present = existingColumns(areaColumns, await fetchEventColumnNames(currentFileId));
        if (!isCurrent()) return;
        if (present.length > 0) {
          setPendingOverwrite(present);
          // Back to what was shown before; the dialog decides what happens next.
          setStatus(areaResult ? "ready" : "idle");
          return;
        }
      }

      let snapshot = processAreas;
      if (!snapshot || snapshot.areas.length === 0) {
        setProcessAreasLoading(true);
        try {
          const computed = await fetchProcessAreas(currentFileId, filterEnabled, localFilterParams);
          if (!isCurrent()) return;
          useProcessAreaStore.getState().publish(computed);
          snapshot = useProcessAreaStore.getState().byFile[currentFileId] ?? { ...computed, computedAt: Date.now() };
        } finally {
          setProcessAreasLoading(false);
        }
      }
      const areas = orderProcessAreas(snapshot.areas).map(toProcessAreaRequest);
      if (areas.length === 0) {
        setAreaResult(null);
        setStatus("empty");
        setLastRunKey(key);
        return;
      }

      const result = await computeProcessAreaVariants(
        currentFileId,
        areas,
        grouping,
        { store: storeInLog, columns: areaColumns },
        filterEnabled,
        localFilterParams,
      );
      if (!isCurrent()) return;
      setStoreResult(null);
      setAreaResult(result);
      const all = result.areas.flatMap((area) => area.variants);
      setVariants(all);
      setStatus("ready");
      onVariantsLoad?.(all);
      // Recomputing the areas changes the key; remember the one actually used.
      setLastRunKey(
        snapshot === processAreas
          ? key
          : JSON.stringify({ ...JSON.parse(key), areas: snapshot.computedAt }),
      );
      if (result.stored) {
        toast.success(
          `Stored ${result.execution_count} process execution${result.execution_count === 1 ? "" : "s"} in "${result.execution_column}" and their variants in "${result.variant_column}".`,
        );
      }
    } catch (e: unknown) {
      if (!isCurrent()) return;
      setStatus("error");
      setErrorMsg(describeRequestError(e, "Computing the process area variants failed."));
    }
  }, [fileId, blocker, runKey, areaColumns, areaResult, processAreas, grouping, filterEnabled, localFilterParams, onVariantsLoad]);

  const run = useCallback(async () => {
    if (isAreaMode) {
      await runProcessAreas(true, false);
      return;
    }
    const currentFileId = fileId;
    if (!currentFileId || blocker !== null) return;
    const runId = ++runIdRef.current;
    const key = runKey;
    const isCurrent = () => runId === runIdRef.current && fileIdRef.current === currentFileId;

    setStatus("loading");
    setErrorMsg("");
    setAreaResult(null);
    try {
      if (store.enabled) {
        const result = await storeProcessExecutions(currentFileId, execution, grouping, store, filterEnabled, localFilterParams);
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
        const result = await fetchVariants(currentFileId, execution, grouping, filterEnabled, localFilterParams);
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
  }, [isAreaMode, runProcessAreas, fileId, blocker, runKey, store, execution, grouping, filterEnabled, localFilterParams, onVariantsLoad]);

  // Automatic mode: (re)compute after every settings change, debounced so a
  // multi-select does not fire one request per click. Storing into the log
  // is always an explicit action, so the process-area mode only computes.
  const autoRun = useCallback(
    () => (isAreaMode ? runProcessAreas(false, false) : run()),
    [isAreaMode, runProcessAreas, run],
  );
  const runRef = useRef(autoRun);
  useEffect(() => {
    runRef.current = autoRun;
  }, [autoRun]);
  const autoBlocked = !isAreaMode && store.enabled;
  useEffect(() => {
    if (!automaticLoading || autoBlocked || !fileId || blocker !== null || !optionsReady) return;
    if (lastRunKey === runKey) return;
    const timer = setTimeout(() => void runRef.current(), AUTO_RUN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [automaticLoading, autoBlocked, fileId, blocker, optionsReady, runKey, lastRunKey]);

  const computeProcessAreas = useCallback(async () => {
    if (!fileId) return;
    const currentFileId = fileId;
    setProcessAreasLoading(true);
    setProcessAreasError(null);
    try {
      const snapshot = await fetchProcessAreas(currentFileId, filterEnabled, localFilterParams);
      if (fileIdRef.current !== currentFileId) return;
      useProcessAreaStore.getState().publish(snapshot);
    } catch (e: unknown) {
      if (fileIdRef.current !== currentFileId) return;
      setProcessAreasError(describeRequestError(e, "Could not compute process areas."));
    } finally {
      if (fileIdRef.current === currentFileId) setProcessAreasLoading(false);
    }
  }, [fileId, filterEnabled, localFilterParams]);

  const sortedVariants = useMemo(
    () => [...variants].sort((a, b) => b.support - a.support),
    [variants],
  );
  const totalSupport = useMemo(() => variants.reduce((s, v) => s + v.support, 0), [variants]);
  const summary = isAreaMode
    ? `Connected components per process area · stored in "${areaColumns.variantColumn.trim()}"`
    : summarizeSettings(execution, grouping.iso, store);

  const runLabel = isAreaMode
    ? lastRunKey !== null && stale
      ? "Recompute variants"
      : "Compute variants"
    : store.enabled
      ? store.computeVariants
        ? "Compute & store"
        : "Store executions"
      : lastRunKey !== null && stale
        ? "Recompute variants"
        : "Compute variants";
  const storesInLog = isAreaMode || store.enabled;
  const modeOption = MODE_OPTIONS.find((o) => o.value === mode);

  const Wrapper = embedded ? "div" : Card;

  return (
    <Wrapper className="w-full min-w-0">
      <CardHeader className="pb-2">
        {/* Toolbar: wraps on narrow widths instead of overflowing. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
            aria-controls="variants-settings-panel"
            className="shrink-0"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Advanced options
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
          <div id="variants-settings-panel" className="mt-3 min-w-0 space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="max-w-md space-y-1.5">
              <Label htmlFor="variants-mode" className="text-xs">Method</Label>
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as VariantsMode)}
                disabled={status === "loading"}
              >
                <SelectTrigger id="variants-mode" aria-label="Method" className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">{modeOption?.hint}</p>
            </div>
            {isAreaMode ? (
              <ProcessAreaSettingsPanel
                columns={areaColumns}
                onColumnsChange={setAreaColumns}
                grouping={grouping}
                onGroupingChange={setGrouping}
                disabled={status === "loading"}
              />
            ) : (
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
            )}
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
          <VisualizerEmptyState
            label="Variants Explorer"
            message="Select an event log to view its variants."
            overlay={false}
          />
        ) : null}

        {fileId && status === "idle" ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="text-center text-sm text-muted-foreground">
              {isAreaMode ? (
                <>
                  For every process area, the log is split into connected process executions,
                  and executions with the same structure are grouped into variants.
                  <br />
                  The results are written into the event log columns{" "}
                  <code className="rounded bg-muted px-1 text-xs">{areaColumns.executionColumn.trim()}</code> and{" "}
                  <code className="rounded bg-muted px-1 text-xs">{areaColumns.variantColumn.trim()}</code>.
                </>
              ) : store.enabled
                ? "Computing process executions and writing them into the event log is an explicit step."
                : automaticLoading && blocker
                  ? "Complete the settings above to start the computation."
                  : "Variant computation can take some time for large event logs."}
              {blocker ? (
                <>
                  <br />
                  <span className="text-amber-700 dark:text-amber-400">{blocker}</span>
                </>
              ) : null}
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
          <ComputationStatus
            fileId={fileId}
            urlIncludes={["/variants/", "/process_executions/", "/process_area_variants/", "/discover_process_areas/"]}
            className="mx-0"
            fallback={(
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm">
                  {processAreasLoading
                    ? "Computing process areas…"
                    : storesInLog
                      ? "Computing and storing process executions…"
                      : "Loading variants…"}
                </span>
              </div>
            )}
          />
        ) : null}

        {status === "error" ? (
          <div className="flex flex-col gap-2" role="alert">
            <div className="text-sm font-semibold text-red-600">
              {storesInLog ? "Storing process executions failed" : "Failed to load variants"}
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

        {areaResult && status !== "loading" && status !== "error" ? (
          <div className="mb-3">
            {areaResult.stored ? (
              <ProcessExecutionStoreSummary
                result={areaResult}
                ambiguousHint="This happens when process areas share an activity."
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm text-muted-foreground">
                <span className="min-w-0 flex-1">
                  These variants are not stored in the event log yet.
                </span>
                <Button size="sm" variant="outline" onClick={() => void run()} disabled={!canRun}>
                  <Database className="h-4 w-4" />
                  Store in event log
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {status === "ready" && areaResult ? (
          <ProcessAreaVariantTabs
            areas={areaResult.areas}
            zoom={zoom}
            labelMode={labelMode}
            colWidth={colWidth}
            typeColors={typeColors}
          />
        ) : null}

        {status === "stored" ? (
          <div className="text-sm text-muted-foreground">
            Variants were not computed. Enable "Also compute variants" in the settings to group the
            stored executions.
          </div>
        ) : null}

        {status === "empty" ? (
          <div className="text-sm text-muted-foreground">
            {isAreaMode ? "No process areas found for this file" : "No variants found for this file"}
          </div>
        ) : null}

        {status === "ready" && !areaResult ? (
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

      <Dialog
        open={pendingOverwrite !== null}
        onOpenChange={(open) => {
          if (!open) setPendingOverwrite(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Overwrite existing columns?</DialogTitle>
            <DialogDescription>
              The event log already has{" "}
              {pendingOverwrite?.length === 1 ? "a column" : "columns"} named{" "}
              {pendingOverwrite?.map((column, i) => (
                <span key={column}>
                  {i > 0 ? " and " : ""}
                  <code className="rounded bg-muted px-1 text-xs text-foreground">{column}</code>
                </span>
              ))}
              . Computing the variants replaces {pendingOverwrite?.length === 1 ? "its" : "their"} values.
              Rename the columns in the advanced options to keep the old values.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingOverwrite(null)}>
              Cancel
            </Button>
            <Button onClick={() => void runProcessAreas(true, true)}>Overwrite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Wrapper>
  );
}
