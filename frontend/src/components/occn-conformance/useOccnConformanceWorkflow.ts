import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { extractAssetApiError } from "@/api/assetsApi";
import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
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
  const replayUnitStrategy = CONNECTED_COMPONENTS_REPLAY_STRATEGY;
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OCCNConformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const runningRequest = useRef(false);

  const canRun = useMemo(
    () =>
      canRunOccnConformance({
        eventLogId,
        projectId,
        selectedAssetId: assetSelection.selectedAssetId,
        assets: assetSelection.assets,
        assetsLoading: assetSelection.loading,
        running,
      }),
    [
      eventLogId,
      projectId,
      assetSelection.selectedAssetId,
      assetSelection.assets,
      assetSelection.loading,
      running,
    ]
  );

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
        replayUnitStrategy
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
    replayUnitStrategy,
  ]);

  return {
    assetSelection,
    replayUnitStrategy,
    canRun,
    running,
    result,
    error,
    run,
  };
}
