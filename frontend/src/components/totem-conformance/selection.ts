import type { ProjectAsset } from "@/api/assetsApi";

const isPositiveInteger = (value: number | null | undefined): value is number =>
  Number.isInteger(value) && (value as number) > 0;

export function getSelectableTotemAssets(
  assets: ProjectAsset[],
  projectId: number | null | undefined
): ProjectAsset[] {
  if (!isPositiveInteger(projectId)) return [];

  return assets
    .filter(
      (asset) =>
        asset.project === projectId && asset.asset_type === "TOTEM"
    )
    .slice()
    .sort(
      (left, right) =>
        right.updated_at.localeCompare(left.updated_at) ||
        left.name.localeCompare(right.name) ||
        left.id - right.id
    );
}

export function resolveTotemAssetSelection(
  selectedAssetId: number | null | undefined,
  assets: ProjectAsset[]
): number | null {
  if (!isPositiveInteger(selectedAssetId)) return null;
  return assets.some((asset) => asset.id === selectedAssetId)
    ? selectedAssetId
    : null;
}

export function formatLastChanged(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export interface TotemConformanceReadiness {
  eventLogId: number | null | undefined;
  projectId: number | null | undefined;
  selectedAssetId: number | null | undefined;
  assets: ProjectAsset[];
  assetsLoading?: boolean;
  running?: boolean;
}

export function canRunTotemConformance({
  eventLogId,
  projectId,
  selectedAssetId,
  assets,
  assetsLoading = false,
  running = false,
}: TotemConformanceReadiness): boolean {
  if (
    !isPositiveInteger(eventLogId) ||
    !isPositiveInteger(projectId) ||
    !isPositiveInteger(selectedAssetId) ||
    assetsLoading ||
    running
  ) {
    return false;
  }

  return assets.some(
    (asset) =>
      asset.id === selectedAssetId &&
      asset.project === projectId &&
      asset.asset_type === "TOTEM"
  );
}
