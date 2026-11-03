import { afterEach, describe, expect, it, vi } from "vitest";
import axios from "axios";

import { existingColumns, processAreaColumnsBlocker } from "./settings";
import { DEFAULT_PROCESS_AREA_COLUMNS } from "./types";
import { computeProcessAreaVariants, orderProcessAreas, toProcessAreaRequest } from "./variantsApi";

describe("process-area columns", () => {
  it("accepts the default columns", () => {
    expect(processAreaColumnsBlocker(DEFAULT_PROCESS_AREA_COLUMNS)).toBeNull();
  });

  it("rejects equal or invalid column names", () => {
    expect(processAreaColumnsBlocker({ executionColumn: "x", variantColumn: " x " })).toMatch(/must differ/);
    expect(processAreaColumnsBlocker({ executionColumn: "", variantColumn: "v" })).toMatch(/^Execution column/);
    expect(processAreaColumnsBlocker({ executionColumn: "e", variantColumn: "activity" })).toMatch(/^Variant column/);
  });

  it("lists the requested columns that already exist", () => {
    expect(
      existingColumns(DEFAULT_PROCESS_AREA_COLUMNS, ["price", "variant-cc-process-areas"]),
    ).toEqual(["variant-cc-process-areas"]);
    expect(existingColumns(DEFAULT_PROCESS_AREA_COLUMNS, ["price"])).toEqual([]);
  });
});

describe("process-area requests", () => {
  it("names an area after its object types", () => {
    expect(toProcessAreaRequest({ objectTypes: ["order", "item"], activities: ["b", "a"] })).toEqual({
      label: "item, order",
      object_types: ["item", "order"],
      activities: ["a", "b"],
    });
  });

  it("orders areas bottom layer first", () => {
    const ordered = orderProcessAreas([
      { level: 2, objectTypes: ["truck"] },
      { level: 0, objectTypes: ["order"] },
      { level: 0, objectTypes: ["item"] },
    ]);
    expect(ordered.map((a) => a.objectTypes[0])).toEqual(["item", "order", "truck"]);
  });
});

describe("computeProcessAreaVariants", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts the areas and columns, and omits the columns when not storing", async () => {
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: { areas: [] } });
    const areas = [{ label: "order", object_types: ["order"], activities: ["place order"] }];
    const grouping = { iso: "wl" as const, timeoutS: 5 };

    await computeProcessAreaVariants(7, areas, grouping, { store: true, columns: DEFAULT_PROCESS_AREA_COLUMNS }, false);
    expect(post).toHaveBeenLastCalledWith(
      "/api/files/7/process_area_variants/",
      {
        areas,
        iso: "wl",
        timeout_s: 5,
        store: true,
        execution_column: "process-executions-cc-process-areas",
        variant_column: "variant-cc-process-areas",
      },
      { params: undefined, _skipGlobalFilter: true },
    );

    await computeProcessAreaVariants(7, areas, grouping, { store: false, columns: DEFAULT_PROCESS_AREA_COLUMNS }, false);
    expect(post.mock.lastCall?.[1]).toEqual({ areas, iso: "wl", timeout_s: 5, store: false });
  });
});
