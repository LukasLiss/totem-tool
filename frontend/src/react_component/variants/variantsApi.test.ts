import { describe, expect, it } from "vitest";

import { buildExtractionParams, buildStoreBody } from "./variantsApi";
import { DEFAULT_STORE_SETTINGS, type ExecutionSettings } from "./types";

const grouping = { iso: "wl+vf2" as const, timeoutS: 10 };

describe("buildExtractionParams", () => {
  it("sends the leading type only for leading extractions", () => {
    const params = buildExtractionParams({
      extraction: "leading_bfs",
      leadingType: "order",
      businessObjectTypes: ["ignored"],
      businessActivities: ["ignored"],
    });
    expect(params.toString()).toBe("extraction=leading_bfs&leading_type=order");
  });

  it("repeats list parameters for the resource-aware extraction", () => {
    const params = buildExtractionParams({
      extraction: "resource_aware",
      leadingType: "order",
      businessObjectTypes: ["order", "item"],
      businessActivities: ["place order", "pick, pack"],
    });
    expect(params.getAll("business_object_types")).toEqual(["order", "item"]);
    expect(params.getAll("business_activities")).toEqual(["place order", "pick, pack"]);
    expect(params.has("leading_type")).toBe(false);
  });
});

describe("buildStoreBody", () => {
  const execution: ExecutionSettings = {
    extraction: "resource_aware",
    leadingType: "",
    businessObjectTypes: ["order"],
    businessActivities: [],
  };

  it("skips the grouping settings when variants are not computed", () => {
    expect(
      buildStoreBody(execution, grouping, {
        ...DEFAULT_STORE_SETTINGS,
        enabled: true,
        executionColumn: " exec ",
        computeVariants: false,
      }),
    ).toEqual({
      extraction: "resource_aware",
      execution_column: "exec",
      compute_variants: false,
      timeout_s: 10,
      business_object_types: ["order"],
      business_activities: [],
    });
  });

  it("includes iso and the variant column when requested", () => {
    expect(
      buildStoreBody({ ...execution, extraction: "leading_1hop", leadingType: "order" }, grouping, {
        enabled: true,
        executionColumn: "exec",
        computeVariants: true,
        storeVariantColumn: true,
        variantColumn: "variant",
      }),
    ).toEqual({
      extraction: "leading_1hop",
      leading_type: "order",
      execution_column: "exec",
      compute_variants: true,
      timeout_s: 10,
      iso: "wl+vf2",
      variant_column: "variant",
    });
  });
});
