// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolChip, type ToolExecution } from "../ToolChip";
import { formatToolDuration } from "../chatFormat";

afterEach(cleanup);

const failed: ToolExecution = {
  id: "t1",
  name: "get_log_overview",
  summary: "Looking up the log",
  status: "failed",
  error: "No event log selected",
  durationMs: 2345,
};

describe("ToolChip", () => {
  it("shows the summary collapsed and reveals name, duration and error on click", () => {
    render(<ToolChip tool={failed} />);
    const toggle = screen.getByRole("button", { name: /Looking up the log/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("tool-chip-details")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const details = screen.getByTestId("tool-chip-details");
    expect(details.textContent).toContain("get_log_overview");
    expect(details.textContent).toContain("2.3 s");
    expect(details.textContent).toContain("No event log selected");
    expect(details.textContent).toContain("Failed");

    fireEvent.click(toggle);
    expect(screen.queryByTestId("tool-chip-details")).toBeNull();
  });

  it("shows what the tool returned when a preview is present", () => {
    render(<ToolChip tool={{ id: "t2", name: "get_log_overview", summary: "Reading log overview", status: "completed", preview: "events 35,372, objects 13,882" }} defaultExpanded />);
    expect(screen.getByTestId("tool-chip-details").textContent).toContain("Resultevents 35,372, objects 13,882");
  });

  it("omits duration and error rows when they are not known yet", () => {
    render(<ToolChip tool={{ id: "t2", name: "find_variants", summary: "", status: "executing" }} defaultExpanded />);
    // Falls back to the tool name when there is no summary.
    expect(screen.getByRole("button").textContent).toContain("find_variants");
    const details = screen.getByTestId("tool-chip-details");
    expect(details.textContent).toContain("Running");
    expect(details.textContent).not.toContain("Duration");
    expect(details.textContent).not.toContain("Error");
  });

  it("formats durations in ms below a second and seconds above", () => {
    expect(formatToolDuration(12.4)).toBe("12 ms");
    expect(formatToolDuration(999)).toBe("999 ms");
    expect(formatToolDuration(1500)).toBe("1.5 s");
  });
});
