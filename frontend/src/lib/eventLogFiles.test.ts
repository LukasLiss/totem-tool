import { describe, expect, it } from "vitest";

import {
  eventLogFileType,
  projectNameFromEventLogFilename,
} from "./eventLogFiles";

describe("projectNameFromEventLogFilename", () => {
  it("uses the filename stem without adding a username", () => {
    expect(projectNameFromEventLogFilename("ocel2-export.xml")).toBe(
      "ocel2-export_project",
    );
  });

  it("uses only the leaf name when a path is supplied", () => {
    expect(projectNameFromEventLogFilename("/tmp/order-log.json")).toBe(
      "order-log_project",
    );
  });

  it("keeps generated project names within the backend limit", () => {
    const generatedName = projectNameFromEventLogFilename(
      `${"a".repeat(150)}.json`,
    );

    expect(generatedName).toHaveLength(100);
    expect(generatedName.endsWith("_project")).toBe(true);
  });
});

describe("eventLogFileType", () => {
  it.each([
    ["orders.xml", "XML"],
    ["orders.duckdb", "DuckDB"],
    ["http://localhost/media/orders.sqlite?download=1", "SQLite"],
  ])("formats the type of %s as %s", (filename, expected) => {
    expect(eventLogFileType(filename)).toBe(expected);
  });

  it("falls back to an uppercase extension", () => {
    expect(eventLogFileType("orders.ocel")).toBe("OCEL");
  });
});
