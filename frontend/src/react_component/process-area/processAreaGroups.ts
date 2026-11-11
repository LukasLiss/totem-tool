/**
 * Process areas offered by pickers: the areas shown now (Process Area
 * component or a default discovery) and every composition stored in the
 * project assets.
 */
import { useContext, useMemo } from "react";

import type { ProjectAsset } from "@/api/assetsApi";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { useProcessAreaAssets } from "@/store/processAreaAssetsStore";
import type { ProcessAreaSnapshot, ProcessAreasSnapshot } from "@/store/processAreaStore";

import { compositionToLayers, fromAssetContent } from "./composition";

export type PickableArea = Pick<ProcessAreaSnapshot, "id" | "level" | "label" | "name" | "objectTypes" | "activities">;

export type ProcessAreaGroup = {
  key: string;
  label: string;
  /** Present for stored compositions. */
  assetId?: number;
  areas: PickableArea[];
};

/** The areas of a stored composition, highest level first. */
export function assetSnapshotAreas(asset: Pick<ProjectAsset, "id" | "name" | "content_json">): PickableArea[] {
  const composition = fromAssetContent(asset.content_json, { name: asset.name, assetId: asset.id });
  return compositionToLayers(composition).flatMap((layer) => layer.areas);
}

/** Display name of an area: its given name, else its object types and level. */
export function areaDisplayName(area: PickableArea, maxTypes = 3): string {
  if (area.name) return area.name;
  const shown = area.objectTypes.slice(0, maxTypes).join(", ");
  const rest = area.objectTypes.length - maxTypes;
  return `${rest > 0 ? `${shown} +${rest} more` : shown} · level ${area.level}`;
}

export function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v));
}

export function currentGroupLabel(current: ProcessAreasSnapshot): string {
  if (current.composition?.name) return `Shown now: ${current.composition.name}`;
  return `Discovered${current.filtered ? " (filtered log)" : ""}`;
}

/** Current areas first, then every stored composition. */
export function useProcessAreaGroups(current: ProcessAreasSnapshot | null, projectId?: number | null) {
  const { selectedFile } = useContext(SelectedFileContext);
  const stored = useProcessAreaAssets(projectId ?? selectedFile?.project ?? null);
  const groups = useMemo<ProcessAreaGroup[]>(() => {
    const result: ProcessAreaGroup[] = [];
    if (current && current.areas.length > 0) {
      result.push({ key: "current", label: currentGroupLabel(current), areas: current.areas });
    }
    stored.assets.forEach((asset) => {
      // The composition shown right now is already listed as "current".
      if (current?.composition?.assetId === asset.id) return;
      result.push({
        key: `asset:${asset.id}`,
        label: asset.name,
        assetId: asset.id,
        areas: assetSnapshotAreas(asset),
      });
    });
    return result;
  }, [current, stored.assets]);
  return { groups, loading: stored.loading };
}
