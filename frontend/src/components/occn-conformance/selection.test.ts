import { describe, expect, it } from "vitest";

import type { ProjectAsset } from "@/api/assetsApi";

import {
  canRunOccnConformance,
  getSelectableOccnAssets,
  resolveOccnAssetSelection,
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
  asset(1, 7, "OCCN", "2026-07-20T10:00:00Z", "Older"),
  asset(2, 7, "OCCN", "2026-07-22T10:00:00Z", "Newest"),
  asset(3, 8, "OCCN", "2026-07-23T10:00:00Z", "Other project"),
  asset(4, 7, "TOTEM", "2026-07-24T10:00:00Z", "Wrong type"),
];

describe("OCCN conformance asset selection", () => {
  it("keeps only current-project OCCN assets and sorts newest first", () => {
    const originalOrder = assets.map((entry) => entry.id);

    expect(getSelectableOccnAssets(assets, 7).map((entry) => entry.id)).toEqual([
      2, 1,
    ]);
    expect(assets.map((entry) => entry.id)).toEqual(originalOrder);
  });

  it("returns no selectable assets without a valid project", () => {
    expect(getSelectableOccnAssets(assets, null)).toEqual([]);
    expect(getSelectableOccnAssets(assets, 0)).toEqual([]);
  });

  it("retains an existing selection and clears a stale selection", () => {
    const selectable = getSelectableOccnAssets(assets, 7);

    expect(resolveOccnAssetSelection(2, selectable)).toBe(2);
    expect(resolveOccnAssetSelection(3, selectable)).toBeNull();
    expect(resolveOccnAssetSelection(null, selectable)).toBeNull();
  });

  it("enables execution only for a valid log and current-project OCCN asset", () => {
    const ready = {
      eventLogId: 12,
      projectId: 7,
      selectedAssetId: 2,
      assets,
    };

    expect(canRunOccnConformance(ready)).toBe(true);
    expect(canRunOccnConformance({ ...ready, eventLogId: null })).toBe(false);
    expect(canRunOccnConformance({ ...ready, projectId: 0 })).toBe(false);
    expect(canRunOccnConformance({ ...ready, selectedAssetId: 3 })).toBe(false);
    expect(canRunOccnConformance({ ...ready, selectedAssetId: 4 })).toBe(false);
    expect(canRunOccnConformance({ ...ready, assetsLoading: true })).toBe(false);
    expect(canRunOccnConformance({ ...ready, running: true })).toBe(false);
  });
});
