import { describe, expect, it } from "vitest";
import { colorsFromLogTypes, mapTypesToColors } from "./objectColors";

const LOG = ["customers", "items", "orders", "packages"];

describe("colorsFromLogTypes", () => {
  it("gives a view showing all types exactly the colors it had before", () => {
    expect(colorsFromLogTypes(LOG, LOG)).toEqual(mapTypesToColors(LOG));
  });

  it("keeps a type's color when a filter or view hides other types", () => {
    const all = colorsFromLogTypes(LOG, LOG);
    const filtered = colorsFromLogTypes(["orders", "packages"], LOG);
    expect(filtered).toEqual({ orders: all.orders, packages: all.packages });
    // The old way shifted them.
    expect(mapTypesToColors(["orders", "packages"]).orders).not.toBe(all.orders);
  });

  it("returns only the requested types, for legends", () => {
    expect(Object.keys(colorsFromLogTypes(["items"], LOG))).toEqual(["items"]);
  });

  it("puts types missing from the log's list after the known ones, without shifting them", () => {
    const all = colorsFromLogTypes(LOG, LOG);
    const colors = colorsFromLogTypes(["aaa-unknown", "orders"], LOG);
    expect(colors.orders).toBe(all.orders);
    expect(colors["aaa-unknown"]).toBe(mapTypesToColors([...LOG, "zzz"]).zzz);
  });

  it("falls back to the shown types without the log's list", () => {
    expect(colorsFromLogTypes(["orders", "items"], null)).toEqual(mapTypesToColors(["orders", "items"]));
  });

  it("lets overrides win", () => {
    expect(colorsFromLogTypes(["orders"], LOG, { orders: "#000000" })).toEqual({ orders: "#000000" });
  });
});
