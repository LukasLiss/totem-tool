import { createContext, useContext, useState, type ReactNode } from "react";

export type ClusterInfo = {
  resources: string[];
  resourceObjectTypes: Record<string, string>;
  clusterLabels: number[];        // parallel to resources; -1 = HDBSCAN outlier
  nClusters: number;
  hasOutliers: boolean;
  // resource → "Cluster N"; outliers (label -1) are excluded
  clusterMap: Record<string, string>;
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
