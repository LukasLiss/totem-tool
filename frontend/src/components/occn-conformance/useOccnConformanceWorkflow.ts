import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { extractAssetApiError } from "@/api/assetsApi";
import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  DEFAULT_OCCN_MAX_STATES,
  LEADING_OBJECT_REPLAY_STRATEGY,
  getEventLogObjectTypes,
  runOCCNConformance,
  type OCCNConformanceResponse,
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
  maxStates: number;
  setMaxStates: (maxStates: number) => void;
  canRun: boolean;
  running: boolean;
  result: OCCNConformanceResponse | null;
  error: string | null;
  run: () => Promise<OCCNConformanceResponse | null>;
}

export function useOccnConformanceWorkflow(
  eventLogId: number | null | undefined,
  projectId: number | null | undefined,
  initialAssetId?: number | null
): OccnConformanceWorkflowState {
  const assetSelection = useOccnAssetSelection(projectId, initialAssetId);
  const [replayUnitStrategy, setReplayUnitStrategy] =
    useState<OCCNReplayUnitStrategy>(CONNECTED_COMPONENTS_REPLAY_STRATEGY);
  const [leadingObjectType, setLeadingObjectType] = useState<string | null>(
    null
  );
  const [availableObjectTypes, setAvailableObjectTypes] = useState<string[]>(
    []
  );
  const [objectTypesLoading, setObjectTypesLoading] = useState(false);
  const [objectTypesError, setObjectTypesError] = useState<string | null>(null);
  const [objectTypesRetryGeneration, setObjectTypesRetryGeneration] =
    useState(0);
  const [maxStates, setMaxStates] = useState(DEFAULT_OCCN_MAX_STATES);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OCCNConformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const objectTypesRequestGeneration = useRef(0);
  const runningRequest = useRef(false);

  useEffect(() => {
    const generation = ++objectTypesRequestGeneration.current;
    setLeadingObjectType(null);
    setAvailableObjectTypes([]);
    setObjectTypesError(null);

    if (
      replayUnitStrategy !== LEADING_OBJECT_REPLAY_STRATEGY ||
      !eventLogId
    ) {
      setObjectTypesLoading(false);
      return;
    }

    setObjectTypesLoading(true);
    void getEventLogObjectTypes(eventLogId)
      .then((objectTypes) => {
        if (generation !== objectTypesRequestGeneration.current) return;
        setAvailableObjectTypes(
          [...objectTypes].sort((left, right) => left.localeCompare(right))
        );
      })
      .catch((requestError) => {
        if (generation !== objectTypesRequestGeneration.current) return;
        setObjectTypesError(extractAssetApiError(requestError).message);
      })
      .finally(() => {
        if (generation === objectTypesRequestGeneration.current) {
          setObjectTypesLoading(false);
        }
      });

    return () => {
      objectTypesRequestGeneration.current += 1;
    };
  }, [eventLogId, objectTypesRetryGeneration, replayUnitStrategy]);

  const retryObjectTypes = useCallback(() => {
    setObjectTypesRetryGeneration((generation) => generation + 1);
  }, []);

  const canRun = useMemo(() => {
    const selectionIsReady = canRunOccnConformance({
      eventLogId,
      projectId,
      selectedAssetId: assetSelection.selectedAssetId,
      assets: assetSelection.assets,
      assetsLoading: assetSelection.loading,
      running,
    });
    const strategyIsReady =
      replayUnitStrategy !== LEADING_OBJECT_REPLAY_STRATEGY ||
      (leadingObjectType !== null &&
        !objectTypesLoading &&
        objectTypesError === null);
    return selectionIsReady && strategyIsReady;
  }, [
    eventLogId,
    projectId,
    assetSelection.selectedAssetId,
    assetSelection.assets,
    assetSelection.loading,
    running,
    replayUnitStrategy,
    leadingObjectType,
    objectTypesLoading,
    objectTypesError,
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
      const nextResult =
        replayUnitStrategy === LEADING_OBJECT_REPLAY_STRATEGY
          ? await runOCCNConformance(
              eventLogId,
              assetId,
              replayUnitStrategy,
              leadingObjectType,
              maxStates
            )
          : await runOCCNConformance(
              eventLogId,
              assetId,
              replayUnitStrategy,
              null,
              maxStates
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
    replayUnitStrategy,
  ]);

  return {
    assetSelection,
    replayUnitStrategy,
    setReplayUnitStrategy,
    leadingObjectType,
    setLeadingObjectType,
    availableObjectTypes,
    objectTypesLoading,
    objectTypesError,
    retryObjectTypes,
    maxStates,
    setMaxStates,
    canRun,
    running,
    result,
    error,
    run,
  };
}
