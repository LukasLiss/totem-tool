// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { TEXT_BOX_EXTENSIONS } from "./textBoxExtensions";
import { FONT_FAMILY_STACKS } from "./textBoxFormat";
import type { RichTextDoc, RichTextNode } from "./richText";

/**
 * The point of the whole feature: a command must change the *selection*, not
 * the whole box. These drive the exact extension set the widget ships, so a
 * config change that broke per-selection marks would fail here.
 */
let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(text: string) {
  editor = new Editor({
    extensions: TEXT_BOX_EXTENSIONS,
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  });
  return editor;
}

/** The runs of the first paragraph, as [text, mark types]. */
function runs(doc: RichTextDoc, paragraph = 0): Array<[string, string[]]> {
  const block = doc.content[paragraph];
  return (block.content ?? []).map((run: RichTextNode) => [
    run.text ?? "",
    (run.marks ?? []).map((m) => m.type),
  ]);
}

describe("formatting a selection", () => {
  it("bolds only the selected characters", () => {
    const e = makeEditor("hello world");
    // ProseMirror positions are 1-based; "hello" is 1..6.
    e.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();

    expect(runs(e.getJSON() as RichTextDoc)).toEqual([
      ["hello", ["bold"]],
      [" world", []],
    ]);
  });

  it("leaves the rest of the text untouched when colouring a selection", () => {
    const e = makeEditor("red and plain");
    e.chain().setTextSelection({ from: 1, to: 4 }).setColor("#f43f5e").run();

    const [coloured, rest] = runs(e.getJSON() as RichTextDoc);
    expect(coloured[0]).toBe("red");
    expect(coloured[1]).toEqual(["textStyle"]);
    expect(rest[0]).toBe(" and plain");
    expect(rest[1]).toEqual([]);
  });

  it("stacks several marks on one selection without disturbing its neighbours", () => {
    const e = makeEditor("one two three");
    e.chain()
      .setTextSelection({ from: 5, to: 8 }) // "two"
      .toggleBold()
      .toggleItalic()
      .setFontSize("32px")
      .run();

    const result = runs(e.getJSON() as RichTextDoc);
    expect(result[0]).toEqual(["one ", []]);
    expect(result[1][0]).toBe("two");
    expect(result[1][1].sort()).toEqual(["bold", "italic", "textStyle"]);
    expect(result[2]).toEqual([" three", []]);
  });

  it("un-bolds just the re-selected part of a bold run", () => {
    const e = makeEditor("all bold here");
    e.chain().setTextSelection({ from: 1, to: 14 }).toggleBold().run();
    e.chain().setTextSelection({ from: 1, to: 4 }).toggleBold().run();

    const result = runs(e.getJSON() as RichTextDoc);
    expect(result[0]).toEqual(["all", []]);
    expect(result[1]).toEqual([" bold here", ["bold"]]);
  });

  it("applies a different font to a selection", () => {
    const e = makeEditor("mono bit");
    e.chain().setTextSelection({ from: 1, to: 5 }).setFontFamily(FONT_FAMILY_STACKS.mono).run();

    const doc = e.getJSON() as RichTextDoc;
    const mark = (doc.content[0].content ?? [])[0].marks?.[0];
    expect(mark).toEqual({
      type: "textStyle",
      attrs: { color: null, fontFamily: FONT_FAMILY_STACKS.mono, fontSize: null },
    });
  });
});

describe("formatting a paragraph", () => {
  it("aligns only the paragraph the cursor is in", () => {
    editor = new Editor({
      extensions: TEXT_BOX_EXTENSIONS,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "first" }] },
          { type: "paragraph", content: [{ type: "text", text: "second" }] },
        ],
      },
    });
    // Put the caret inside the second paragraph and centre it.
    editor.chain().setTextSelection(9).setTextAlign("center").run();

    const doc = editor.getJSON() as RichTextDoc;
    expect(doc.content[0].attrs?.textAlign ?? null).toBeNull();
    expect(doc.content[1].attrs?.textAlign).toBe("center");
  });

  it("gives three lines three different formats, which is what was asked for", () => {
    editor = new Editor({
      extensions: TEXT_BOX_EXTENSIONS,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "bold line" }] },
          { type: "paragraph", content: [{ type: "text", text: "italic line" }] },
          { type: "paragraph", content: [{ type: "text", text: "centred line" }] },
        ],
      },
    });
    editor.chain().setTextSelection({ from: 1, to: 10 }).toggleBold().run();
    editor.chain().setTextSelection({ from: 12, to: 23 }).toggleItalic().run();
    editor.chain().setTextSelection(26).setTextAlign("center").run();

    const doc = editor.getJSON() as RichTextDoc;
    expect(runs(doc, 0)).toEqual([["bold line", ["bold"]]]);
    expect(runs(doc, 1)).toEqual([["italic line", ["italic"]]]);
    expect(runs(doc, 2)).toEqual([["centred line", []]]);
    expect(doc.content[2].attrs?.textAlign).toBe("center");
    // ...and the first two lines kept their own alignment, i.e. none.
    expect(doc.content[0].attrs?.textAlign ?? null).toBeNull();
    expect(doc.content[1].attrs?.textAlign ?? null).toBeNull();
  });
});

describe("the shipped extension set", () => {
  it("has a link mark, so the toolbar can attach a URL", () => {
    const e = makeEditor("text");
    expect(e.schema.marks.link).toBeDefined();
    expect(e.schema.marks.dashboardLink).toBeDefined();
  });

  it("supports the marks the toolbar offers", () => {
    const e = makeEditor("text");
    for (const mark of ["bold", "italic", "underline", "textStyle", "link", "dashboardLink"]) {
      expect(e.schema.marks[mark], mark).toBeDefined();
    }
  });
});

describe("linking a selection", () => {
  /** Select "world" in "hello world". */
  function selectWorld(e: Editor) {
    e.chain().setTextSelection({ from: 7, to: 12 }).run();
    return e;
  }

  it("links only the selected characters", () => {
    const e = selectWorld(makeEditor("hello world"));
    e.chain().setLink({ href: "https://example.com" }).run();

    expect(runs(e.getJSON() as RichTextDoc)).toEqual([
      ["hello ", []],
      ["world", ["link"]],
    ]);
  });

  it("keeps a mailto address", () => {
    const e = selectWorld(makeEditor("hello world"));
    e.chain().setLink({ href: "mailto:someone@example.com" }).run();

    const run = (e.getJSON() as RichTextDoc).content[0].content![1];
    expect(run.marks![0].attrs!.href).toBe("mailto:someone@example.com");
  });

  // Tiptap's link mark carries target/rel/class/title in the document JSON,
  // not just in the HTML it renders. None of them are ever stored: the
  // backend whitelist keeps `href` alone, and the renderer sets target and
  // rel itself, so a value smuggled into the document cannot override what
  // the renderer decided. See `_clean_marks` in api/rich_text.py.
  it("carries editor-side attributes the backend is expected to drop", () => {
    const e = selectWorld(makeEditor("hello world"));
    e.chain().setLink({ href: "https://example.com" }).run();

    const attrs = (e.getJSON() as RichTextDoc).content[0].content![1].marks![0].attrs!;
    expect(attrs.href).toBe("https://example.com");
    expect(Object.keys(attrs).sort()).toContain("target");
  });

  // These are the tests that prove `isAllowedUri` is actually wired into the
  // shipped extension set. Without them the configuration could be narrowed
  // back to a `protocols` list -- which reads like a restriction and enforces
  // nothing -- and every other test here would still pass.
  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["javascript:alert(1)//https://example.com"],
    ["//evil.com/path"],
    ["data:text/html,<script>alert(1)</script>"],
    ["mailto:a@b.com?cc=victim@evil.com"],
    ["ftp://example.com/x"],
    ["tel:+15551234"],
  ])("refuses to attach %s", (href) => {
    const e = selectWorld(makeEditor("hello world"));
    e.chain().setLink({ href }).run();

    expect(runs(e.getJSON() as RichTextDoc)).toEqual([["hello world", []]]);
  });

  it("replaces the whole link when the caret is inside one", () => {
    const e = selectWorld(makeEditor("hello world"));
    e.chain().setLink({ href: "https://old.example" }).run();

    // Caret inside "world", nothing selected.
    e.chain().setTextSelection(9).extendMarkRange("link").setLink({ href: "https://new.example" }).run();

    const run = (e.getJSON() as RichTextDoc).content[0].content![1];
    expect(run.text).toBe("world");
    expect(run.marks![0].attrs!.href).toBe("https://new.example");
  });

  it("unsets the whole link from a caret inside it", () => {
    const e = selectWorld(makeEditor("hello world"));
    e.chain().setLink({ href: "https://example.com" }).run();
    e.chain().setTextSelection(9).extendMarkRange("link").unsetLink().run();

    expect(runs(e.getJSON() as RichTextDoc)).toEqual([["hello world", []]]);
  });

  it("replaces a web link with a dashboard link rather than stacking both", () => {
    const e = selectWorld(makeEditor("hello world"));
    e.chain().setLink({ href: "https://example.com" }).run();
    e.chain()
      .setTextSelection({ from: 7, to: 12 })
      .extendMarkRange("link")
      .unsetLink()
      .setDashboardLink({ dashboardId: 4 })
      .run();

    expect(runs(e.getJSON() as RichTextDoc)).toEqual([
      ["hello ", []],
      ["world", ["dashboardLink"]],
    ]);
  });

  it("stores a dashboard link as an id, never a URL", () => {
    const e = selectWorld(makeEditor("hello world"));
    e.chain().setDashboardLink({ dashboardId: 12 }).run();

    const run = (e.getJSON() as RichTextDoc).content[0].content![1];
    expect(run.marks![0].attrs).toEqual({ dashboardId: 12 });
  });
});
