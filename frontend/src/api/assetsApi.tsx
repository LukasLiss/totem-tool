import axios, { AxiosError } from "axios";

export type AssetType = "TOTEM" | "OCCN";

export type ProjectAssetMetadata = Record<string, unknown>;

export interface ProjectAsset {
  id: number;
  project: number;
  name: string;
  asset_type: AssetType;
  content_json: Record<string, unknown>;
  metadata: ProjectAssetMetadata;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ListAssetsParams {
  projectId?: number;
  assetType?: AssetType;
}

export interface UploadAssetParams {
  projectId: number;
  name: string;
  assetType: AssetType;
  file: File;
  metadata?: ProjectAssetMetadata;
}

export interface CreateAssetParams {
  projectId: number;
  name: string;
  assetType: AssetType;
  contentJson: Record<string, unknown>;
  metadata?: ProjectAssetMetadata;
}

export interface UpdateAssetParams {
  assetId: number;
  /** New name; omit to keep the current name. */
  name?: string;
  /** New model content; omit to keep the current content. */
  contentJson?: Record<string, unknown>;
  metadata?: ProjectAssetMetadata;
}

export interface DownloadedAsset {
  blob: Blob;
  filename: string;
}

export interface AssetApiError {
  message: string;
  fields?: Record<string, unknown>;
  status?: number;
}

const ASSETS_URL = "/api/assets/";

export async function listAssets(params: ListAssetsParams = {}) {
  const queryParams = new URLSearchParams();
  if (params.projectId !== undefined) {
    queryParams.set("project", String(params.projectId));
  }
  if (params.assetType) {
    queryParams.set("asset_type", params.assetType);
  }

  const url = queryParams.size > 0
    ? `${ASSETS_URL}?${queryParams.toString()}`
    : ASSETS_URL;
  const { data } = await axios.get<ProjectAsset[]>(url);
  return data;
}

export async function getAsset(assetId: number) {
  const { data } = await axios.get<ProjectAsset>(`${ASSETS_URL}${assetId}/`);
  return data;
}

export async function uploadAsset(params: UploadAssetParams) {
  const formData = new FormData();
  formData.append("project", String(params.projectId));
  formData.append("name", params.name);
  formData.append("asset_type", params.assetType);
  formData.append("file", params.file);
  if (params.metadata !== undefined) {
    formData.append("metadata", JSON.stringify(params.metadata));
  }

  const { data } = await axios.post<ProjectAsset>(ASSETS_URL, formData);
  return data;
}

export async function createAsset(params: CreateAssetParams) {
  const { data } = await axios.post<ProjectAsset>(ASSETS_URL, {
    project: params.projectId,
    name: params.name,
    asset_type: params.assetType,
    content_json: params.contentJson,
    metadata: params.metadata ?? {},
  });
  return data;
}

export async function updateAsset(params: UpdateAssetParams) {
  const payload: Record<string, unknown> = {};
  if (params.name !== undefined) payload.name = params.name;
  if (params.contentJson !== undefined) payload.content_json = params.contentJson;
  if (params.metadata !== undefined) payload.metadata = params.metadata;
  const { data } = await axios.patch<ProjectAsset>(
    `${ASSETS_URL}${params.assetId}/`,
    payload
  );
  return data;
}

export async function deleteAsset(assetId: number) {
  await axios.delete(`${ASSETS_URL}${assetId}/`);
  return true;
}

export async function downloadAsset(assetId: number): Promise<DownloadedAsset> {
  const response = await axios.get<Blob>(`${ASSETS_URL}${assetId}/download/`, {
    responseType: "blob",
  });
  return {
    blob: response.data,
    filename: getFilenameFromContentDisposition(
      response.headers["content-disposition"]
    ),
  };
}

export function extractAssetApiError(error: unknown): AssetApiError {
  if (!axios.isAxiosError(error)) {
    return {
      message: error instanceof Error ? error.message : "Unexpected error.",
    };
  }

  const axiosError = error as AxiosError<unknown>;
  const responseData = axiosError.response?.data;
  if (typeof responseData === "string") {
    return {
      message: responseData,
      status: axiosError.response?.status,
    };
  }
  if (responseData && typeof responseData === "object") {
    return {
      message: getFirstErrorMessage(responseData) ?? "Asset request failed.",
      fields: responseData as Record<string, unknown>,
      status: axiosError.response?.status,
    };
  }
  return {
    message: axiosError.message || "Asset request failed.",
    status: axiosError.response?.status,
  };
}

function getFilenameFromContentDisposition(value: unknown) {
  if (typeof value !== "string") {
    return "model-asset.json";
  }
  const match = value.match(/filename="([^"]+)"/) ?? value.match(/filename=([^;]+)/);
  return match?.[1]?.trim() || "model-asset.json";
}

function getFirstErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(getFirstErrorMessage).find(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value).map(getFirstErrorMessage).find(Boolean);
  }
  return undefined;
}
