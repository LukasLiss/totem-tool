import { createContext, useContext, useState, type ReactNode } from "react";

// {resourceId | "Cluster N": {type: n}}
export type TypeNMap = Record<string, Record<string, number>>;

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

type ClusterContextValue = {
  clusterInfo: ClusterInfo | null;
  setClusterInfo: (info: ClusterInfo | null) => void;
};

export const ClusterContext = createContext<ClusterContextValue>({
  clusterInfo: null,
  setClusterInfo: () => {},
});

export function ClusterProvider({ children }: { children: ReactNode }) {
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);
  return (
    <ClusterContext.Provider value={{ clusterInfo, setClusterInfo }}>
      {children}
    </ClusterContext.Provider>
  );
}

export function useCluster() {
  return useContext(ClusterContext);
}
