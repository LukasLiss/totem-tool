import { describe, expect, it } from "vitest";

import {
  inferModelAssetType,
  modelAssetNameFromFilename,
} from "./modelAssetFiles";

describe("modelAssetNameFromFilename", () => {
  it("uses the model filename without its final extension", () => {
    expect(modelAssetNameFromFilename("/tmp/order-model.json")).toBe(
      "order-model",
    );
  });
});

describe("inferModelAssetType", () => {
  it.each([
    ["TOTEM", "totem"],
    ["OCCN", "occn"],
  ] as const)("infers %s from its schema", async (assetType, schema) => {
    const file = new File([JSON.stringify({ schema })], "model.json");

    await expect(inferModelAssetType(file)).resolves.toBe(assetType);
  });

  it("rejects invalid JSON", async () => {
    const file = new File(["not-json"], "model.json");

    await expect(inferModelAssetType(file)).rejects.toThrow(
      "valid JSON",
    );
  });

  it("rejects an unsupported schema", async () => {
    const file = new File([JSON.stringify({ schema: "unknown" })], "model.json");

    await expect(inferModelAssetType(file)).rejects.toThrow(
      'Unsupported model schema "unknown"',
    );
  });
});
