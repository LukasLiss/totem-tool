/**
 * Resolves a stored query (a QUERY project asset) by id. Components that link
 * a stored query fetch it on mount instead of keeping a copy, so an edit in
 * the asset store shows up everywhere on the next render.
 */

import { useEffect, useState } from "react";
import {
  extractAssetApiError,
  getAsset,
  queryAssetDescription,
  queryAssetSql,
  type ProjectAsset,
} from "@/api/assetsApi";

export interface StoredQueryState {
  asset: ProjectAsset | null;
  /** SQL text of the asset, "" while loading or when unavailable */
  query: string;
  name: string;
  description: string;
  loading: boolean;
  error: string | null;
}

const EMPTY: StoredQueryState = {
  asset: null,
  query: "",
  name: "",
  description: "",
  loading: false,
  error: null,
};

export function useStoredQuery(assetId: number | null | undefined): StoredQueryState {
  const [state, setState] = useState<StoredQueryState>(EMPTY);

  useEffect(() => {
    if (!assetId) {
      setState(EMPTY);
      return;
    }
    let alive = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    getAsset(assetId)
      .then((asset) => {
        if (!alive) return;
        if (asset.asset_type !== "QUERY") {
          setState({ ...EMPTY, error: "The linked asset is not a stored query." });
          return;
        }
        setState({
          asset,
          query: queryAssetSql(asset),
          name: asset.name,
          description: queryAssetDescription(asset),
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (!alive) return;
        const { message, status } = extractAssetApiError(err);
        setState({
          ...EMPTY,
          error:
            status === 404
              ? "The linked stored query no longer exists."
              : message || "Could not load the linked stored query.",
        });
      });
    return () => {
      alive = false;
    };
  }, [assetId]);

  return state;
}

/**
 * The query a component should run: the linked stored query when one is set
 * (and loaded), otherwise its own text. `ready` is false while a link is
 * still resolving so callers do not run the stale local text in between.
 */
export function useEffectiveQuery(localQuery: string, assetId: number | null | undefined) {
  const stored = useStoredQuery(assetId);
  const linked = Boolean(assetId);
  return {
    query: linked ? stored.query : localQuery,
    ready: !linked || (!stored.loading && !stored.error),
    stored,
    linked,
  };
}
