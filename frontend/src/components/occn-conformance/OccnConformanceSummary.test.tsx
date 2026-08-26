// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { OCCNConformanceResponse } from "@/api/occnConformanceApi";

import { OccnConformanceSummary } from "./OccnConformanceSummary";

afterEach(cleanup);

function result(
  overrides: Partial<OCCNConformanceResponse> = {}
): OCCNConformanceResponse {
  return {
    file_id: 1,
    asset_id: 2,
    replay_unit_strategy: "connected_components",
    fitness: 0.5,
    coverage: 1,
    total_units: 2,
    fitting_units: 1,
    non_fitting_units: 1,
    inconclusive_units: 0,
    unit_results: [],
    ...overrides,
  };
}

function metricValue(label: string): string | null {
  const summary = screen.getByRole("region", { name: "Conformance result" });
  const term = within(summary).getByText(label);
  return term.parentElement?.querySelector("dd")?.textContent ?? null;
}

describe("OccnConformanceSummary", () => {
  it("shows fitness, coverage, and every outcome count", () => {
    render(<OccnConformanceSummary result={result()} />);

    expect(screen.getByText("Deviations found")).toBeTruthy();
    expect(metricValue("Fitness")).toBe("50%");
    expect(metricValue("Coverage")).toBe("100%");
    expect(metricValue("Replay units")).toBe("2");
    expect(metricValue("Fitting")).toBe("1");
    expect(metricValue("Non-fitting")).toBe("1");
    expect(metricValue("Inconclusive")).toBe("0");
  });

  it("presents partial coverage separately from perfect conclusive fitness", () => {
    render(
      <OccnConformanceSummary
        result={result({
          fitness: 1,
          coverage: 0.5,
          fitting_units: 1,
          non_fitting_units: 0,
          inconclusive_units: 1,
        })}
      />
    );

    expect(screen.getByText("Partial result")).toBeTruthy();
    expect(metricValue("Fitness")).toBe("100%");
    expect(metricValue("Coverage")).toBe("50%");
  });

  it("shows an all-inconclusive calculation without claiming fitness", () => {
    render(
      <OccnConformanceSummary
        result={result({
          fitness: null,
          coverage: 0,
          fitting_units: 0,
          non_fitting_units: 0,
          inconclusive_units: 2,
        })}
      />
    );

    expect(screen.getAllByText("Inconclusive")).toHaveLength(2);
    expect(metricValue("Fitness")).toBe("Not available");
    expect(metricValue("Coverage")).toBe("0%");
  });

  it("handles an event log without replay units", () => {
    render(
      <OccnConformanceSummary
        result={result({
          fitness: null,
          total_units: 0,
          fitting_units: 0,
          non_fitting_units: 0,
        })}
      />
    );

    expect(screen.getByText("No replay units")).toBeTruthy();
    expect(metricValue("Fitness")).toBe("Not available");
    expect(metricValue("Coverage")).toBe("Not applicable");
  });
});
