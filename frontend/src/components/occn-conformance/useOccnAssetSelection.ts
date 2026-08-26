import { useCallback, useEffect, useMemo, useState } from "react";

import {
  extractAssetApiError,
  listAssets,
  type ProjectAsset,
} from "@/api/assetsApi";

import {
  getSelectableOccnAssets,
  resolveOccnAssetSelection,
} from "./selection";

export interface OccnAssetSelectionState {
  assets: ProjectAsset[];
  selectedAssetId: number | null;
  selectedAsset: ProjectAsset | null;
  loading: boolean;
  error: string | null;
  selectAsset: (assetId: number | null) => void;
  retry: () => void;
}

export function useOccnAssetSelection(
  projectId: number | null | undefined,
  initialAssetId?: number | null
): OccnAssetSelectionState {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setSelectedAssetId(null);
    setAssets([]);
    setError(null);

    if (!projectId || projectId < 1) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void listAssets({ projectId, assetType: "OCCN" })
      .then((response) => {
        if (cancelled) return;
        const result = Array.isArray(response) ? response : [];
        setAssets(getSelectableOccnAssets(result, projectId));
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setAssets([]);
        setError(extractAssetApiError(requestError).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  useEffect(() => {
    setSelectedAssetId((current) =>
      resolveOccnAssetSelection(current ?? initialAssetId, assets)
    );
  }, [assets, initialAssetId]);

  const selectAsset = useCallback(
    (assetId: number | null) => {
      setSelectedAssetId(resolveOccnAssetSelection(assetId, assets));
    },
    [assets]
  );

  const retry = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId]
  );

  return {
    assets,
    selectedAssetId,
    selectedAsset,
    loading,
    error,
    selectAsset,
    retry,
  };
}
