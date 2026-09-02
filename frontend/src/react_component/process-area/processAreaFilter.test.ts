import { describe, expect, it } from "vitest";

import {
  activitiesForProcessAreaFilter,
  buildProcessAreaFilterRules,
  describeObjectTypes,
  PROCESS_AREA_FILTER_TYPES,
} from "./processAreaFilter";

const area = {
  objectTypes: ["order", "item"],
  activities: ["place order", "close order"],
};
const byType = {
  order: ["place order", "close order"],
  item: ["place order", "pick item", "pack items"],
  worker: ["start shift", "pick item"],
};

describe("activitiesForProcessAreaFilter", () => {
  it("keeps only the assigned activities in the level-based view", () => {
    expect(activitiesForProcessAreaFilter(area, false, byType)).toEqual([
      "close order",
      "place order",
    ]);
  });

  it("keeps every activity of the area's types in the detailed view", () => {
    expect(activitiesForProcessAreaFilter(area, true, byType)).toEqual([
      "close order",
      "pack items",
      "pick item",
      "place order",
    ]);
  });

  it("falls back to the assigned activities without a per-type map", () => {
    expect(activitiesForProcessAreaFilter(area, true)).toEqual([
      "close order",
      "place order",
    ]);
  });
});

describe("buildProcessAreaFilterRules", () => {
  it("produces one enabled rule per overwritten filter type", () => {
    const rules = buildProcessAreaFilterRules(["item", "order"], ["b", "a", "a"]);
    expect(rules.map((rule) => rule.type)).toEqual(PROCESS_AREA_FILTER_TYPES);
    expect(rules.every((rule) => rule.enabled)).toBe(true);
    expect(rules[0].params).toEqual({ include: ["item", "order"] });
    expect(rules[1].params).toEqual({ include: ["a", "b"] });
  });
});

describe("describeObjectTypes", () => {
  it("shortens long lists", () => {
    expect(describeObjectTypes([])).toBe("no object types");
    expect(describeObjectTypes(["a", "b"])).toBe("a, b");
    expect(describeObjectTypes(["a", "b", "c", "d", "e"])).toBe("a, b, c +2 more");
    expect(describeObjectTypes(["a", "b", "c"], 2)).toBe("a, b +1 more");
  });
});
