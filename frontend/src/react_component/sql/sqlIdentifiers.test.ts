import { describe, expect, it } from "vitest";
import {
  aliasForTable,
  columnReference,
  quoteIdentifier,
  quoteIdentifierIfNeeded,
} from "./sqlIdentifiers";

describe("quoteIdentifier", () => {
  it("wraps names in double quotes", () => {
    expect(quoteIdentifier("activity")).toBe('"activity"');
    expect(quoteIdentifier("Order Total")).toBe('"Order Total"');
  });

  it("escapes embedded double quotes", () => {
    expect(quoteIdentifier('say "hi"')).toBe('"say ""hi"""');
  });

  it("quoteIdentifierIfNeeded leaves plain identifiers alone", () => {
    expect(quoteIdentifierIfNeeded("events")).toBe("events");
    expect(quoteIdentifierIfNeeded("e1")).toBe("e1");
    expect(quoteIdentifierIfNeeded("Order Total")).toBe('"Order Total"');
    expect(quoteIdentifierIfNeeded("1abc")).toBe('"1abc"');
  });
});

describe("aliasForTable", () => {
  it("returns the alias when one is declared", () => {
    expect(aliasForTable("SELECT * FROM events e", "events")).toBe("e");
    expect(aliasForTable("SELECT * FROM events AS ev JOIN objects o ON 1", "objects")).toBe("o");
  });

  it("returns the table name when referenced without an alias", () => {
    expect(aliasForTable("SELECT * FROM events WHERE 1", "events")).toBe("events");
    expect(aliasForTable('SELECT * FROM "events"', "events")).toBe("events");
  });

  it("does not mistake a clause keyword for an alias", () => {
    expect(aliasForTable("SELECT * FROM events WHERE x", "events")).toBe("events");
    expect(aliasForTable("SELECT * FROM events ORDER BY x", "events")).toBe("events");
  });

  it("returns null for tables the query does not reference", () => {
    expect(aliasForTable("SELECT * FROM events", "objects")).toBeNull();
  });
});

describe("columnReference", () => {
  it("quotes the column and prefixes the alias", () => {
    expect(columnReference("SELECT * FROM events e", "events", "activity")).toBe('e."activity"');
    expect(columnReference("SELECT * FROM events", "events", "Order Total")).toBe(
      'events."Order Total"'
    );
  });

  it("falls back to the bare quoted column when the table is not referenced", () => {
    expect(columnReference("SELECT 1", "events", "activity")).toBe('"activity"');
  });
});
