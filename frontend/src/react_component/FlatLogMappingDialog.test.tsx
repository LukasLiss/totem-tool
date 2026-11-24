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
import { defaultObjectType, mappingProblems } from "./flatLogMapping";

const PREVIEW: FlatLogPreview = {
  format: "xes",
  kind: "flat",
  delimiter: null,
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
  parseTimestamps.mockImplementation(async (values: string[]) => values.map(() => "2024-03-01T09:00:00+01:00"));
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
      { column: "time:timestamp", role: "timestamp", format: "auto" },
      { column: "org:resource", role: "resource", object_type: "resource" },
    ]);
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

  it("refuses a timestamp format none of the sample matches", async () => {
    parseTimestamps.mockImplementation(async (values: string[]) => values.map(() => null));
    renderDialog();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect((screen.getByTestId("start-import") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("mapping-problems").textContent).toMatch(/No sample timestamp matches/);
  });
});
