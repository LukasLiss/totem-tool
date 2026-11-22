// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("switches relation direction and renders the distribution table", () => {
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
    const table = screen.getByRole("table", { name: "Distribution table" });
    expect(within(table).getByText("contains")).toBeTruthy();
    expect(within(table).getByText("Sum")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Item to Order" }));
    expect(screen.getByText("0.62")).toBeTruthy();
    // No relation-type breakdown in this direction: the pair histogram is
    // the only row, without a sum.
    const reverseTable = screen.getByRole("table", { name: "Distribution table" });
    expect(within(reverseTable).getByText("All")).toBeTruthy();
    expect(within(reverseTable).queryByText("Sum")).toBeNull();
    expect(within(reverseTable).getByText("D-i")).toBeTruthy();

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
    expect(screen.getByRole("columnheader", { name: "Activity" })).toBeTruthy();
    expect(screen.getByText("Pick Item")).toBeTruthy();
  });

  it("shows relation types as rows with a sum, as percentages or counts", () => {
    const result = createConformanceResponse();
    result.histograms.temporal_by_relation_type.push({
      source_type: "Order",
      target_type: "Item",
      relation_type: "references",
      counts: { total: 15, D: 3, Ii: 12, P: 15 },
    });
    render(
      <TotemConformanceDetails
        result={result}
        lookup={createTotemConformanceLookup(result)}
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

    const table = screen.getByRole("table", { name: "Distribution table" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual(["Relation type", "Total", "D", "D-i", "I", "I-i", "P"]);

    const cells = (label: string) =>
      Array.from(
        within(table).getByRole("rowheader", { name: label }).closest("tr")!
          .querySelectorAll("td")
      ).map((cell) => cell.textContent);
    expect(cells("contains")).toEqual(["5", "80%", "0%", "20%", "0%", "0%"]);
    expect(cells("references")).toEqual(["15", "20%", "0%", "0%", "80%", "100%"]);
    expect(cells("Sum")).toEqual(["20", "35%", "0%", "5%", "60%", "75%"]);

    fireEvent.click(screen.getByRole("button", { name: "Show absolute counts" }));
    expect(cells("contains")).toEqual(["5", "4", "0", "1", "0", "0"]);
    expect(cells("Sum")).toEqual(["20", "7", "0", "1", "12", "15"]);
  });

  it("shows the distribution of the metric row the user clicks", () => {
    const result = createConformanceResponse();
    const lookup = createTotemConformanceLookup(result);
    const selection = {
      kind: "relation" as const,
      relationId: '["Order","Item"]',
      source: "Order",
      target: "Item",
    };
    const { rerender } = render(
      <TotemConformanceDetails
        result={result}
        lookup={lookup}
        selection={selection}
        activeDimension="temporal"
        onClearSelection={vi.fn()}
      />
    );
    expect(screen.getByText("Temporal by relation type")).toBeTruthy();

    fireEvent.click(screen.getByText("Event card."));
    expect(screen.getByText("Event cardinality by activity")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Activity" })).toBeTruthy();
    expect(
      screen.getByText("Event card.").closest("tr")?.getAttribute("aria-selected")
    ).toBe("true");

    fireEvent.keyDown(screen.getByText("Log card.").closest("tr")!, {
      key: "Enter",
    });
    expect(screen.getByText("Log cardinality by relation type")).toBeTruthy();

    // Changing the dimension above the canvas still carries over.
    rerender(
      <TotemConformanceDetails
        result={result}
        lookup={lookup}
        selection={selection}
        activeDimension="event_cardinality"
        onClearSelection={vi.fn()}
      />
    );
    expect(screen.getByText("Event cardinality by activity")).toBeTruthy();
  });
});
