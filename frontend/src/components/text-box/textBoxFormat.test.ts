import { describe, expect, it } from "vitest";

import {
  BACKGROUND_COLOR_SWATCHES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  TEXT_BOX_FORMAT_DEFAULTS,
  TEXT_COLOR_SWATCHES,
  isHexColor,
  resolveTextBoxFormat,
  textBoxContainerStyle,
  textBoxTextStyle,
} from "./textBoxFormat";

describe("isHexColor", () => {
  it("accepts #rgb and #rrggbb in either case", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#1E293B")).toBe(true);
    expect(isHexColor(" #abc ")).toBe(true);
  });

  it("rejects anything that is not a hex literal", () => {
    for (const bad of [
      "red",
      "rgb(0,0,0)",
      "#12",
      "#12345",
      "#1234567",
      "#xyzxyz",
      "transparent",
      "",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isHexColor(bad)).toBe(false);
    }
  });
});

describe("resolveTextBoxFormat", () => {
  it("returns the defaults for an empty node, so an old dashboard is unchanged", () => {
    expect(resolveTextBoxFormat({})).toEqual(TEXT_BOX_FORMAT_DEFAULTS);
    expect(resolveTextBoxFormat(undefined)).toEqual(TEXT_BOX_FORMAT_DEFAULTS);
    expect(resolveTextBoxFormat(null)).toEqual(TEXT_BOX_FORMAT_DEFAULTS);
  });

  it("keeps every valid value it is given", () => {
    const format = {
      font_size: 32,
      font_family: "serif" as const,
      font_weight: "bold" as const,
      italic: true,
      underline: true,
      text_align: "center" as const,
      vertical_align: "middle" as const,
      text_color: "#ffffff",
      background_color: "#1e293b",
      line_height: 2,
    };
    expect(resolveTextBoxFormat(format)).toEqual(format);
  });

  it("falls back to the default for an unknown choice rather than dropping it", () => {
    const resolved = resolveTextBoxFormat({
      // Values a hand-edited payload or an older client could send.
      font_family: "Comic Sans" as never,
      font_weight: "900" as never,
      text_align: "middle" as never,
      vertical_align: "centre" as never,
    });
    expect(resolved.font_family).toBe("sans");
    expect(resolved.font_weight).toBe("normal");
    expect(resolved.text_align).toBe("left");
    expect(resolved.vertical_align).toBe("top");
  });

  it("replaces a non-hex colour with the default", () => {
    const resolved = resolveTextBoxFormat({
      text_color: "red; background: url(x)" as never,
      background_color: "javascript:alert(1)" as never,
    });
    expect(resolved.text_color).toBe(TEXT_BOX_FORMAT_DEFAULTS.text_color);
    expect(resolved.background_color).toBe(TEXT_BOX_FORMAT_DEFAULTS.background_color);
  });

  it("lower-cases a stored colour so swatch comparison is stable", () => {
    expect(resolveTextBoxFormat({ text_color: "#1E293B" }).text_color).toBe("#1e293b");
  });

  it("clamps font size and line height into their bounds", () => {
    expect(resolveTextBoxFormat({ font_size: 0 }).font_size).toBe(FONT_SIZE_MIN);
    expect(resolveTextBoxFormat({ font_size: 10000 }).font_size).toBe(FONT_SIZE_MAX);
    expect(resolveTextBoxFormat({ line_height: 0 }).line_height).toBe(LINE_HEIGHT_MIN);
    expect(resolveTextBoxFormat({ line_height: 99 }).line_height).toBe(LINE_HEIGHT_MAX);
  });

  it("recovers from the non-numbers a number input can emit", () => {
    // An emptied <input type="number"> gives "", and Number("") is 0.
    expect(resolveTextBoxFormat({ font_size: NaN }).font_size).toBe(14);
    // Non-finite is nonsense input, not "very large" — the backend's
    // _validated_number agrees, so both ends land on the default.
    expect(resolveTextBoxFormat({ font_size: Infinity }).font_size).toBe(14);
    expect(resolveTextBoxFormat({ font_size: "20" as never }).font_size).toBe(20);
    expect(resolveTextBoxFormat({ font_size: "abc" as never }).font_size).toBe(14);
    expect(resolveTextBoxFormat({ line_height: NaN }).line_height).toBe(1.5);
  });

  it("rounds a fractional font size to a whole pixel, matching the int column", () => {
    expect(resolveTextBoxFormat({ font_size: 17.6 }).font_size).toBe(18);
  });

  it("coerces truthy/falsy italic and underline to real booleans", () => {
    const resolved = resolveTextBoxFormat({ italic: 1 as never, underline: 0 as never });
    expect(resolved.italic).toBe(true);
    expect(resolved.underline).toBe(false);
  });
});

describe("resolveTextBoxFormat key set", () => {
  it("always returns the complete key set, so save and load cannot drift", () => {
    expect(Object.keys(resolveTextBoxFormat({ font_size: 20 })).sort()).toEqual(
      Object.keys(TEXT_BOX_FORMAT_DEFAULTS).sort(),
    );
  });
});

describe("style builders", () => {
  it("maps vertical alignment onto flex placement", () => {
    expect(textBoxContainerStyle(resolveTextBoxFormat({ vertical_align: "top" })).justifyContent)
      .toBe("flex-start");
    expect(textBoxContainerStyle(resolveTextBoxFormat({ vertical_align: "middle" })).justifyContent)
      .toBe("center");
    expect(textBoxContainerStyle(resolveTextBoxFormat({ vertical_align: "bottom" })).justifyContent)
      .toBe("flex-end");
  });

  it("puts the background on the container, not the text", () => {
    const format = resolveTextBoxFormat({ background_color: "#fee2e2" });
    expect(textBoxContainerStyle(format).background).toBe("#fee2e2");
    expect(textBoxTextStyle(format)).not.toHaveProperty("background");
  });

  it("turns the booleans into CSS keywords, including the off state", () => {
    const on = textBoxTextStyle(resolveTextBoxFormat({ italic: true, underline: true }));
    expect(on.fontStyle).toBe("italic");
    expect(on.textDecoration).toBe("underline");

    // The off state must be explicit: the <p> inherits nothing useful.
    const off = textBoxTextStyle(resolveTextBoxFormat({}));
    expect(off.fontStyle).toBe("normal");
    expect(off.textDecoration).toBe("none");
  });

  it("resolves the font family through the design-system tokens", () => {
    expect(textBoxTextStyle(resolveTextBoxFormat({ font_family: "mono" })).fontFamily)
      .toBe("var(--font-mono)");
  });

  it("renders the untouched defaults as the pre-#373 look", () => {
    const style = textBoxTextStyle(TEXT_BOX_FORMAT_DEFAULTS);
    expect(style.fontSize).toBe(14);
    expect(style.fontWeight).toBe("normal");
    expect(style.textAlign).toBe("left");
    expect(style.color).toBe("#1e293b");
  });
});

describe("swatches", () => {
  it("are all valid hex literals the backend will store", () => {
    for (const swatch of [...TEXT_COLOR_SWATCHES, ...BACKGROUND_COLOR_SWATCHES]) {
      expect(isHexColor(swatch)).toBe(true);
      expect(swatch).toBe(swatch.toLowerCase());
    }
  });
});
