// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  OCCNReplayStatus,
  OCCNReplayUnitResult,
} from "@/api/occnConformanceApi";

import { OccnReplayUnitExplorer } from "./OccnReplayUnitExplorer";

afterEach(cleanup);

function unit(
  index: number,
  status: OCCNReplayStatus = "fitting"
): OCCNReplayUnitResult {
  return {
    unit_id: `connected_components:${index.toString().padStart(6, "0")}`,
    status,
    replayable: status === "inconclusive" ? null : status === "fitting",
    event_count: index,
    explored_state_count: index * 2,
    object_types: index % 2 === 0 ? ["Item", "Order"] : ["Order"],
    failure_event_index: status === "non_fitting" ? 0 : null,
    failure_event_id: status === "non_fitting" ? `event-${index}` : null,
    limit_reason: status === "inconclusive" ? "max_states" : null,
  };
}

describe("OccnReplayUnitExplorer", () => {
  it("renders unit summaries and selects a unit", () => {
    const onSelectUnit = vi.fn();
    const units = [unit(1), unit(2, "non_fitting"), unit(3, "inconclusive")];
    const { rerender } = render(
      <OccnReplayUnitExplorer
        units={units}
        selectedUnitId={null}
        onSelectUnit={onSelectUnit}
      />
    );

    expect(screen.getByText("Non-fitting")).toBeTruthy();
    expect(screen.getByText("Item, Order")).toBeTruthy();
    expect(screen.getByText("Showing 1-3 of 3")).toBeTruthy();

    const unitButton = screen.getByRole("button", {
      name: "connected_components:000002",
    });
    fireEvent.click(unitButton);

    expect(unitButton.getAttribute("aria-pressed")).toBe("false");
    expect(onSelectUnit).toHaveBeenCalledWith(units[1]);

    rerender(
      <OccnReplayUnitExplorer
        units={units}
        selectedUnitId={units[1].unit_id}
        onSelectUnit={onSelectUnit}
      />
    );
    expect(
      screen
        .getByRole("button", { name: "connected_components:000002" })
        .getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("paginates large result sets without rendering every unit", () => {
    const units = Array.from({ length: 53 }, (_, index) => unit(index + 1));
    render(<OccnReplayUnitExplorer units={units} />);

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("button")).toHaveLength(25);
    expect(screen.getByText("Showing 1-25 of 53")).toBeTruthy();
    expect(screen.queryByText("connected_components:000026")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Next replay-unit page" })
    );

    expect(screen.getByText("Showing 26-50 of 53")).toBeTruthy();
    expect(screen.getByText("connected_components:000026")).toBeTruthy();
    expect(screen.queryByText("connected_components:000001")).toBeNull();
  });

  it("permanently clamps the page when a result set becomes smaller", async () => {
    const largeResult = Array.from({ length: 53 }, (_, index) => unit(index + 1));
    const { rerender } = render(
      <OccnReplayUnitExplorer units={largeResult} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Next replay-unit page" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Next replay-unit page" })
    );
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();

    rerender(<OccnReplayUnitExplorer units={[unit(1)]} />);
    await waitFor(() => expect(screen.getByText("Page 1 of 1")).toBeTruthy());

    rerender(<OccnReplayUnitExplorer units={largeResult} />);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(screen.getByText("connected_components:000001")).toBeTruthy();
  });

  it("filters units by status and resets pagination", () => {
    const units = [
      ...Array.from({ length: 26 }, (_, index) => unit(index + 1)),
      unit(27, "non_fitting"),
      unit(28, "inconclusive"),
    ];
    render(<OccnReplayUnitExplorer units={units} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Next replay-unit page" })
    );
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("combobox", { name: "Filter replay units by status" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Non-fitting" }));

    expect(screen.getByText("Showing 1-1 of 1")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    expect(screen.getByText("connected_components:000027")).toBeTruthy();
    expect(screen.queryByText("connected_components:000028")).toBeNull();
  });

  it("shows an empty filtered state", () => {
    render(<OccnReplayUnitExplorer units={[unit(1)]} />);

    fireEvent.click(
      screen.getByRole("combobox", { name: "Filter replay units by status" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Inconclusive" }));

    expect(screen.getByText("No replay units match this status.")).toBeTruthy();
    expect(screen.getByText("Showing 0-0 of 0")).toBeTruthy();
  });
});
