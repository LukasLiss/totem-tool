// Organizational units shared between the resource profiling and handover
// explorers. Backed by a zustand store (see store/clusterStore.ts) so it also
// works across the separate React roots GridStack renders dashboard widgets
// into; this module keeps the hook-style API the explorers use.
import { useClusterStore } from "@/store/clusterStore";

export type { ClusterInfo, TypeNMap } from "@/store/clusterStore";

export function useCluster() {
  const clusterInfo = useClusterStore((s) => s.clusterInfo);
  const setClusterInfo = useClusterStore((s) => s.setClusterInfo);
  return { clusterInfo, setClusterInfo };
}
