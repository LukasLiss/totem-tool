// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectAsset } from "@/api/assetsApi";
import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  LEADING_OBJECT_REPLAY_STRATEGY,
  getEventLogObjectTypes,
  runOCCNConformance,
  type OCCNConformanceResponse,
} from "@/api/occnConformanceApi";

import {
  useOccnAssetSelection,
  type OccnAssetSelectionState,
} from "./useOccnAssetSelection";
import { useOccnConformanceWorkflow } from "./useOccnConformanceWorkflow";

vi.mock("@/api/occnConformanceApi", async () => {
  const actual = await vi.importActual<
    typeof import("@/api/occnConformanceApi")
  >("@/api/occnConformanceApi");
  return {
    ...actual,
    getEventLogObjectTypes: vi.fn(),
    runOCCNConformance: vi.fn(),
  };
});

vi.mock("./useOccnAssetSelection", () => ({
  useOccnAssetSelection: vi.fn(),
}));

const runOCCNConformanceMock = vi.mocked(runOCCNConformance);
const getEventLogObjectTypesMock = vi.mocked(getEventLogObjectTypes);
const useOccnAssetSelectionMock = vi.mocked(useOccnAssetSelection);

const model: ProjectAsset = {
  id: 2,
  project: 7,
  name: "Reference OCCN",
  asset_type: "OCCN",
  content_json: {},
  metadata: {},
  created_by: 1,
  created_at: "2026-07-22T10:00:00Z",
  updated_at: "2026-07-22T10:00:00Z",
};

const alternativeModel: ProjectAsset = {
  ...model,
  id: 3,
  name: "Alternative OCCN",
};

const response: OCCNConformanceResponse = {
  file_id: 12,
  asset_id: model.id,
  replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  leading_object_type: null,
  fitness: 0.5,
  coverage: 1,
  total_units: 2,
  fitting_units: 1,
  non_fitting_units: 1,
  inconclusive_units: 0,
  unit_results: [
    {
      unit_id: "connected_components:000001",
      status: "fitting",
      replayable: true,
      event_count: 2,
      explored_state_count: 4,
      object_types: ["Order"],
      failure_event_index: null,
      failure_event_id: null,
      limit_reason: null,
    },
    {
      unit_id: "connected_components:000002",
      status: "non_fitting",
      replayable: false,
      event_count: 1,
      explored_state_count: 2,
      object_types: ["Item", "Order"],
      failure_event_index: 0,
      failure_event_id: "e3",
      limit_reason: null,
    },
  ],
};

const alternativeResponse: OCCNConformanceResponse = {
  ...response,
  asset_id: alternativeModel.id,
};

let selection: OccnAssetSelectionState;

function selectedModelState(
  overrides: Partial<OccnAssetSelectionState> = {}
): OccnAssetSelectionState {
  return {
    assets: [model],
    selectedAssetId: model.id,
    selectedAsset: model,
    loading: false,
    error: null,
    selectAsset: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useOccnConformanceWorkflow", () => {
  beforeEach(() => {
    selection = selectedModelState();
    useOccnAssetSelectionMock.mockImplementation(() => selection);
    runOCCNConformanceMock.mockReset();
    getEventLogObjectTypesMock.mockReset();
    getEventLogObjectTypesMock.mockResolvedValue(["Order", "Item"]);
  });

  afterEach(() => {
    cleanup();
  });

  it("runs the selected log and model with the default strategy", async () => {
    const request = deferred<OCCNConformanceResponse>();
    runOCCNConformanceMock.mockReturnValue(request.promise);
    const { result } = renderHook(() =>
      useOccnConformanceWorkflow(12, 7, model.id)
    );

    expect(useOccnAssetSelectionMock).toHaveBeenCalledWith(7, model.id);
    expect(result.current.replayUnitStrategy).toBe(
      CONNECTED_COMPONENTS_REPLAY_STRATEGY
    );
    expect(result.current.canRun).toBe(true);

    let runPromise!: Promise<OCCNConformanceResponse | null>;
    act(() => {
      runPromise = result.current.run();
    });
    expect(result.current.running).toBe(true);
    expect(result.current.canRun).toBe(false);

    await act(async () => {
      request.resolve(response);
      await runPromise;
    });

    expect(runOCCNConformanceMock).toHaveBeenCalledWith(
      12,
      model.id,
      CONNECTED_COMPONENTS_REPLAY_STRATEGY
    );
    expect(result.current.running).toBe(false);
    expect(result.current.result).toEqual(response);
    expect(result.current.error).toBeNull();
  });

  it("suppresses a duplicate run while the first request is active", async () => {
    const request = deferred<OCCNConformanceResponse>();
    runOCCNConformanceMock.mockReturnValue(request.promise);
    const { result } = renderHook(() => useOccnConformanceWorkflow(12, 7));

    let firstRun!: Promise<OCCNConformanceResponse | null>;
    let duplicateRun!: Promise<OCCNConformanceResponse | null>;
    act(() => {
      firstRun = result.current.run();
      duplicateRun = result.current.run();
    });

    await expect(duplicateRun).resolves.toBeNull();
    expect(runOCCNConformanceMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve(response);
      await firstRun;
    });
  });

  it("requires and submits a selected type for leading-object replay", async () => {
    runOCCNConformanceMock.mockResolvedValue({
      ...response,
      replay_unit_strategy: LEADING_OBJECT_REPLAY_STRATEGY,
      leading_object_type: "Order",
    });
    const { result } = renderHook(() => useOccnConformanceWorkflow(12, 7));

    act(() => {
      result.current.setReplayUnitStrategy(LEADING_OBJECT_REPLAY_STRATEGY);
    });
    await waitFor(() => expect(result.current.objectTypesLoading).toBe(false));

    expect(getEventLogObjectTypesMock).toHaveBeenCalledWith(12);
    expect(result.current.availableObjectTypes).toEqual(["Item", "Order"]);
    expect(result.current.canRun).toBe(false);

    act(() => {
      result.current.setLeadingObjectType("Order");
    });
    expect(result.current.canRun).toBe(true);

    await act(async () => {
      await result.current.run();
    });
    expect(runOCCNConformanceMock).toHaveBeenCalledWith(
      12,
      model.id,
      LEADING_OBJECT_REPLAY_STRATEGY,
      "Order"
    );
  });

  it("exposes request failures and leaves the workflow runnable", async () => {
    runOCCNConformanceMock.mockRejectedValue(
      new Error("Conformance service unavailable")
    );
    const { result } = renderHook(() => useOccnConformanceWorkflow(12, 7));

    await act(async () => {
      expect(await result.current.run()).toBeNull();
    });

    expect(result.current.running).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBe("Conformance service unavailable");
    expect(result.current.canRun).toBe(true);
  });

  it("does not run while required input is missing or assets are loading", () => {
    selection = selectedModelState({ loading: true });
    const { result, rerender } = renderHook(
      ({ eventLogId }) => useOccnConformanceWorkflow(eventLogId, 7),
      { initialProps: { eventLogId: 12 as number | null } }
    );

    expect(result.current.canRun).toBe(false);
    selection = selectedModelState();
    rerender({ eventLogId: null });
    expect(result.current.canRun).toBe(false);

    act(() => {
      void result.current.run();
    });
    expect(runOCCNConformanceMock).not.toHaveBeenCalled();
  });

  it("clears and ignores an in-flight result when the event log changes", async () => {
    const request = deferred<OCCNConformanceResponse>();
    runOCCNConformanceMock.mockReturnValue(request.promise);
    const { result, rerender } = renderHook(
      ({ eventLogId }) => useOccnConformanceWorkflow(eventLogId, 7),
      { initialProps: { eventLogId: 12 } }
    );

    let runPromise!: Promise<OCCNConformanceResponse | null>;
    act(() => {
      runPromise = result.current.run();
    });
    rerender({ eventLogId: 13 });

    expect(result.current.running).toBe(false);
    expect(result.current.result).toBeNull();

    await act(async () => {
      request.resolve(response);
      expect(await runPromise).toBeNull();
    });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("clears a completed result and reruns with a newly selected model", async () => {
    runOCCNConformanceMock
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(alternativeResponse);
    const { result, rerender } = renderHook(
      ({ revision }) => {
        void revision;
        return useOccnConformanceWorkflow(12, 7);
      },
      { initialProps: { revision: 0 } }
    );

    await act(async () => {
      expect(await result.current.run()).toEqual(response);
    });
    expect(result.current.result).toEqual(response);

    selection = selectedModelState({
      assets: [model, alternativeModel],
      selectedAssetId: alternativeModel.id,
      selectedAsset: alternativeModel,
    });
    rerender({ revision: 1 });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => {
      expect(await result.current.run()).toEqual(alternativeResponse);
    });
    expect(runOCCNConformanceMock.mock.calls).toEqual([
      [12, model.id, CONNECTED_COMPONENTS_REPLAY_STRATEGY],
      [12, alternativeModel.id, CONNECTED_COMPONENTS_REPLAY_STRATEGY],
    ]);
  });

  it("clears a completed result when the event log and project change", async () => {
    runOCCNConformanceMock.mockResolvedValue(response);
    const { result, rerender } = renderHook(
      ({ eventLogId, projectId }) =>
        useOccnConformanceWorkflow(eventLogId, projectId),
      { initialProps: { eventLogId: 12, projectId: 7 } }
    );

    await act(async () => {
      await result.current.run();
    });
    expect(result.current.result).toEqual(response);

    selection = selectedModelState({
      assets: [{ ...alternativeModel, project: 8 }],
      selectedAssetId: alternativeModel.id,
      selectedAsset: { ...alternativeModel, project: 8 },
    });
    rerender({ eventLogId: 13, projectId: 8 });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
