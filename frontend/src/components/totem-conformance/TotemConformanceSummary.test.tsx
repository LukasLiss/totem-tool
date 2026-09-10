// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createConformanceResponse } from "./testFixtures";
import { TotemConformanceSummary } from "./TotemConformanceSummary";

afterEach(cleanup);

describe("TotemConformanceSummary", () => {
  it("shows all aggregate dimensions and changes the selected dimension", () => {
    const onDimensionChange = vi.fn();
    const { rerender } = render(
      <TotemConformanceSummary
        result={createConformanceResponse()}
        activeDimension="temporal"
        onDimensionChange={onDimensionChange}
      />
    );

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(
      screen.getByRole("radio", { name: /Temporal/ }).getAttribute("aria-checked")
    ).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: /Log cardinality/ }));
    expect(onDimensionChange).toHaveBeenCalledWith("log_cardinality");

    rerender(
      <TotemConformanceSummary
        result={createConformanceResponse()}
        activeDimension="log_cardinality"
        onDimensionChange={onDimensionChange}
      />
    );
    expect(
      screen
        .getByRole("radio", { name: /Log cardinality/ })
        .getAttribute("aria-checked")
    ).toBe("true");
  });
});
