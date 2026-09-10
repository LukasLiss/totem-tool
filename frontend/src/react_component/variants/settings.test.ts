import { describe, expect, it } from "vitest";

import {
  applyProcessArea,
  columnNameError,
  matchingProcessAreaId,
  processAreaOptionLabel,
  settingsBlocker,
  summarizeSettings,
  toAdvancedSettings,
} from "./settings";
import { DEFAULT_STORE_SETTINGS, type ExecutionSettings } from "./types";

const leading: ExecutionSettings = {
  extraction: "leading_1hop",
  leadingType: "order",
  businessObjectTypes: [],
  businessActivities: [],
};
const resourceAware: ExecutionSettings = {
  extraction: "resource_aware",
  leadingType: "",
  businessObjectTypes: ["item", "order"],
  businessActivities: ["place order"],
};
const area = {
  id: "level-0-area-0",
  level: 0,
  label: "order & item",
  objectTypes: ["order", "item"],
  activities: ["place order"],
};

describe("columnNameError", () => {
  it("accepts plain names and rejects fixed or malformed ones", () => {
    expect(columnNameError("process execution")).toBeNull();
    expect(columnNameError("exec_id-1")).toBeNull();
    expect(columnNameError("")).toMatch(/Enter/);
    expect(columnNameError("event_id")).toMatch(/fixed column/);
    expect(columnNameError('bad"name')).toMatch(/Use 1–64/);
    expect(columnNameError("a".repeat(65))).toMatch(/Use 1–64/);
  });
});

describe("settingsBlocker", () => {
  it("requires a leading type for leading extractions", () => {
    expect(settingsBlocker({ ...leading, leadingType: "" }, DEFAULT_STORE_SETTINGS)).toMatch(/leading/);
    expect(settingsBlocker(leading, DEFAULT_STORE_SETTINGS)).toBeNull();
  });

  it("requires business object types for the resource-aware extraction", () => {
    expect(
      settingsBlocker({ ...resourceAware, businessObjectTypes: [] }, DEFAULT_STORE_SETTINGS),
    ).toMatch(/business object type/);
    expect(settingsBlocker(resourceAware, DEFAULT_STORE_SETTINGS)).toBeNull();
  });

  it("validates the store columns only when storing is enabled", () => {
    expect(
      settingsBlocker(leading, { ...DEFAULT_STORE_SETTINGS, executionColumn: "" }),
    ).toBeNull();
    expect(
      settingsBlocker(leading, { ...DEFAULT_STORE_SETTINGS, enabled: true, executionColumn: "" }),
    ).toMatch(/Execution column/);
    expect(
      settingsBlocker(leading, {
        enabled: true,
        executionColumn: "exec",
        computeVariants: true,
        storeVariantColumn: true,
        variantColumn: "exec",
      }),
    ).toMatch(/must differ/);
    expect(
      settingsBlocker(leading, {
        enabled: true,
        executionColumn: "exec",
        computeVariants: false,
        storeVariantColumn: true,
        variantColumn: "",
      }),
    ).toBeNull();
  });
});

describe("process areas", () => {
  it("applies an area as business objects and activities", () => {
    const next = applyProcessArea(leading, area);
    expect(next.extraction).toBe("resource_aware");
    expect(next.businessObjectTypes).toEqual(["item", "order"]);
    expect(next.businessActivities).toEqual(["place order"]);
    expect(next.leadingType).toBe("order");
  });

  it("recognises the area matching the current selection", () => {
    expect(matchingProcessAreaId(resourceAware, [area])).toBe(area.id);
    expect(matchingProcessAreaId({ ...resourceAware, businessActivities: [] }, [area])).toBeNull();
    expect(matchingProcessAreaId(leading, [area])).toBeNull();
  });

  it("labels areas by their object types and level", () => {
    expect(processAreaOptionLabel(area)).toBe("order, item · level 0");
    expect(
      processAreaOptionLabel({ ...area, objectTypes: ["a", "b", "c", "d"] }, 2),
    ).toBe("a, b +2 more · level 0");
  });
});

describe("summaries and persistence", () => {
  it("summarises the active settings in one line", () => {
    expect(summarizeSettings(leading, "wl+vf2", DEFAULT_STORE_SETTINGS)).toBe(
      "Leading type — 1-hop · leading: order · WL + VF2",
    );
    expect(
      summarizeSettings(resourceAware, "exact", {
        ...DEFAULT_STORE_SETTINGS,
        enabled: true,
        computeVariants: false,
      }),
    ).toBe("Resource-aware · 2 business object types · 1 business activity · store executions only");
  });

  it("converts to the dashboard-persisted shape", () => {
    expect(toAdvancedSettings(resourceAware, "wl", 30)).toEqual({
      extraction: "resource_aware",
      iso: "wl",
      timeout_s: 30,
      leading_type: "",
      business_object_types: ["item", "order"],
      business_activities: ["place order"],
    });
  });
});
