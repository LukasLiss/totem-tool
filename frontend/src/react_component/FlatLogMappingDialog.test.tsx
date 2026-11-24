// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlatLogMapping, FlatLogPreview } from "@/api/fileApi";

const parseTimestamps = vi.fn();
vi.mock("@/api/fileApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/fileApi")>();
  return {
    ...actual,
    parseTimestamps: (...args: unknown[]) => parseTimestamps(...args),
    previewFlatLog: vi.fn(),
  };
});

import { FlatLogMappingDialog } from "./FlatLogMappingDialog";
import { carryOverMapping, defaultObjectType, mappingProblems, skippedRowsSummary } from "./flatLogMapping";

const PREVIEW: FlatLogPreview = {
  format: "xes",
  kind: "flat",
  delimiter: null,
  encoding: null,
  encodings: ["utf-8", "windows-1252"],
  truncated: false,
  timestamp_presets: ["yyyy-MM-dd HH:mm:ss", "dd.MM.yyyy HH:mm"],
  columns: [
    { name: "case:concept:name", suggestion: { role: "object_id", object_type: "case" }, empty: 0, distinct: 2 },
    { name: "concept:name", suggestion: { role: "activity" }, empty: 0, distinct: 2 },
    { name: "time:timestamp", suggestion: { role: "timestamp", format: "auto" }, empty: 0, distinct: 2 },
    { name: "org:resource", suggestion: { role: "resource", object_type: "resource" }, empty: 0, distinct: 2 },
  ],
  rows: [
    ["order-1", "Register order", "2024-03-01T09:00:00+01:00", "Alice"],
    ["order-1", "Ship goods", "2024-03-02T08:15:00+01:00", "Carol"],
  ],
};

function renderDialog(onConfirm = vi.fn()) {
  render(
    <FlatLogMappingDialog
      open
      file={new File(["x"], "orders.xes")}
      preview={PREVIEW}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

beforeEach(() => {
  vi.useFakeTimers();
  parseTimestamps.mockImplementation(async (values: string[]) => ({
    format: "iso",
    results: values.map(() => "2024-03-01T09:00:00+01:00"),
    ambiguous_with: [],
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  parseTimestamps.mockReset();
});

describe("mappingProblems", () => {
  it("asks for an object id, an activity and one timestamp", () => {
    const texts = mappingProblems([{ column: "a", role: "event_attribute" }]).map((p) => p.text);
    expect(texts.join(" ")).toMatch(/Object ID/);
    expect(texts.join(" ")).toMatch(/Activity/);
    expect(texts.join(" ")).toMatch(/Timestamp/);
  });

  it("is happy with a complete mapping", () => {
    expect(
      mappingProblems([
        { column: "c", role: "object_id", object_type: "case" },
        { column: "a", role: "activity" },
        { column: "t", role: "timestamp", format: "auto" },
      ]),
    ).toEqual([]);
  });

  it("names object types after the column", () => {
    expect(defaultObjectType("Order ID", "object_id")).toBe("Order");
    expect(defaultObjectType("case:concept:name", "object_id")).toBe("case");
    expect(defaultObjectType("Performer", "resource")).toBe("resource");
  });
});

describe("carryOverMapping", () => {
  it("keeps the user's roles for columns that are still there", () => {
    const previous = [
      { column: "Ticket", role: "object_id" as const, object_type: "ticket" },
      { column: "When", role: "timestamp" as const, format: "dd.MM.yyyy" },
      { column: "Gr��e", role: "event_attribute" as const },
    ];
    const suggested = [
      { column: "Ticket", role: "event_attribute" as const },
      { column: "When", role: "event_attribute" as const },
      { column: "Größe", role: "event_attribute" as const },
      { column: "Updated", role: "timestamp" as const, format: "auto" },
    ];
    expect(carryOverMapping(previous, suggested)).toEqual([
      { column: "Ticket", role: "object_id", object_type: "ticket" },
      { column: "When", role: "timestamp", format: "dd.MM.yyyy" },
      { column: "Größe", role: "event_attribute" },
      // Only one timestamp: the user's choice wins over a new suggestion.
      { column: "Updated", role: "event_attribute", format: "auto" },
    ]);
  });
});

describe("skippedRowsSummary", () => {
  const base = {
    rows: 10, events: 10, skipped_no_activity: 0, skipped_no_object: 0, skipped_bad_timestamp: 0,
    bad_timestamp_example: null, timestamp_format: "dd.MM.yyyy HH:mm", timezone: "UTC",
  };

  it("says nothing when every row was imported", () => {
    expect(skippedRowsSummary(base)).toBeNull();
    expect(skippedRowsSummary(undefined)).toBeNull();
  });

  it("mentions columns stored under another name", () => {
    const summary = skippedRowsSummary({ ...base, renamed_attributes: { Activity: "Activity_attr" } });
    expect(summary?.title).toBe("Imported 10 events");
    expect(summary?.skipped).toBe(0);
    expect(summary?.lines).toEqual(["Column “Activity” is stored as “Activity_attr” (the name was taken)"]);
  });

  it("names each reason, with a timestamp that did not match", () => {
    const summary = skippedRowsSummary({
      ...base, events: 7, skipped_bad_timestamp: 2, skipped_no_object: 1, bad_timestamp_example: "2024-03-05",
    });
    expect(summary?.title).toBe("Imported 7 events; skipped 3 rows of 10");
    expect(summary?.lines).toEqual([
      "2 rows with a timestamp that does not match “dd.MM.yyyy HH:mm” (e.g. “2024-03-05”)",
      "1 row without an object (case) id",
    ]);
  });
});

describe("FlatLogMappingDialog", () => {
  it("shows the sample with the suggested roles and imports them", async () => {
    const onConfirm = renderDialog();
    expect(screen.getByText("Register order")).toBeTruthy();
    expect(screen.getAllByText(/Object ID \(case\): case/).length).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByTestId("timestamp-check").textContent).toMatch(/All 2 sample values parse/);

    fireEvent.click(screen.getByTestId("start-import"));
    const mapping = onConfirm.mock.calls[0][0] as FlatLogMapping;
    expect(mapping.columns).toEqual([
      { column: "case:concept:name", role: "object_id", object_type: "case" },
      { column: "concept:name", role: "activity" },
      { column: "time:timestamp", role: "timestamp", format: "auto", timezone: "UTC" },
      { column: "org:resource", role: "resource", object_type: "resource" },
    ]);
  });

  it("checks and submits the chosen time zone", async () => {
    const onConfirm = renderDialog();
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Europe/Berlin" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(parseTimestamps).toHaveBeenLastCalledWith(expect.any(Array), "auto", "Europe/Berlin");
    fireEvent.click(screen.getByTestId("start-import"));
    const mapping = onConfirm.mock.calls[0][0] as FlatLogMapping;
    expect(mapping.columns.find((c) => c.role === "timestamp")?.timezone).toBe("Europe/Berlin");
  });

  it("blocks the import for a time zone the backend does not know", async () => {
    parseTimestamps.mockRejectedValue({ response: { data: { error: "Unknown time zone 'Nowhere/Land'." } } });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Nowhere/Land" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect((screen.getByTestId("start-import") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("mapping-problems").textContent).toMatch(/Unknown time zone/);
  });

  it("blocks the import until an object id column is chosen again", async () => {
    const onConfirm = renderDialog();
    // Select the case column and ignore it.
    fireEvent.click(screen.getAllByText("case:concept:name")[0]);
    fireEvent.click(screen.getByRole("radio", { name: "Ignore" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    const start = screen.getByTestId("start-import") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByTestId("mapping-problems").textContent).toMatch(/Object ID/);

    fireEvent.click(screen.getByRole("radio", { name: "Object ID (case)" }));
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("warns when the sample also fits the swapped day/month order, and switches on request", async () => {
    parseTimestamps.mockImplementation(async (values: string[]) => ({
      format: "dd/MM/yyyy HH:mm:ss",
      results: values.map(() => "2024-04-03T10:00:00+00:00"),
      ambiguous_with: [{
        format: "MM/dd/yyyy HH:mm:ss",
        value: "03/04/2024 10:00:00",
        as_chosen: "2024-04-03T10:00:00+00:00",
        as_other: "2024-03-04T10:00:00+00:00",
      }],
    }));
    const onConfirm = renderDialog();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByTestId("timestamp-ambiguous").textContent).toMatch(/Also fits MM\/dd\/yyyy/);
    expect(screen.getByTestId("mapping-problems").textContent).toMatch(/check that “03\/04\/2024 10:00:00” means/);
    // A warning, not a blocker.
    expect((screen.getByTestId("start-import") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Use that instead" }));
    fireEvent.click(screen.getByTestId("start-import"));
    const mapping = onConfirm.mock.calls[0][0] as FlatLogMapping;
    expect(mapping.columns.find((c) => c.role === "timestamp")?.format).toBe("MM/dd/yyyy HH:mm:ss");
  });

  it("refuses a timestamp format none of the sample matches", async () => {
    parseTimestamps.mockImplementation(async (values: string[]) => ({
      format: "iso",
      results: values.map(() => null),
      ambiguous_with: [],
    }));
    renderDialog();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect((screen.getByTestId("start-import") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("mapping-problems").textContent).toMatch(/No sample timestamp matches/);
  });
});
