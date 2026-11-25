import { useEffect } from "react";
import { create } from "zustand";

import { extractAssetApiError, type ProjectAsset } from "@/api/assetsApi";
import { listProcessAreaAssets } from "@/api/processAreaAssetsApi";

type ProjectEntry = {
  assets: ProjectAsset[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
};

type ProcessAreaAssetsStore = {
  byProject: Record<number, ProjectEntry>;
  load: (projectId: number, options?: { force?: boolean }) => Promise<void>;
  upsert: (asset: ProjectAsset) => void;
  remove: (projectId: number, assetId: number) => void;
};

const EMPTY: ProjectEntry = { assets: [], loading: false, error: null, loaded: false };
const inFlight = new Map<number, Promise<void>>();

const byName = (a: ProjectAsset, b: ProjectAsset) => a.name.localeCompare(b.name);

/**
 * The stored process-area compositions of each project.
 *
 * Shared so that saving a composition in the Process Area view immediately
 * shows up in every picker (Variants, OC alignment, asset store) without
 * each of them refetching.
 */
export const useProcessAreaAssetsStore = create<ProcessAreaAssetsStore>((set, get) => ({
  byProject: {},
  load: async (projectId, options) => {
    const current = get().byProject[projectId];
    if (!options?.force && current?.loaded) return;
    const pending = inFlight.get(projectId);
    if (pending && !options?.force) return pending;
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: { ...(state.byProject[projectId] ?? EMPTY), loading: true, error: null },
      },
    }));
    const request = listProcessAreaAssets(projectId)
      .then((assets) => {
        set((state) => ({
          byProject: {
            ...state.byProject,
            [projectId]: { assets: [...assets].sort(byName), loading: false, error: null, loaded: true },
          },
        }));
      })
      .catch((error: unknown) => {
        set((state) => ({
          byProject: {
            ...state.byProject,
            [projectId]: {
              ...(state.byProject[projectId] ?? EMPTY),
              loading: false,
              error: extractAssetApiError(error).message,
              loaded: true,
            },
          },
        }));
      })
      .finally(() => inFlight.delete(projectId));
    inFlight.set(projectId, request);
    return request;
  },
  upsert: (asset) =>
    set((state) => {
      const entry = state.byProject[asset.project] ?? { ...EMPTY, loaded: true };
      const assets = [...entry.assets.filter((a) => a.id !== asset.id), asset].sort(byName);
      return { byProject: { ...state.byProject, [asset.project]: { ...entry, assets } } };
    }),
  remove: (projectId, assetId) =>
    set((state) => {
      const entry = state.byProject[projectId];
      if (!entry) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...entry, assets: entry.assets.filter((a) => a.id !== assetId) },
        },
      };
    }),
}));

/** Stored compositions of a project; loads them on first use. */
export function useProcessAreaAssets(projectId: number | null | undefined) {
  const entry = useProcessAreaAssetsStore((state) =>
    projectId ? state.byProject[projectId] ?? EMPTY : EMPTY,
  );
  const load = useProcessAreaAssetsStore((state) => state.load);
  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);
  return {
    ...entry,
    reload: () => (projectId ? load(projectId, { force: true }) : Promise.resolve()),
  };
}
