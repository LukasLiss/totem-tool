import type { ProjectAsset } from "@/api/assetsApi";

/** reference to a stored query (a QUERY project asset) a component links */
export interface LinkedQuery {
  id: number;
  name: string;
}

export function toLinkedQuery(asset: ProjectAsset): LinkedQuery {
  return { id: asset.id, name: asset.name };
}
