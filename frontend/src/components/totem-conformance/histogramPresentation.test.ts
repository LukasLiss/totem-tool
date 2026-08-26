import { describe, expect, it } from "vitest";

import { createHistogramRows } from "./histogramPresentation";

describe("TOTeM histogram presentation", () => {
  it("orders temporal relations and derives ratios from the declared total", () => {
    const rows = createHistogramRows(
      { total: 10, P: 2, D: 5, custom: 1 },
      "temporal"
    );

    expect(rows.map(({ key }) => key)).toEqual([
      "D",
      "Di",
      "I",
      "Ii",
      "P",
      "custom",
    ]);
    expect(rows.find(({ key }) => key === "D")).toMatchObject({
      count: 5,
      ratio: 0.5,
    });
  });

  it("falls back to the sum of counts when total is unavailable", () => {
    const rows = createHistogramRows({ "0": 1, "1": 3 }, "event_cardinality");

    expect(rows.find(({ key }) => key === "1")?.ratio).toBe(0.75);
  });

  it("clamps invalid counts to zero", () => {
    const rows = createHistogramRows(
      { total: 2, D: -1, I: Number.NaN },
      "temporal"
    );

    expect(rows.find(({ key }) => key === "D")?.count).toBe(0);
    expect(rows.find(({ key }) => key === "I")?.count).toBe(0);
  });
});
