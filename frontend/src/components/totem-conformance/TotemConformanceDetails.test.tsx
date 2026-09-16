// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTotemConformanceLookup } from "./conformanceLookup";
import { createConformanceResponse } from "./testFixtures";
import { TotemConformanceDetails } from "./TotemConformanceDetails";

afterEach(cleanup);

describe("TotemConformanceDetails", () => {
  it("shows object-type averages for all dimensions", () => {
    const result = createConformanceResponse();
    render(
      <TotemConformanceDetails
        result={result}
        lookup={createTotemConformanceLookup(result)}
        selection={{ kind: "objectType", objectType: "Order" }}
        activeDimension="temporal"
        onClearSelection={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Order" })).toBeTruthy();
    expect(screen.getByText("0.82")).toBeTruthy();
    expect(screen.getByText("0.74")).toBeTruthy();
    expect(screen.getByText("0.93")).toBeTruthy();
  });

  it("switches relation direction and renders aggregate and detailed histograms", () => {
    const result = createConformanceResponse();
    const lookup = createTotemConformanceLookup(result);
    const { rerender } = render(
      <TotemConformanceDetails
        result={result}
        lookup={lookup}
        selection={{
          kind: "relation",
          relationId: '["Order","Item"]',
          source: "Order",
          target: "Item",
        }}
        activeDimension="temporal"
        onClearSelection={vi.fn()}
      />
    );

    expect(screen.getByText("0.92")).toBeTruthy();
    expect(screen.getAllByLabelText("Histogram").length).toBeGreaterThan(0);
    expect(screen.getByText("contains")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Item to Order" }));
    expect(screen.getByText("0.62")).toBeTruthy();
    expect(screen.getByText("Di")).toBeTruthy();

    rerender(
      <TotemConformanceDetails
        result={result}
        lookup={lookup}
        selection={{
          kind: "relation",
          relationId: '["Order","Item"]',
          source: "Order",
          target: "Item",
        }}
        activeDimension="event_cardinality"
        onClearSelection={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Order to Item" }));
    expect(screen.getByLabelText("Activity")).toBeTruthy();
    expect(screen.getByText("Pick Item")).toBeTruthy();
  });
});
