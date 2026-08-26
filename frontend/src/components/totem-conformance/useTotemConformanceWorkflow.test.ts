// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectAsset } from "@/api/assetsApi";
import {
  runTotemConformance,
  type TotemConformanceResponse,
} from "@/api/totemConformanceApi";

import {
  useTotemAssetSelection,
  type TotemAssetSelectionState,
} from "./useTotemAssetSelection";
import { useTotemConformanceWorkflow } from "./useTotemConformanceWorkflow";

vi.mock("@/api/totemConformanceApi", async () => {
  const actual = await vi.importActual<
    typeof import("@/api/totemConformanceApi")
  >("@/api/totemConformanceApi");
  return {
    ...actual,
    runTotemConformance: vi.fn(),
  };
});

vi.mock("./useTotemAssetSelection", () => ({
  useTotemAssetSelection: vi.fn(),
}));

const runTotemConformanceMock = vi.mocked(runTotemConformance);
const useTotemAssetSelectionMock = vi.mocked(useTotemAssetSelection);

const model: ProjectAsset = {
  id: 2,
  project: 7,
  name: "Reference model",
  asset_type: "TOTEM",
  content_json: {},
  metadata: {},
  created_by: 1,
  created_at: "2026-07-22T10:00:00Z",
  updated_at: "2026-07-22T10:00:00Z",
};

const alternativeModel: ProjectAsset = {
  ...model,
  id: 3,
  name: "Alternative model",
};

const response: TotemConformanceResponse = {
  file_id: 12,
  asset_id: 2,
  overall_metrics: {
    temporal: { fitness: 0.9, precision: 0.8 },
    log_cardinality: { fitness: 0.7, precision: 0.6 },
    event_cardinality: { fitness: 0.5, precision: 0.4 },
  },
  object_type_metrics: {},
  type_pair_metrics: [],
  histograms: {
    temporal: [],
    log_cardinality: [],
    event_cardinality: [],
    event_cardinality_by_activity: [],
    temporal_by_relation_type: [],
    log_cardinality_by_relation_type: [],
  },
};

const alternativeResponse: TotemConformanceResponse = {
  ...response,
  asset_id: alternativeModel.id,
};

let selection: TotemAssetSelectionState;

function selectedModelState(
  overrides: Partial<TotemAssetSelectionState> = {}
): TotemAssetSelectionState {
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

describe("useTotemConformanceWorkflow", () => {
  beforeEach(() => {
    selection = selectedModelState();
    useTotemAssetSelectionMock.mockImplementation(() => selection);
    runTotemConformanceMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("runs with the selected log and model and exposes the result", async () => {
    const request = deferred<TotemConformanceResponse>();
    runTotemConformanceMock.mockReturnValue(request.promise);
    const { result } = renderHook(() => useTotemConformanceWorkflow(12, 7));

    expect(result.current.canRun).toBe(true);

    let runPromise!: Promise<TotemConformanceResponse | null>;
    act(() => {
      runPromise = result.current.run();
    });
    expect(result.current.running).toBe(true);
    expect(result.current.canRun).toBe(false);

    await act(async () => {
      request.resolve(response);
      await runPromise;
    });

    expect(runTotemConformanceMock).toHaveBeenCalledWith(12, 2);
    expect(result.current.running).toBe(false);
    expect(result.current.result).toEqual(response);
    expect(result.current.error).toBeNull();
  });

  it("exposes request failures and leaves the workflow runnable", async () => {
    runTotemConformanceMock.mockRejectedValue(
      new Error("Conformance service unavailable")
    );
    const { result } = renderHook(() => useTotemConformanceWorkflow(12, 7));

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
      ({ eventLogId }) => useTotemConformanceWorkflow(eventLogId, 7),
      { initialProps: { eventLogId: 12 as number | null } }
    );

    expect(result.current.canRun).toBe(false);
    selection = selectedModelState();
    rerender({ eventLogId: null });
    expect(result.current.canRun).toBe(false);

    act(() => {
      void result.current.run();
    });
    expect(runTotemConformanceMock).not.toHaveBeenCalled();
  });

  it("clears and ignores an in-flight result when the event log changes", async () => {
    const request = deferred<TotemConformanceResponse>();
    runTotemConformanceMock.mockReturnValue(request.promise);
    const { result, rerender } = renderHook(
      ({ eventLogId }) => useTotemConformanceWorkflow(eventLogId, 7),
      { initialProps: { eventLogId: 12 } }
    );

    let runPromise!: Promise<TotemConformanceResponse | null>;
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
    runTotemConformanceMock
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(alternativeResponse);
    const { result, rerender } = renderHook(
      ({ revision }) => {
        void revision;
        return useTotemConformanceWorkflow(12, 7);
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
    expect(runTotemConformanceMock.mock.calls).toEqual([
      [12, model.id],
      [12, alternativeModel.id],
    ]);
  });

  it("clears a completed result when the event log and project change", async () => {
    runTotemConformanceMock.mockResolvedValue(response);
    const { result, rerender } = renderHook(
      ({ eventLogId, projectId }) =>
        useTotemConformanceWorkflow(eventLogId, projectId),
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
