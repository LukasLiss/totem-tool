import { describe, expect, it } from "vitest";

import type { OCCNConformanceResponse } from "@/api/occnConformanceApi";

import {
  formatOccnRatio,
  getOccnAggregatePresentation,
} from "./conformancePresentation";

function result(
  overrides: Partial<OCCNConformanceResponse> = {}
): OCCNConformanceResponse {
  return {
    file_id: 1,
    asset_id: 2,
    replay_unit_strategy: "connected_components",
    fitness: 1,
    coverage: 1,
    total_units: 2,
    fitting_units: 2,
    non_fitting_units: 0,
    inconclusive_units: 0,
    unit_results: [],
    ...overrides,
  };
}

describe("OCCN conformance presentation", () => {
  it("formats available and unavailable ratios", () => {
    expect(formatOccnRatio(1)).toBe("100%");
    expect(formatOccnRatio(0.5)).toBe("50%");
    expect(formatOccnRatio(2 / 3)).toBe("66.7%");
    expect(formatOccnRatio(null)).toBe("Not available");
  });

  it("reports a fully fitting result only when every unit is conclusive", () => {
    expect(getOccnAggregatePresentation(result())).toMatchObject({
      outcome: "fitting",
      label: "Fitting",
    });
  });

  it("prioritizes proven deviations while disclosing partial coverage", () => {
    expect(
      getOccnAggregatePresentation(
        result({
          fitness: 0.5,
          coverage: 2 / 3,
          total_units: 3,
          fitting_units: 1,
          non_fitting_units: 1,
          inconclusive_units: 1,
        })
      )
    ).toMatchObject({
      outcome: "non_fitting",
      label: "Deviations found (partial)",
    });
  });

  it("does not present 100% conclusive fitness as a complete result", () => {
    expect(
      getOccnAggregatePresentation(
        result({
          coverage: 0.5,
          total_units: 2,
          fitting_units: 1,
          inconclusive_units: 1,
        })
      )
    ).toMatchObject({
      outcome: "partial",
      label: "Partial result",
    });
  });

  it("distinguishes all-inconclusive and empty calculations", () => {
    expect(
      getOccnAggregatePresentation(
        result({
          fitness: null,
          coverage: 0,
          fitting_units: 0,
          inconclusive_units: 2,
        })
      ).outcome
    ).toBe("inconclusive");

    expect(
      getOccnAggregatePresentation(
        result({
          fitness: null,
          total_units: 0,
          fitting_units: 0,
        })
      ).outcome
    ).toBe("empty");
  });
});
