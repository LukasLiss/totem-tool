import { describe, expect, it } from "vitest";

import {
  TEXT_LEVEL_FORMAT_KEYS,
  conversionPatch,
  docForWidget,
  docFromPlainText,
  isDocEmpty,
  isRichTextDoc,
  plainTextFromDoc,
  styleFromBlockAttrs,
  styleFromMarks,
  type RichTextDoc,
} from "./richText";
import { FONT_FAMILY_STACKS, TEXT_BOX_FORMAT_DEFAULTS, resolveTextBoxFormat } from "./textBoxFormat";

const docOf = (...content: unknown[]) => ({ type: "doc", content }) as RichTextDoc;
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const run = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });

describe("isRichTextDoc", () => {
  it("accepts a document and rejects everything else", () => {
    expect(isRichTextDoc(docOf(para(run("x"))))).toBe(true);
    for (const bad of [null, undefined, "", 42, [], {}, { type: "doc" }, { type: "paragraph", content: [] }]) {
      expect(isRichTextDoc(bad)).toBe(false);
    }
  });
});

describe("plainTextFromDoc", () => {
  it("gives one line per block", () => {
    const doc = docOf(para(run("first "), run("line")), para(run("second")));
    expect(plainTextFromDoc(doc)).toBe("first line\nsecond");
  });

  it("keeps an empty paragraph as an empty line", () => {
    expect(plainTextFromDoc(docOf(para(run("a")), { type: "paragraph" }, para(run("b")))))
      .toBe("a\n\nb");
  });

  it("walks into nested blocks such as list items", () => {
    const doc = docOf({
      type: "bulletList",
      content: [{ type: "listItem", content: [para(run("point"))] }],
    });
    expect(plainTextFromDoc(doc)).toBe("point");
  });

  it("returns an empty string for anything that is not a document", () => {
    expect(plainTextFromDoc(null)).toBe("");
    expect(plainTextFromDoc("nope")).toBe("");
  });
});

describe("docFromPlainText", () => {
  it("makes one paragraph per line", () => {
    const doc = docFromPlainText("one\ntwo");
    expect(doc.content).toHaveLength(2);
    expect(plainTextFromDoc(doc)).toBe("one\ntwo");
  });

  it("leaves an empty line with no content array at all", () => {
    // A paragraph holding an empty text node is invalid in ProseMirror and
    // throws on load.
    const doc = docFromPlainText("a\n\nb");
    expect(doc.content[1]).toEqual({ type: "paragraph" });
  });

  it("round-trips through plain text", () => {
    const text = "line one\n\nline three";
    expect(plainTextFromDoc(docFromPlainText(text))).toBe(text);
  });

  it("bakes the box's formatting into marks, so a converted box looks the same", () => {
    const format = resolveTextBoxFormat({
      font_weight: "bold",
      italic: true,
      underline: true,
      text_color: "#f43f5e",
      font_size: 24,
      font_family: "serif",
      text_align: "center",
      line_height: 2,
    });
    const doc = docFromPlainText("styled", format);
    const marks = (doc.content[0].content ?? [])[0].marks ?? [];
    const types = marks.map((m) => m.type);
    expect(types).toContain("bold");
    expect(types).toContain("italic");
    expect(types).toContain("underline");
    const textStyle = marks.find((m) => m.type === "textStyle");
    expect(textStyle).toEqual({
      type: "textStyle",
      attrs: {
        color: "#f43f5e",
        fontSize: "24px",
        fontFamily: FONT_FAMILY_STACKS.serif,
      },
    });
    expect(doc.content[0].attrs).toEqual({ textAlign: "center", lineHeight: "2" });
  });

  it("bakes nothing for a box that is already at the defaults", () => {
    const doc = docFromPlainText("plain", TEXT_BOX_FORMAT_DEFAULTS);
    expect((doc.content[0].content ?? [])[0].marks).toBeUndefined();
  });
});

describe("docForWidget", () => {
  it("prefers a stored document", () => {
    const stored = docOf(para(run("stored")));
    expect(docForWidget(stored, "ignored")).toBe(stored);
  });

  it("falls back to the plain text for a box with no document", () => {
    expect(plainTextFromDoc(docForWidget(null, "fallback"))).toBe("fallback");
    expect(plainTextFromDoc(docForWidget({ type: "doc", content: [] }, "fallback")))
      .toBe("fallback");
  });
});

describe("conversionPatch", () => {
  it("stores the document and hands the text-level fields back to their defaults", () => {
    // Otherwise the container's base style keeps applying underneath and a
    // user could never un-bold a run of a converted box.
    const doc = docOf(para(run("x")));
    const patch = conversionPatch(doc);
    expect(patch.rich_text).toBe(doc);
    for (const key of TEXT_LEVEL_FORMAT_KEYS) {
      expect(patch[key], key).toEqual(TEXT_BOX_FORMAT_DEFAULTS[key]);
    }
  });

  it("leaves the genuinely box-level settings alone", () => {
    const patch = conversionPatch(docOf(para(run("x"))));
    expect(patch).not.toHaveProperty("background_color");
    expect(patch).not.toHaveProperty("vertical_align");
  });
});

describe("styleFromMarks", () => {
  it("maps each mark onto CSS", () => {
    expect(styleFromMarks([{ type: "bold" }]).fontWeight).toBe("bold");
    expect(styleFromMarks([{ type: "italic" }]).fontStyle).toBe("italic");
    expect(styleFromMarks([{ type: "underline" }]).textDecoration).toBe("underline");
  });

  it("combines underline and strike rather than letting one win", () => {
    expect(styleFromMarks([{ type: "underline" }, { type: "strike" }]).textDecoration)
      .toBe("underline line-through");
    expect(styleFromMarks([{ type: "strike" }, { type: "underline" }]).textDecoration)
      .toBe("underline line-through");
  });

  it("takes colour, size and font from textStyle", () => {
    const style = styleFromMarks([
      { type: "textStyle", attrs: { color: "#fff", fontSize: "20px", fontFamily: FONT_FAMILY_STACKS.mono } },
    ]);
    expect(style.color).toBe("#fff");
    expect(style.fontSize).toBe("20px");
    expect(style.fontFamily).toBe(FONT_FAMILY_STACKS.mono);
  });

  it("ignores a font family that is not one of the design-system tokens", () => {
    const style = styleFromMarks([{ type: "textStyle", attrs: { fontFamily: "Comic Sans" } }]);
    expect(style.fontFamily).toBeUndefined();
  });

  it("is empty for no marks", () => {
    expect(styleFromMarks(undefined)).toEqual({});
    expect(styleFromMarks([])).toEqual({});
  });
});

describe("styleFromBlockAttrs", () => {
  it("maps alignment and line height", () => {
    expect(styleFromBlockAttrs({ textAlign: "center" }).textAlign).toBe("center");
    expect(styleFromBlockAttrs({ lineHeight: "2" }).lineHeight).toBe(2);
  });

  it("ignores a line height that is not a number", () => {
    expect(styleFromBlockAttrs({ lineHeight: "tall" }).lineHeight).toBeUndefined();
    expect(styleFromBlockAttrs(undefined)).toEqual({});
  });
});

describe("isDocEmpty", () => {
  it("is true for nothing, and for whitespace only", () => {
    expect(isDocEmpty(null)).toBe(true);
    expect(isDocEmpty(docOf())).toBe(true);
    expect(isDocEmpty(docOf(para(run("   "))))).toBe(true);
    expect(isDocEmpty(docOf(para(run("x"))))).toBe(false);
  });
});
