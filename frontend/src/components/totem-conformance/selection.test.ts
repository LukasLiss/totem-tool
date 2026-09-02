import { describe, expect, it } from "vitest";

import type { ProjectAsset } from "@/api/assetsApi";

import {
  canRunTotemConformance,
  getSelectableTotemAssets,
  resolveTotemAssetSelection,
} from "./selection";

const asset = (
  id: number,
  project: number,
  assetType: ProjectAsset["asset_type"],
  updatedAt: string,
  name = `Model ${id}`
): ProjectAsset => ({
  id,
  project,
  name,
  asset_type: assetType,
  content_json: {},
  metadata: {},
  created_by: 1,
  created_at: updatedAt,
  updated_at: updatedAt,
});

const assets = [
  asset(1, 7, "TOTEM", "2026-07-20T10:00:00Z", "Older"),
  asset(2, 7, "TOTEM", "2026-07-22T10:00:00Z", "Newest"),
  asset(3, 8, "TOTEM", "2026-07-23T10:00:00Z", "Other project"),
  asset(4, 7, "OCCN", "2026-07-24T10:00:00Z", "Wrong type"),
];

describe("TOTeM conformance asset selection", () => {
  it("keeps only current-project TOTEM assets and sorts newest first", () => {
    const originalOrder = assets.map((entry) => entry.id);

    expect(getSelectableTotemAssets(assets, 7).map((entry) => entry.id)).toEqual([
      2, 1,
    ]);
    expect(assets.map((entry) => entry.id)).toEqual(originalOrder);
  });

  it("returns no selectable assets without a valid project", () => {
    expect(getSelectableTotemAssets(assets, null)).toEqual([]);
    expect(getSelectableTotemAssets(assets, 0)).toEqual([]);
  });

  it("retains an existing selection and clears a stale selection", () => {
    const selectable = getSelectableTotemAssets(assets, 7);

    expect(resolveTotemAssetSelection(2, selectable)).toBe(2);
    expect(resolveTotemAssetSelection(3, selectable)).toBeNull();
    expect(resolveTotemAssetSelection(null, selectable)).toBeNull();
  });

  it("enables execution only for a valid log and current-project TOTEM asset", () => {
    const ready = {
      eventLogId: 12,
      projectId: 7,
      selectedAssetId: 2,
      assets,
    };

    expect(canRunTotemConformance(ready)).toBe(true);
    expect(canRunTotemConformance({ ...ready, eventLogId: null })).toBe(false);
    expect(canRunTotemConformance({ ...ready, selectedAssetId: 3 })).toBe(false);
    expect(canRunTotemConformance({ ...ready, selectedAssetId: 4 })).toBe(false);
    expect(canRunTotemConformance({ ...ready, assetsLoading: true })).toBe(false);
    expect(canRunTotemConformance({ ...ready, running: true })).toBe(false);
  });
});
