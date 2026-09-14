import { describe, expect, it } from "vitest";
import { tokenizeSql } from "./sqlHighlight";

describe("tokenizeSql", () => {
  it("reproduces the source exactly when tokens are concatenated", () => {
    const source =
      "SELECT e.\"Order Total\", count(*) AS n -- trailing\nFROM events e /* block */ WHERE activity = 'it''s' AND x >= 1.5e3";
    expect(tokenizeSql(source).map((t) => t.text).join("")).toBe(source);
  });

  it("classifies keywords, functions, strings, numbers, comments and identifiers", () => {
    const kinds = Object.fromEntries(
      tokenizeSql("SELECT count(*) FROM events WHERE a = 'x' AND b = 2 -- c\n\"quoted\"").map((t) => [
        t.text,
        t.kind,
      ])
    );
    expect(kinds.SELECT).toBe("keyword");
    expect(kinds.count).toBe("function");
    expect(kinds.FROM).toBe("keyword");
    expect(kinds["'x'"]).toBe("string");
    expect(kinds["2"]).toBe("number");
    expect(kinds["-- c"]).toBe("comment");
    expect(kinds['"quoted"']).toBe("identifier");
    expect(kinds.events).toBe("text");
  });

  it("treats a column named like a function as plain text", () => {
    const tokens = tokenizeSql("SELECT count FROM t");
    expect(tokens.find((t) => t.text === "count")?.kind).toBe("text");
  });

  it("survives unterminated strings and comments", () => {
    expect(tokenizeSql("SELECT 'open").map((t) => t.text).join("")).toBe("SELECT 'open");
    expect(tokenizeSql("/* open").map((t) => t.text).join("")).toBe("/* open");
  });
});
