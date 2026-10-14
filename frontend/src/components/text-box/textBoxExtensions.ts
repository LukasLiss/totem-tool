/**
 * The Text Box editor's TipTap extensions (#373 follow-up).
 *
 * In its own module rather than next to the editor component because
 * `react-refresh/only-export-components` requires a component file to export
 * components only — the same reason `componentMapRegistry.ts` is split out of
 * `componentMap.tsx`.
 *
 * Exported so tests drive the exact configuration that ships rather than a
 * lookalike. `link` is off: it is the one mark here that would carry a URL,
 * the toolbar offers no way to add one, and the backend whitelist drops it.
 */
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';

export const TEXT_BOX_EXTENSIONS = [
  StarterKit.configure({ link: false }),
  // A real placeholder, so an empty box shows a hint instead of carrying the
  // words "Enter text here" as actual content the user has to delete.
  Placeholder.configure({ placeholder: 'Type here…' }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];
