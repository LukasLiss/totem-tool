// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
  getOCCNReplayUnitDetail,
  type OCCNReplayUnitDetailResponse,
  type OCCNReplayUnitResult,
} from "@/api/occnConformanceApi";

import {
  replayUnitDetailInitialOffset,
  useOccnReplayUnitDetail,
} from "./useOccnReplayUnitDetail";

vi.mock("@/api/occnConformanceApi", async () => {
  const actual = await vi.importActual<
    typeof import("@/api/occnConformanceApi")
  >("@/api/occnConformanceApi");
  return {
    ...actual,
    getOCCNReplayUnitDetail: vi.fn(),
  };
});

const getDetailMock = vi.mocked(getOCCNReplayUnitDetail);

function replayUnit(
  unitId: string,
  failureEventIndex: number | null = null
): OCCNReplayUnitResult {
  return {
    unit_id: unitId,
    status: failureEventIndex === null ? "fitting" : "non_fitting",
    replayable: failureEventIndex === null,
    event_count: 160,
    explored_state_count: 12,
    object_types: ["Item", "Order"],
    failure_event_index: failureEventIndex,
    failure_event_id:
      failureEventIndex === null ? null : `event-${failureEventIndex}`,
    limit_reason: null,
  };
}

function detailPage(
  unitId: string,
  offset: number,
  totalCount = 160
): OCCNReplayUnitDetailResponse {
  const returnedCount = Math.min(
    DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
    Math.max(0, totalCount - offset)
  );
  return {
    file_id: 12,
    unit_id: unitId,
    replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    event_count: totalCount,
    object_types: ["Item", "Order"],
    pagination: {
      offset,
      limit: DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
      returned_count: returnedCount,
      total_count: totalCount,
      has_previous: offset > 0,
      has_next: offset + returnedCount < totalCount,
      previous_offset: offset > 0 ? Math.max(0, offset - 50) : null,
      next_offset:
        offset + returnedCount < totalCount ? offset + returnedCount : null,
    },
    events: Array.from({ length: returnedCount }, (_, index) => ({
      event_index: offset + index,
      event_id: `event-${offset + index}`,
      activity: "Handle order",
      timestamp_unix: 1_735_689_600 + offset + index,
      objects_by_type: {
        Item: [`item-${offset + index}`],
        Order: ["order-1"],
      },
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("replayUnitDetailInitialOffset", () => {
  it("opens the page containing a known failure event", () => {
    expect(replayUnitDetailInitialOffset(123)).toBe(100);
    expect(replayUnitDetailInitialOffset(50)).toBe(50);
  });

  it("falls back to the first page for missing or invalid positions", () => {
    expect(replayUnitDetailInitialOffset(null)).toBe(0);
    expect(replayUnitDetailInitialOffset(-1)).toBe(0);
    expect(replayUnitDetailInitialOffset(1.5)).toBe(0);
    expect(replayUnitDetailInitialOffset(12, 0)).toBe(0);
  });
});

describe("useOccnReplayUnitDetail", () => {
  beforeEach(() => {
    getDetailMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("automatically loads the first page for the selected replay unit", async () => {
    const unit = replayUnit("connected_components:000001");
    getDetailMock.mockResolvedValue(detailPage(unit.unit_id, 0));

    const { result } = renderHook(() =>
      useOccnReplayUnitDetail(12, unit)
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getDetailMock).toHaveBeenCalledWith(12, unit.unit_id, {
      replayUnitStrategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
      offset: 0,
      limit: DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
    });
    expect(result.current.detail?.pagination.offset).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("opens the page containing the first known failure", async () => {
    const unit = replayUnit("connected_components:000002", 123);
    getDetailMock.mockResolvedValue(detailPage(unit.unit_id, 100));

    const { result } = renderHook(() =>
      useOccnReplayUnitDetail(12, unit)
    );

    await waitFor(() => expect(result.current.detail).not.toBeNull());

    expect(getDetailMock).toHaveBeenCalledWith(12, unit.unit_id, {
      replayUnitStrategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
      offset: 100,
      limit: DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
    });
    expect(result.current.requestedOffset).toBe(100);
  });

  it("loads the next and previous offsets supplied by the backend", async () => {
    const unit = replayUnit("connected_components:000001");
    getDetailMock
      .mockResolvedValueOnce(detailPage(unit.unit_id, 0))
      .mockResolvedValueOnce(detailPage(unit.unit_id, 50))
      .mockResolvedValueOnce(detailPage(unit.unit_id, 0));

    const { result } = renderHook(() =>
      useOccnReplayUnitDetail(12, unit)
    );
    await waitFor(() =>
      expect(result.current.detail?.pagination.offset).toBe(0)
    );

    await act(async () => {
      await result.current.nextPage();
    });
    expect(result.current.detail?.pagination.offset).toBe(50);

    await act(async () => {
      await result.current.previousPage();
    });
    expect(result.current.detail?.pagination.offset).toBe(0);
    expect(getDetailMock.mock.calls.map((call) => call[2]?.offset)).toEqual([
      0, 50, 0,
    ]);
  });

  it("normalizes an invalid programmatic page offset", async () => {
    const unit = replayUnit("connected_components:000001");
    getDetailMock.mockResolvedValue(detailPage(unit.unit_id, 0));

    const { result } = renderHook(() =>
      useOccnReplayUnitDetail(12, unit)
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadPage(Number.NaN);
    });

    expect(getDetailMock).toHaveBeenLastCalledWith(12, unit.unit_id, {
      replayUnitStrategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
      offset: 0,
      limit: DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
    });
    expect(result.current.requestedOffset).toBe(0);
  });

  it("reports an error and retries the same requested page", async () => {
    const unit = replayUnit("connected_components:000002", 123);
    getDetailMock
      .mockRejectedValueOnce(new Error("Replay detail unavailable"))
      .mockResolvedValueOnce(detailPage(unit.unit_id, 100));

    const { result } = renderHook(() =>
      useOccnReplayUnitDetail(12, unit)
    );
    await waitFor(() =>
      expect(result.current.error).toBe("Replay detail unavailable")
    );

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.detail?.pagination.offset).toBe(100);
    expect(getDetailMock.mock.calls.map((call) => call[2]?.offset)).toEqual([
      100, 100,
    ]);
  });

  it("ignores a stale response after the selected replay unit changes", async () => {
    const firstUnit = replayUnit("connected_components:000001");
    const secondUnit = replayUnit("connected_components:000002");
    const firstRequest = deferred<OCCNReplayUnitDetailResponse>();
    const secondRequest = deferred<OCCNReplayUnitDetailResponse>();
    getDetailMock.mockImplementation((_eventLogId, unitId) =>
      unitId === firstUnit.unit_id
        ? firstRequest.promise
        : secondRequest.promise
    );

    const { result, rerender } = renderHook(
      ({ unit }) => useOccnReplayUnitDetail(12, unit),
      { initialProps: { unit: firstUnit } }
    );
    rerender({ unit: secondUnit });
    await waitFor(() => expect(getDetailMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondRequest.resolve(detailPage(secondUnit.unit_id, 0));
      await secondRequest.promise;
    });
    expect(result.current.detail?.unit_id).toBe(secondUnit.unit_id);

    await act(async () => {
      firstRequest.resolve(detailPage(firstUnit.unit_id, 0));
      await firstRequest.promise;
    });
    expect(result.current.detail?.unit_id).toBe(secondUnit.unit_id);
  });

  it("does not load without both an event log and a selected unit", () => {
    const unit = replayUnit("connected_components:000001");
    const { result, rerender } = renderHook(
      ({ eventLogId, selectedUnit }) =>
        useOccnReplayUnitDetail(eventLogId, selectedUnit),
      {
        initialProps: {
          eventLogId: null as number | null,
          selectedUnit: unit as OCCNReplayUnitResult | null,
        },
      }
    );

    expect(result.current.loading).toBe(false);
    rerender({ eventLogId: 12, selectedUnit: null });
    expect(result.current.loading).toBe(false);
    expect(getDetailMock).not.toHaveBeenCalled();
  });
});
