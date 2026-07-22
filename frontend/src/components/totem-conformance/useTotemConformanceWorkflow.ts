import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { extractAssetApiError } from "@/api/assetsApi";
import {
  runTotemConformance,
  type TotemConformanceResponse,
} from "@/api/totemConformanceApi";

import { canRunTotemConformance } from "./selection";
import {
  useTotemAssetSelection,
  type TotemAssetSelectionState,
} from "./useTotemAssetSelection";

export interface TotemConformanceWorkflowState {
  assetSelection: TotemAssetSelectionState;
  canRun: boolean;
  running: boolean;
  result: TotemConformanceResponse | null;
  error: string | null;
  run: () => Promise<TotemConformanceResponse | null>;
}

export function useTotemConformanceWorkflow(
  eventLogId: number | null | undefined,
  projectId: number | null | undefined
): TotemConformanceWorkflowState {
  const assetSelection = useTotemAssetSelection(projectId);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TotemConformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const canRun = useMemo(
    () =>
      canRunTotemConformance({
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
    setRunning(false);
    setResult(null);
    setError(null);
  }, [eventLogId, projectId, assetSelection.selectedAssetId]);

  const run = useCallback(async () => {
    const assetId = assetSelection.selectedAssetId;
    if (!canRun || !eventLogId || !assetId) return null;

    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const nextResult = await runTotemConformance(eventLogId, assetId);
      if (requestGeneration.current !== generation) return null;
      setResult(nextResult);
      return nextResult;
    } catch (requestError) {
      if (requestGeneration.current !== generation) return null;
      setError(extractAssetApiError(requestError).message);
      return null;
    } finally {
      if (requestGeneration.current === generation) setRunning(false);
    }
  }, [assetSelection.selectedAssetId, canRun, eventLogId]);

  return {
    assetSelection,
    canRun,
    running,
    result,
    error,
    run,
  };
}
