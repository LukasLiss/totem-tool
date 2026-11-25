/**
 * Stored process-area compositions (project assets of type PROCESS_AREAS).
 *
 * The asset's name is the composition's name; its `content_json` is the
 * format of `toAssetContent` in `react_component/process-area/composition`.
 */
import {
  createAsset,
  listAssets,
  updateAsset,
  type ProjectAsset,
} from "@/api/assetsApi";
import {
  toAssetContent,
  type ProcessAreaComposition,
} from "@/react_component/process-area/composition";

export const PROCESS_AREAS_ASSET_TYPE = "PROCESS_AREAS" as const;

export async function listProcessAreaAssets(projectId: number): Promise<ProjectAsset[]> {
  const data = await listAssets({ projectId, assetType: PROCESS_AREAS_ASSET_TYPE });
  return Array.isArray(data) ? data : [];
}

export async function createProcessAreaAsset(params: {
  projectId: number;
  composition: ProcessAreaComposition;
}): Promise<ProjectAsset> {
  return createAsset({
    projectId: params.projectId,
    name: params.composition.name.trim(),
    assetType: PROCESS_AREAS_ASSET_TYPE,
    contentJson: toAssetContent(params.composition) as unknown as Record<string, unknown>,
  });
}

export async function updateProcessAreaAsset(params: {
  assetId: number;
  composition: ProcessAreaComposition;
}): Promise<ProjectAsset> {
  return updateAsset({
    assetId: params.assetId,
    name: params.composition.name.trim(),
    contentJson: toAssetContent(params.composition) as unknown as Record<string, unknown>,
  });
}
