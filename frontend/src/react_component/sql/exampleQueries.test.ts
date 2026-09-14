import { describe, expect, it } from "vitest";
import {
  EXAMPLE_GROUPS,
  EXAMPLE_QUERIES,
  collectParams,
  exampleById,
  missingPlaceholders,
  renderExampleSql,
  withDependencies,
} from "./exampleQueries";

describe("example query library", () => {
  it("has unique ids and names and only known groups", () => {
    const ids = new Set(EXAMPLE_QUERIES.map((q) => q.id));
    const names = new Set(EXAMPLE_QUERIES.map((q) => q.name));
    expect(ids.size).toBe(EXAMPLE_QUERIES.length);
    expect(names.size).toBe(EXAMPLE_QUERIES.length);
    for (const q of EXAMPLE_QUERIES) {
      expect(EXAMPLE_GROUPS).toContain(q.group);
    }
  });

  it("references dependencies by their exact name and declares every placeholder", () => {
    for (const q of EXAMPLE_QUERIES) {
      for (const depId of q.dependsOn ?? []) {
        const dep = exampleById(depId);
        expect(dep, `${q.id} depends on unknown ${depId}`).toBeDefined();
        expect(q.sql).toContain(`"${dep!.name}"`);
      }
      const declared = new Set(collectParams(q).map((p) => p.key));
      for (const key of missingPlaceholders(q.sql)) {
        expect(declared, `${q.id} uses undeclared {{${key}}}`).toContain(key);
      }
    }
  });

  it("orders dependencies first and collects their params", () => {
    const profile = exampleById("variant_object_profile")!;
    expect(withDependencies(profile).map((q) => q.id)).toEqual([
      "variant_objects_per_type",
      "variant_object_profile",
    ]);
    expect(collectParams(profile).map((p) => p.key)).toEqual([
      "variant_column",
      "execution_column",
    ]);
  });

  it("renders placeholders as quoted identifiers", () => {
    const sql = renderExampleSql("SELECT {{ col }} FROM events WHERE {{col}} IS NOT NULL", {
      col: "process execution",
    });
    expect(sql).toBe('SELECT "process execution" FROM events WHERE "process execution" IS NOT NULL');
    expect(missingPlaceholders(sql)).toEqual([]);
    expect(missingPlaceholders("SELECT {{a}}, {{b}}")).toEqual(["a", "b"]);
  });
});
