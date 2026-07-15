import type { AssetType } from "@/api/assetsApi";

const EXPECTED_SCHEMA_BY_TYPE: Record<AssetType, string> = {
  TOTEM: "totem",
  OCCN: "occn",
};

export function formatAssetType(assetType: AssetType) {
  return assetType === "TOTEM" ? "TOTeM" : "OCCN";
}

export function modelAssetNameFromFilename(filename: string) {
  const leafName = filename.split(/[\\/]/).pop()?.trim() ?? "";
  const filenameStem = leafName.replace(/\.[^.]+$/, "").trim();
  return (filenameStem || "Model asset").slice(0, 100);
}

export async function inferModelAssetType(file: File): Promise<AssetType> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("Model file content must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model asset JSON must be an object.");
  }

  const schema = (parsed as Record<string, unknown>).schema;
  if (typeof schema !== "string") {
    throw new Error("Model asset JSON must declare a schema.");
  }

  const assetType = Object.entries(EXPECTED_SCHEMA_BY_TYPE).find(
    ([, expectedSchema]) => schema === expectedSchema,
  )?.[0] as AssetType | undefined;
  if (!assetType) throw new Error(`Unsupported model schema "${schema}".`);
  return assetType;
}
