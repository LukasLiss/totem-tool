/**
 * Edit mode for the Text Box: a TipTap editor plus the formatting toolbar
 * (#373 follow-up).
 *
 * The editor is the source of truth for everything about the *text* —
 * bold/italic/underline, colour, size and font apply to the selection, and
 * alignment applies to the paragraph the cursor is in. Only the two things
 * that cannot be expressed per paragraph — background colour and vertical
 * alignment — remain box-level and are patched onto the GridStack node.
 *
 * What leaves this component is always the editor's JSON document, never
 * HTML. The backend rebuilds it from a whitelist and the view-mode renderer
 * walks it into React elements.
 */
import React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { TextBoxToolbar } from './TextBoxToolbar';
import { TEXT_BOX_EXTENSIONS } from './textBoxExtensions';
import type { RichTextDoc } from './richText';
import { type TextBoxFormat, TEXT_BOX_FORMAT_DEFAULTS } from './textBoxFormat';

export interface TextBoxEditorProps {
  doc: RichTextDoc;
  format: TextBoxFormat;
  /** The document changed — hand back the editor's JSON. */
  onDocChange: (doc: RichTextDoc) => void;
  /** A box-level setting changed (background colour, vertical alignment). */
  onFormatChange: (patch: Partial<TextBoxFormat>) => void;
  idPrefix: string;
}

export function TextBoxEditor({
  doc,
  format,
  onDocChange,
  onFormatChange,
  idPrefix,
}: TextBoxEditorProps) {
  const editor = useEditor({
    extensions: TEXT_BOX_EXTENSIONS,
    content: doc,
    editorProps: {
      attributes: {
        // The editor fills the tile and scrolls; `outline-none` because the
        // card already shows focus.
        class: 'tiptap-text-box h-full w-full overflow-auto outline-none',
      },
    },
    onUpdate: ({ editor: instance }) => {
      onDocChange(instance.getJSON() as RichTextDoc);
    },
  });

  // Replace the content only when the document genuinely differs from what
  // the editor already holds — otherwise every keystroke would round-trip
  // through the node and reset the cursor to the start.
  React.useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    if (current !== JSON.stringify(doc)) {
      editor.commands.setContent(doc, { emitUpdate: false });
    }
  }, [doc, editor]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TextBoxToolbar
        editor={editor}
        format={format}
        onFormatChange={onFormatChange}
        idPrefix={idPrefix}
      />
      <div
        className="min-h-0 flex-1 p-3"
        style={{
          background: format.background_color,
          // Unmarked text falls back to these, which are the plain defaults:
          // a converted box carries its old look in the document itself.
          fontSize: TEXT_BOX_FORMAT_DEFAULTS.font_size,
          color: TEXT_BOX_FORMAT_DEFAULTS.text_color,
          lineHeight: TEXT_BOX_FORMAT_DEFAULTS.line_height,
        }}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}

export default TextBoxEditor;
