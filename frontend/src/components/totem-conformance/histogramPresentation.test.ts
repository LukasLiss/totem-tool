import { describe, expect, it } from "vitest";

import {
  createHistogramTable,
  formatHistogramShare,
} from "./histogramPresentation";

describe("TOTeM histogram presentation", () => {
  it("lays temporal records out as rows with a summed row", () => {
    const table = createHistogramTable(
      [
        { label: "a", counts: { total: 10, P: 10, D: 5, custom: 1 } },
        { label: "b", counts: { total: 4, Ii: 4, P: 4 } },
      ],
      "temporal"
    );

    expect(table.columns.map(({ label }) => label)).toEqual([
      "D",
      "D-i",
      "I",
      "I-i",
      "P",
      "custom",
    ]);
    expect(table.rows[0]).toMatchObject({ total: 10, counts: { D: 5, Di: 0 } });
    expect(table.sum).toMatchObject({
      label: "Sum",
      total: 14,
      counts: { D: 5, Ii: 4, P: 14, custom: 1 },
    });
  });

  it("falls back to summed counts without a declared total", () => {
    const table = createHistogramTable(
      [{ label: "Pick", counts: { "1": 3, "0": -2, "1..*": Number.NaN } }],
      "event_cardinality"
    );

    expect(table.columns.map(({ key }) => key)).toEqual([
      "0",
      "1",
      "0...1",
      "1..*",
      "0...*",
    ]);
    expect(table.rows[0].total).toBe(3);
    expect(table.rows[0].counts["0"]).toBe(0);
  });

  it("formats shares as whole percentages", () => {
    expect(formatHistogramShare(13, 30)).toBe("43%");
    expect(formatHistogramShare(0, 0)).toBe("-");
  });
});
