/**
 * The Text Box editor: a TipTap editor plus the formatting toolbar (#373
 * follow-up). It runs in the widget's edit popup (TextBoxEditDialog).
 *
 * The editor is the source of truth for everything about the *text* —
 * bold/italic/underline, colour, size and font apply to the selection, and
 * alignment applies to the paragraph the cursor is in. Only the two things
 * that cannot be expressed per paragraph — background colour and vertical
 * alignment — remain box-level and are patched onto the GridStack node.
 *
 * With a `frame` (the tile's size on the dashboard) the text is edited in a
 * card of exactly that size, styled like the view mode, so lines wrap as
 * they will on the dashboard; a frame larger than the space is shrunk to fit
 * as a whole. Without one the editor simply fills its box.
 *
 * What leaves this component is always the editor's JSON document, never
 * HTML. The backend rebuilds it from a whitelist and the view-mode renderer
 * walks it into React elements.
 */
import React from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Card } from '@/components/ui/card';
import { TextBoxToolbar } from './TextBoxToolbar';
import type { ProjectDashboard } from './useProjectDashboards';
import { TEXT_BOX_EXTENSIONS } from './textBoxExtensions';
import type { RichTextDoc } from './richText';
import { type TextBoxFormat, TEXT_BOX_FORMAT_DEFAULTS, textBoxContainerStyle } from './textBoxFormat';

export interface TextBoxEditorProps {
  doc: RichTextDoc;
  format: TextBoxFormat;
  /** The document changed — hand back the editor's JSON. */
  onDocChange: (doc: RichTextDoc) => void;
  /** A box-level setting changed (background colour, vertical alignment). */
  onFormatChange: (patch: Partial<TextBoxFormat>) => void;
  idPrefix: string;
  /** Dashboards in this project, for the link popover's picker. */
  dashboards?: ProjectDashboard[];
  /** The tile's size in px on the dashboard: edit in a card of exactly that size. */
  frame?: { width: number; height: number };
}

// Unmarked text falls back to these, which are the plain defaults: a
// converted box carries its old look in the document itself. Alignment too,
// and for a sharper reason: `.grid-stack-item-content` sets `text-align:
// center` for every widget, so a block that has no textAlign of its own (one
// ProseMirror just made -- the paragraph after a divider, say) would render
// centred while the toolbar, which falls back to this same default, reported
// it left. Same as the view mode's text wrapper.
const TEXT_DEFAULTS: React.CSSProperties = {
  fontSize: TEXT_BOX_FORMAT_DEFAULTS.font_size,
  color: TEXT_BOX_FORMAT_DEFAULTS.text_color,
  lineHeight: TEXT_BOX_FORMAT_DEFAULTS.line_height,
  textAlign: TEXT_BOX_FORMAT_DEFAULTS.text_align,
};

export function TextBoxEditor({
  doc,
  format,
  onDocChange,
  onFormatChange,
  idPrefix,
  dashboards,
  frame,
}: TextBoxEditorProps) {
  const editor = useEditor({
    extensions: TEXT_BOX_EXTENSIONS,
    content: doc,
    editorProps: {
      attributes: {
        // Without a frame the editor fills its box and scrolls. In a frame it
        // is as tall as its text, so the card's vertical alignment applies
        // (the card scrolls, as in view mode), and it carries the view mode's
        // p-3 itself: the text sits in the same place, and a click or drag in
        // the padding lands in the editor. `outline-none`: the card shows focus.
        class: frame
          ? 'tiptap-text-box w-full p-3 outline-none'
          : 'tiptap-text-box h-full w-full overflow-auto outline-none',
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
        dashboards={dashboards}
      />
      {frame ? (
        <FramedCanvas frame={frame} editor={editor} format={format} />
      ) : (
        <div className="min-h-0 flex-1 p-3" style={{ background: format.background_color, ...TEXT_DEFAULTS }}>
          <EditorContent editor={editor} className="h-full" />
        </div>
      )}
    </div>
  );
}

/**
 * The tile on the dashboard, rebuilt at its exact size: the same card and
 * padding as the view mode, with its background, vertical alignment and
 * scrolling. Shrunk as a whole (never enlarged) when it doesn't fit, so line
 * breaks stay exactly as on the dashboard.
 */
function FramedCanvas({ frame, editor, format }: {
  frame: { width: number; height: number };
  editor: Editor | null;
  format: TextBoxFormat;
}) {
  const [area, setArea] = React.useState<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);
  React.useLayoutEffect(() => {
    if (!area || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // Room for the caption above the card.
      const width = area.clientWidth;
      const height = area.clientHeight - CAPTION_HEIGHT;
      if (width > 0 && height > 0) {
        setScale(Math.min(1, width / frame.width, height / frame.height));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [area, frame.width, frame.height]);

  const percent = Math.round(scale * 100);
  return (
    <div ref={setArea} className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-muted/30 p-6">
      <p className="text-xs text-muted-foreground" style={{ height: CAPTION_HEIGHT }}>
        {Math.round(frame.width)} × {Math.round(frame.height)} px, as on the dashboard
        {percent < 100 ? ` · shown at ${percent}%` : ''}
      </p>
      {/* Takes the scaled size in the layout; the card inside keeps the real size. */}
      <div style={{ width: frame.width * scale, height: frame.height * scale }} className="shrink-0">
        <Card
          className="gap-0 overflow-hidden rounded-none py-0 shadow-md"
          style={{
            width: frame.width,
            height: frame.height,
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'top left',
          }}
        >
          {/* As the view mode's CardContent: the box-level container style (its p-3 is on the editor). */}
          <div
            className="h-full cursor-text"
            style={textBoxContainerStyle(format)}
            // A click into the empty part of the card (above or below short
            // text) goes to the nearest spot in the text, as in a text editor:
            // above it to the start, below it to the end.
            onMouseDown={(e) => {
              if (e.target !== e.currentTarget || !editor) return;
              e.preventDefault();
              placeCaretNear(editor, e.clientX, e.clientY);
            }}
          >
            <div style={TEXT_DEFAULTS}>
              <EditorContent editor={editor} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Puts the caret at the text position nearest to a click outside the text:
 * the point is moved into the editor's box (just inside its edges) and
 * looked up there. Falls back to the end when nothing is found.
 */
function placeCaretNear(editor: Editor, clientX: number, clientY: number) {
  const rect = editor.view.dom.getBoundingClientRect();
  const inset = 1;
  const x = Math.min(Math.max(clientX, rect.left + inset), rect.right - inset);
  const y = Math.min(Math.max(clientY, rect.top + inset), rect.bottom - inset);
  const hit = editor.view.posAtCoords({ left: x, top: y });
  if (hit) editor.chain().focus().setTextSelection(hit.pos).run();
  else editor.commands.focus('end');
}

// Height of the size caption above the card, in px (text-xs line plus a gap).
const CAPTION_HEIGHT = 24;

export default TextBoxEditor;
