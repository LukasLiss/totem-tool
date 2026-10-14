import { create } from "zustand";

// {resourceId | "Cluster N": {type: n}}
export type TypeNMap = Record<string, Record<string, number>>;

/**
 * Organizational units discovered by the resource profiling explorer, shared
 * with the handover explorer so it can collapse resources into clusters.
 */
export type ClusterInfo = {
  // cluster assignments
  resources: string[];
  resourceObjectTypes: Record<string, string>;
  clusterLabels: number[];        // parallel to resources; -1 = HDBSCAN outlier
  nClusters: number;
  hasOutliers: boolean;
  clusterMap: Record<string, string>;  // resource → "Cluster N"; outliers excluded

  // profile data for tooltips (covers all resources + cluster averages)
  activities: string[];
  cooccurringResources: string[];
  collaboratingResources: string[];
  timeBins: number[];
  weekdayBins: number[];
  portfolioObjectTypes: string[];
  // compact per-node profiles: activities, time, weekday, portfolio only
  // co-occurrence/collaboration per-resource values intentionally excluded
  tooltipProfiles: Record<string, { activities?: number[]; time?: number[]; weekday?: number[]; portfolio?: number[] }>;
  typeTotals: Record<string, number>;
  coocTypeN: TypeNMap;
  collabTypeN: TypeNMap;
};

type ClusterStore = {
  clusterInfo: ClusterInfo | null;
  setClusterInfo: (info: ClusterInfo | null) => void;
};

/**
 * A store rather than a React context: dashboard widgets are rendered into
 * separate React roots by GridStack, which a context provider in the app
 * tree never reaches. The store works across roots, so a resource profiling
 * widget and a handover widget on the same dashboard still share clusters.
 */
export const useClusterStore = create<ClusterStore>((set) => ({
  clusterInfo: null,
  setClusterInfo: (info) => set({ clusterInfo: info }),
}));
