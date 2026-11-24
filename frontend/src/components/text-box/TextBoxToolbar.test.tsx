// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";

import { TextBoxToolbar } from "./TextBoxToolbar";
import { TEXT_BOX_EXTENSIONS } from "./textBoxExtensions";
import { TEXT_BOX_FORMAT_DEFAULTS, type TextBoxFormat } from "./textBoxFormat";

afterEach(cleanup);

/** An editor with "hello" selected, and the toolbar's font size field. */
function setup() {
  const editor = new Editor({ extensions: TEXT_BOX_EXTENSIONS, content: "<p>hello world</p>" });
  editor.commands.setTextSelection({ from: 1, to: 6 });
  render(
    <TextBoxToolbar
      editor={editor}
      format={TEXT_BOX_FORMAT_DEFAULTS as TextBoxFormat}
      onFormatChange={() => {}}
      idPrefix="test"
    />,
  );
  return { editor, input: screen.getByLabelText("Font size") as HTMLInputElement };
}

/** The font sizes in the document, in order. */
const fontSizes = (editor: Editor) =>
  [...JSON.stringify(editor.getJSON()).matchAll(/"fontSize":"(\d+px)"/g)].map((m) => m[1]);

describe("TextBoxToolbar font size", () => {
  // The spin buttons and arrow keys only fire change events, no Enter and no blur.
  it("applies a valid size to the selection while the field changes", () => {
    const { editor, input } = setup();
    fireEvent.change(input, { target: { value: "15" } });
    expect(fontSizes(editor)).toEqual(["15px"]);

    fireEvent.change(input, { target: { value: "16" } });
    expect(fontSizes(editor)).toEqual(["16px"]);
  });

  it("waits with a value below the minimum, so a size like 24 can be typed", () => {
    const { editor, input } = setup();
    fireEvent.change(input, { target: { value: "2" } });
    expect(fontSizes(editor)).toEqual([]);
    expect(input.value).toBe("2");

    fireEvent.change(input, { target: { value: "24" } });
    expect(fontSizes(editor)).toEqual(["24px"]);
  });

  it("clamps an out-of-range value on Enter", () => {
    const { editor, input } = setup();
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fontSizes(editor)).toEqual(["8px"]);
  });
});
