// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAssets, type ProjectAsset } from "@/api/assetsApi";

import { useOccnAssetSelection } from "./useOccnAssetSelection";

vi.mock("@/api/assetsApi", async () => {
  const actual = await vi.importActual<typeof import("@/api/assetsApi")>(
    "@/api/assetsApi"
  );
  return {
    ...actual,
    listAssets: vi.fn(),
  };
});

const listAssetsMock = vi.mocked(listAssets);

function asset(
  id: number,
  project: number,
  updatedAt: string,
  assetType: ProjectAsset["asset_type"] = "OCCN"
): ProjectAsset {
  return {
    id,
    project,
    name: `Model ${id}`,
    asset_type: assetType,
    content_json: {},
    metadata: {},
    created_by: 1,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useOccnAssetSelection", () => {
  beforeEach(() => {
    listAssetsMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads only current-project OCCN assets and keeps an explicit selection", async () => {
    listAssetsMock.mockResolvedValue([
      asset(1, 7, "2026-07-20T10:00:00Z"),
      asset(2, 7, "2026-07-22T10:00:00Z"),
      asset(3, 8, "2026-07-23T10:00:00Z"),
      asset(4, 7, "2026-07-24T10:00:00Z", "TOTEM"),
    ]);

    const { result } = renderHook(() => useOccnAssetSelection(7));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listAssetsMock).toHaveBeenCalledWith({
      projectId: 7,
      assetType: "OCCN",
    });
    expect(result.current.assets.map(({ id }) => id)).toEqual([2, 1]);
    expect(result.current.selectedAssetId).toBeNull();

    act(() => result.current.selectAsset(2));

    expect(result.current.selectedAssetId).toBe(2);
    expect(result.current.selectedAsset?.id).toBe(2);
  });

  it("preselects a requested current-project OCCN asset", async () => {
    listAssetsMock.mockResolvedValue([
      asset(1, 7, "2026-07-20T10:00:00Z"),
      asset(2, 7, "2026-07-22T10:00:00Z"),
    ]);

    const { result } = renderHook(() => useOccnAssetSelection(7, 1));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.selectedAssetId).toBe(1);
    expect(result.current.selectedAsset?.id).toBe(1);
  });

  it("does not preselect an asset outside the selectable project models", async () => {
    listAssetsMock.mockResolvedValue([
      asset(1, 7, "2026-07-20T10:00:00Z"),
    ]);

    const { result } = renderHook(() => useOccnAssetSelection(7, 99));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.selectedAssetId).toBeNull();
    expect(result.current.selectedAsset).toBeNull();
  });

  it("reports loading and an empty result for a project without OCCN assets", async () => {
    const request = deferred<ProjectAsset[]>();
    listAssetsMock.mockReturnValue(request.promise);

    const { result } = renderHook(() => useOccnAssetSelection(7));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      request.resolve([]);
      await request.promise;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.assets).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("does not query assets without a valid project", () => {
    const { result } = renderHook(() => useOccnAssetSelection(null));

    expect(result.current.loading).toBe(false);
    expect(result.current.assets).toEqual([]);
    expect(listAssetsMock).not.toHaveBeenCalled();
  });

  it("exposes a load error and retries the project query", async () => {
    listAssetsMock
      .mockRejectedValueOnce(new Error("Model store unavailable"))
      .mockResolvedValueOnce([asset(2, 7, "2026-07-22T10:00:00Z")]);

    const { result } = renderHook(() => useOccnAssetSelection(7));

    await waitFor(() =>
      expect(result.current.error).toBe("Model store unavailable")
    );

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(listAssetsMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale response after the selected project changes", async () => {
    const oldProject = deferred<ProjectAsset[]>();
    const newProject = deferred<ProjectAsset[]>();
    listAssetsMock.mockImplementation(({ projectId }) =>
      projectId === 7 ? oldProject.promise : newProject.promise
    );

    const { result, rerender } = renderHook(
      ({ projectId }) => useOccnAssetSelection(projectId),
      { initialProps: { projectId: 7 } }
    );

    rerender({ projectId: 8 });
    await waitFor(() => expect(listAssetsMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      newProject.resolve([asset(8, 8, "2026-07-22T12:00:00Z")]);
      await newProject.promise;
    });
    expect(result.current.assets.map(({ id }) => id)).toEqual([8]);

    await act(async () => {
      oldProject.resolve([asset(7, 7, "2026-07-22T11:00:00Z")]);
      await oldProject.promise;
    });
    expect(result.current.assets.map(({ id }) => id)).toEqual([8]);
  });
});
