import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { extractAssetApiError } from "@/api/assetsApi";
import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  DEFAULT_OCCN_MAX_STATES,
  LEADING_OBJECT_REPLAY_STRATEGY,
  STORED_COLUMN_REPLAY_STRATEGY,
  getEventLogEventColumns,
  getEventLogObjectTypes,
  runOCCNConformance,
  type EventColumnInfo,
  type OCCNConformanceResponse,
  type OCCNReplayOptions,
  type OCCNReplayUnitStrategy,
} from "@/api/occnConformanceApi";

import { canRunOccnConformance } from "./selection";
import {
  useOccnAssetSelection,
  type OccnAssetSelectionState,
} from "./useOccnAssetSelection";

export interface OccnConformanceWorkflowState {
  assetSelection: OccnAssetSelectionState;
  replayUnitStrategy: OCCNReplayUnitStrategy;
  setReplayUnitStrategy: (strategy: OCCNReplayUnitStrategy) => void;
  leadingObjectType: string | null;
  setLeadingObjectType: (objectType: string | null) => void;
  availableObjectTypes: string[];
  objectTypesLoading: boolean;
  objectTypesError: string | null;
  retryObjectTypes: () => void;
  /** Stored-column strategy: the events column holding execution ids. */
  executionColumn: string | null;
  setExecutionColumn: (column: string | null) => void;
  availableEventColumns: EventColumnInfo[];
  eventColumnsLoading: boolean;
  eventColumnsError: string | null;
  retryEventColumns: () => void;
  /** Project events onto the model's object types before replay. */
  restrictToModelObjectTypes: boolean;
  setRestrictToModelObjectTypes: (enabled: boolean) => void;
  /** The option object handed to the API for every request of this run. */
  replayOptions: OCCNReplayOptions;
  maxStates: number;
  setMaxStates: (maxStates: number) => void;
  canRun: boolean;
  running: boolean;
  result: OCCNConformanceResponse | null;
  error: string | null;
  run: () => Promise<OCCNConformanceResponse | null>;
  runLeadingObjectType: (objectType: string) => void;
}

/**
 * Generic "load a list for the current log while a condition holds" state
 * machine, used for the leading object types and the stored event columns.
 */
function useEventLogList<T>(
  eventLogId: number | null | undefined,
  enabled: boolean,
  load: (eventLogId: number) => Promise<T[]>
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setItems([]);
    setError(null);

    if (!enabled || !eventLogId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void load(eventLogId)
      .then((loaded) => {
        if (generation !== requestGeneration.current) return;
        setItems(loaded);
      })
      .catch((requestError) => {
        if (generation !== requestGeneration.current) return;
        setError(extractAssetApiError(requestError).message);
      })
      .finally(() => {
        if (generation === requestGeneration.current) {
          setLoading(false);
        }
      });

    return () => {
      requestGeneration.current += 1;
    };
    // `load` is a module-level function for every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventLogId, enabled, retryGeneration]);

  const retry = useCallback(() => {
    setRetryGeneration((generation) => generation + 1);
  }, []);

  return { items, loading, error, retry };
}

const loadSortedObjectTypes = (eventLogId: number) =>
  getEventLogObjectTypes(eventLogId).then((objectTypes) =>
    [...objectTypes].sort((left, right) => left.localeCompare(right))
  );

const loadEventColumns = (eventLogId: number) =>
  getEventLogEventColumns(eventLogId).then((columns) =>
    [...columns].sort((left, right) => left.name.localeCompare(right.name))
  );

export function useOccnConformanceWorkflow(
  eventLogId: number | null | undefined,
  projectId: number | null | undefined,
  initialAssetId?: number | null
): OccnConformanceWorkflowState {
  const assetSelection = useOccnAssetSelection(projectId, initialAssetId);
  const [replayUnitStrategy, setReplayUnitStrategyState] =
    useState<OCCNReplayUnitStrategy>(CONNECTED_COMPONENTS_REPLAY_STRATEGY);
  const [leadingObjectType, setLeadingObjectType] = useState<string | null>(
    null
  );
  const [executionColumn, setExecutionColumn] = useState<string | null>(null);
  const [restrictToModelObjectTypes, setRestrictToModelObjectTypes] =
    useState(false);
  const [maxStates, setMaxStates] = useState(DEFAULT_OCCN_MAX_STATES);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OCCNConformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingLeadingObjectType, setPendingLeadingObjectType] = useState<
    string | null
  >(null);
  const requestGeneration = useRef(0);
  const runningRequest = useRef(false);

  const objectTypes = useEventLogList(
    eventLogId,
    replayUnitStrategy === LEADING_OBJECT_REPLAY_STRATEGY,
    loadSortedObjectTypes
  );
  const eventColumns = useEventLogList(
    eventLogId,
    replayUnitStrategy === STORED_COLUMN_REPLAY_STRATEGY,
    loadEventColumns
  );

  const setReplayUnitStrategy = useCallback(
    (strategy: OCCNReplayUnitStrategy) => {
      setPendingLeadingObjectType(null);
      setReplayUnitStrategyState(strategy);
      if (strategy !== LEADING_OBJECT_REPLAY_STRATEGY) {
        setLeadingObjectType(null);
      }
      if (strategy !== STORED_COLUMN_REPLAY_STRATEGY) {
        setExecutionColumn(null);
      }
    },
    []
  );

  useEffect(() => {
    setPendingLeadingObjectType(null);
    setLeadingObjectType(null);
    setExecutionColumn(null);
  }, [eventLogId]);

  // A log with exactly one candidate column is the common case right after
  // storing executions; pick it so the user does not have to.
  useEffect(() => {
    if (
      replayUnitStrategy === STORED_COLUMN_REPLAY_STRATEGY &&
      executionColumn === null &&
      eventColumns.items.length === 1
    ) {
      setExecutionColumn(eventColumns.items[0].name);
    }
  }, [eventColumns.items, executionColumn, replayUnitStrategy]);

  const replayOptions = useMemo<OCCNReplayOptions>(
    () => ({
      executionColumn:
        replayUnitStrategy === STORED_COLUMN_REPLAY_STRATEGY
          ? executionColumn
          : null,
      restrictToModelObjectTypes,
    }),
    [executionColumn, replayUnitStrategy, restrictToModelObjectTypes]
  );

  const canRun = useMemo(() => {
    const selectionIsReady = canRunOccnConformance({
      eventLogId,
      projectId,
      selectedAssetId: assetSelection.selectedAssetId,
      assets: assetSelection.assets,
      assetsLoading: assetSelection.loading,
      running,
    });
    const leadingIsReady =
      replayUnitStrategy !== LEADING_OBJECT_REPLAY_STRATEGY ||
      (leadingObjectType !== null &&
        !objectTypes.loading &&
        objectTypes.error === null);
    const storedIsReady =
      replayUnitStrategy !== STORED_COLUMN_REPLAY_STRATEGY ||
      (executionColumn !== null &&
        !eventColumns.loading &&
        eventColumns.error === null);
    return selectionIsReady && leadingIsReady && storedIsReady;
  }, [
    eventLogId,
    projectId,
    assetSelection.selectedAssetId,
    assetSelection.assets,
    assetSelection.loading,
    running,
    replayUnitStrategy,
    leadingObjectType,
    objectTypes.loading,
    objectTypes.error,
    executionColumn,
    eventColumns.loading,
    eventColumns.error,
  ]);

  useEffect(() => {
    requestGeneration.current += 1;
    runningRequest.current = false;
    setRunning(false);
    setResult(null);
    setError(null);
  }, [
    eventLogId,
    projectId,
    assetSelection.selectedAssetId,
    replayUnitStrategy,
    leadingObjectType,
    executionColumn,
    restrictToModelObjectTypes,
    maxStates,
  ]);

  const run = useCallback(async () => {
    const assetId = assetSelection.selectedAssetId;
    if (
      !canRun ||
      !eventLogId ||
      !assetId ||
      runningRequest.current
    ) {
      return null;
    }

    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    runningRequest.current = true;
    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const nextResult = await runOCCNConformance(
        eventLogId,
        assetId,
        replayUnitStrategy,
        replayUnitStrategy === LEADING_OBJECT_REPLAY_STRATEGY
          ? leadingObjectType
          : null,
        maxStates,
        replayOptions
      );
      if (requestGeneration.current !== generation) return null;
      setResult(nextResult);
      return nextResult;
    } catch (requestError) {
      if (requestGeneration.current !== generation) return null;
      setError(extractAssetApiError(requestError).message);
      return null;
    } finally {
      if (requestGeneration.current === generation) {
        runningRequest.current = false;
        setRunning(false);
      }
    }
  }, [
    assetSelection.selectedAssetId,
    canRun,
    eventLogId,
    leadingObjectType,
    maxStates,
    replayOptions,
    replayUnitStrategy,
  ]);

  const runLeadingObjectType = useCallback((objectType: string) => {
    setReplayUnitStrategyState(LEADING_OBJECT_REPLAY_STRATEGY);
    setExecutionColumn(null);
    setLeadingObjectType(objectType);
    setPendingLeadingObjectType(objectType);
  }, []);

  useEffect(() => {
    if (
      pendingLeadingObjectType === null ||
      replayUnitStrategy !== LEADING_OBJECT_REPLAY_STRATEGY ||
      leadingObjectType !== pendingLeadingObjectType ||
      !canRun ||
      running
    ) {
      return;
    }
    setPendingLeadingObjectType(null);
    void run();
  }, [
    canRun,
    leadingObjectType,
    pendingLeadingObjectType,
    replayUnitStrategy,
    run,
    running,
  ]);

  return {
    assetSelection,
    replayUnitStrategy,
    setReplayUnitStrategy,
    leadingObjectType,
    setLeadingObjectType,
    availableObjectTypes: objectTypes.items,
    objectTypesLoading: objectTypes.loading,
    objectTypesError: objectTypes.error,
    retryObjectTypes: objectTypes.retry,
    executionColumn,
    setExecutionColumn,
    availableEventColumns: eventColumns.items,
    eventColumnsLoading: eventColumns.loading,
    eventColumnsError: eventColumns.error,
    retryEventColumns: eventColumns.retry,
    restrictToModelObjectTypes,
    setRestrictToModelObjectTypes,
    replayOptions,
    maxStates,
    setMaxStates,
    canRun,
    running,
    result,
    error,
    run,
    runLeadingObjectType,
  };
}
