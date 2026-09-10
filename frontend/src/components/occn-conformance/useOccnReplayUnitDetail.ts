import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { extractAssetApiError } from "@/api/assetsApi";
import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
  getOCCNReplayUnitDetail,
  type OCCNReplayUnitDetailResponse,
  type OCCNReplayUnitResult,
  type OCCNReplayUnitStrategy,
} from "@/api/occnConformanceApi";

interface ReplayUnitDetailState {
  contextKey: string | null;
  detail: OCCNReplayUnitDetailResponse | null;
  loading: boolean;
  error: string | null;
  requestedOffset: number;
}

export interface OccnReplayUnitDetailState {
  detail: OCCNReplayUnitDetailResponse | null;
  loading: boolean;
  error: string | null;
  requestedOffset: number;
  loadPage: (offset: number) => Promise<OCCNReplayUnitDetailResponse | null>;
  retry: () => Promise<OCCNReplayUnitDetailResponse | null>;
  previousPage: () => Promise<OCCNReplayUnitDetailResponse | null>;
  nextPage: () => Promise<OCCNReplayUnitDetailResponse | null>;
}

const EMPTY_STATE: ReplayUnitDetailState = {
  contextKey: null,
  detail: null,
  loading: false,
  error: null,
  requestedOffset: 0,
};

export function replayUnitDetailInitialOffset(
  failureEventIndex: number | null,
  limit = DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT
): number {
  if (
    failureEventIndex === null ||
    !Number.isInteger(failureEventIndex) ||
    failureEventIndex < 0 ||
    !Number.isInteger(limit) ||
    limit < 1
  ) {
    return 0;
  }

  return Math.floor(failureEventIndex / limit) * limit;
}

export function useOccnReplayUnitDetail(
  eventLogId: number | null | undefined,
  unit: OCCNReplayUnitResult | null | undefined,
  replayUnitStrategy: OCCNReplayUnitStrategy =
    CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  leadingObjectType: string | null = null
): OccnReplayUnitDetailState {
  const [state, setState] = useState<ReplayUnitDetailState>(EMPTY_STATE);
  const requestGeneration = useRef(0);
  const validEventLogId =
    Number.isInteger(eventLogId) && Number(eventLogId) > 0
      ? Number(eventLogId)
      : null;
  const unitId = unit?.unit_id ?? null;
  const initialOffset = replayUnitDetailInitialOffset(
    unit?.failure_event_index ?? null
  );
  const contextKey = useMemo(
    () =>
      validEventLogId !== null && unitId
        ? `${validEventLogId}:${unitId}:${replayUnitStrategy}:${leadingObjectType ?? ""}`
        : null,
    [leadingObjectType, replayUnitStrategy, unitId, validEventLogId]
  );

  const loadPage = useCallback(
    async (offset: number) => {
      if (contextKey === null || validEventLogId === null || !unitId) {
        return null;
      }

      const requestedOffset = Number.isFinite(offset)
        ? Math.max(0, Math.floor(offset))
        : 0;
      const generation = ++requestGeneration.current;
      setState({
        contextKey,
        detail: null,
        loading: true,
        error: null,
        requestedOffset,
      });

      try {
        const options = {
          replayUnitStrategy,
          offset: requestedOffset,
          limit: DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
          ...(leadingObjectType === null ? {} : { leadingObjectType }),
        };
        const detail = await getOCCNReplayUnitDetail(
          validEventLogId,
          unitId,
          options
        );
        if (generation !== requestGeneration.current) return null;

        setState({
          contextKey,
          detail,
          loading: false,
          error: null,
          requestedOffset,
        });
        return detail;
      } catch (requestError: unknown) {
        if (generation !== requestGeneration.current) return null;

        setState({
          contextKey,
          detail: null,
          loading: false,
          error: extractAssetApiError(requestError).message,
          requestedOffset,
        });
        return null;
      }
    }, [
      contextKey,
      leadingObjectType,
      replayUnitStrategy,
      unitId,
      validEventLogId,
    ]
  );

  useEffect(() => {
    if (contextKey === null) {
      requestGeneration.current += 1;
      setState(EMPTY_STATE);
      return;
    }

    void loadPage(initialOffset);
    return () => {
      requestGeneration.current += 1;
    };
  }, [contextKey, initialOffset, loadPage]);

  const stateMatchesSelection = state.contextKey === contextKey;
  const detail = stateMatchesSelection ? state.detail : null;
  const requestedOffset = stateMatchesSelection
    ? state.requestedOffset
    : initialOffset;

  const retry = useCallback(
    () => loadPage(requestedOffset),
    [loadPage, requestedOffset]
  );
  const previousPage = useCallback(() => {
    const offset = detail?.pagination.previous_offset;
    return offset === null || offset === undefined
      ? Promise.resolve(null)
      : loadPage(offset);
  }, [detail, loadPage]);
  const nextPage = useCallback(() => {
    const offset = detail?.pagination.next_offset;
    return offset === null || offset === undefined
      ? Promise.resolve(null)
      : loadPage(offset);
  }, [detail, loadPage]);

  return {
    detail,
    loading:
      contextKey !== null && (!stateMatchesSelection || state.loading),
    error: stateMatchesSelection ? state.error : null,
    requestedOffset,
    loadPage,
    retry,
    previousPage,
    nextPage,
  };
}
