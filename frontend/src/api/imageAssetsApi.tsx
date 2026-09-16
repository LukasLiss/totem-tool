import axios from "axios";

import { API_BASE_URL } from "@/config/api";
import { extractAssetApiError } from "@/api/assetsApi";

export interface ImageAsset {
  id: number;
  project: number;
  name: string;
  /** Backend-relative URL of the stored file (e.g. /files/image_assets/1/x.png). */
  url: string | null;
  content_type: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export const IMAGE_ASSET_ACCEPT = ".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml";

const IMAGE_ASSETS_URL = "/api/image-assets/";

/** Absolute URL for rendering an image asset in an <img> tag. */
export function imageAssetSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function listImageAssets(projectId?: number) {
  const url =
    projectId !== undefined
      ? `${IMAGE_ASSETS_URL}?project=${projectId}`
      : IMAGE_ASSETS_URL;
  const { data } = await axios.get<ImageAsset[]>(url);
  return data;
}

export async function uploadImageAsset(params: {
  projectId: number;
  name: string;
  file: File;
}) {
  const formData = new FormData();
  formData.append("project", String(params.projectId));
  formData.append("name", params.name);
  formData.append("image", params.file);
  const { data } = await axios.post<ImageAsset>(IMAGE_ASSETS_URL, formData);
  return data;
}

export async function renameImageAsset(assetId: number, name: string) {
  const { data } = await axios.patch<ImageAsset>(
    `${IMAGE_ASSETS_URL}${assetId}/`,
    { name }
  );
  return data;
}

export async function deleteImageAsset(assetId: number) {
  await axios.delete(`${IMAGE_ASSETS_URL}${assetId}/`);
  return true;
}

/** Same field-aware error extraction as the model asset API. */
export const extractImageAssetApiError = extractAssetApiError;
