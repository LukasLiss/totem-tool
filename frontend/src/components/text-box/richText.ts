/**
 * The Text Box's rich-text document (#373 follow-up).
 *
 * A TipTap/ProseMirror tree. It is stored and transported as JSON and never
 * as HTML: `RichTextRenderer` walks it into React elements, so there is no
 * markup to sanitise and no `dangerouslySetInnerHTML` anywhere in the path.
 * The backend rebuilds the same shape from a whitelist in `api/rich_text.py`
 * — keep the two in step.
 *
 * Marks (bold, italic, underline, colour, size, font) apply to a run of
 * characters; alignment and line height are paragraph attributes, because a
 * block cannot be half-centred. Whatever a run does not specify falls back to
 * the box-level format in `textBoxFormat.ts`.
 */
import type { TextBoxFormat } from './textBoxFormat';
import { FONT_FAMILY_STACKS, TEXT_BOX_FORMAT_DEFAULTS } from './textBoxFormat';

/**
 * The only font-family values a run may carry: references to the design
 * system's tokens. Storing the token rather than a choice key keeps the
 * editor WYSIWYG (the value is valid CSS as it stands) while still being a
 * closed set, mirrored by `_FONT_FAMILIES` in `api/rich_text.py`.
 */
export const RICH_FONT_FAMILY_VALUES = Object.values(FONT_FAMILY_STACKS);

function isAllowedFontFamily(value: unknown): value is string {
  return typeof value === 'string' && RICH_FONT_FAMILY_VALUES.includes(value);
}

/**
 * The accepted link targets, mirroring `_clean_href` in `api/rich_text.py` —
 * change one and you must change the other.
 *
 * Anchored, so a hostile scheme cannot hide in front of a legitimate-looking
 * tail, and `//evil.com` has no match. Control characters are rejected rather
 * than stripped, because a browser strips them and then navigates elsewhere.
 */
const HTTP_SCHEME_RE = /^(https?:\/\/)/i;
/**
 * Everything between `scheme://` and the first `/`, `?` or `#`, read off the
 * string rather than via `new URL`: the browser (WHATWG) and Python's
 * `urlsplit` (RFC 3986) disagree in both directions on inputs like
 * `https:///p` and `https://exa mple.com`.
 */
const AUTHORITY_RE = /^[A-Za-z0-9._~%!$&'()*+,;=:@[\]-]+$/;
const MAILTO_SCHEME_RE = /^mailto:/i;
const EMAIL_RE = /^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
const MAX_HREF_LENGTH = 2048;

/** True for a bare http(s) URL or a lone mailto address, and nothing else. */
export function isSafeHref(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const href = value.trim();
  if (!href || href.length > MAX_HREF_LENGTH) return false;
  if (CONTROL_CHAR_RE.test(href)) return false;

  const scheme = HTTP_SCHEME_RE.exec(href);
  if (scheme) {
    const authority = href.slice(scheme[0].length).split(/[/?#]/, 1)[0];
    return authority !== '' && AUTHORITY_RE.test(authority);
  }
  if (MAILTO_SCHEME_RE.test(href)) {
    const address = href.slice('mailto:'.length);
    // A query string is the only way cc/bcc/subject/body can ride along.
    return !address.includes('?') && EMAIL_RE.test(address);
  }
  return false;
}

/** True when the href should open the mail client rather than a new tab. */
export function isMailtoHref(href: string): boolean {
  return MAILTO_SCHEME_RE.test(href.trim());
}

/**
 * The run's link target, or null. Re-checked rather than trusted: rows
 * written before links existed were never validated.
 */
export function hrefFromMarks(marks: RichTextMark[] | undefined): string | null {
  for (const mark of marks ?? []) {
    if (mark.type === 'link' && isSafeHref(mark.attrs?.href)) {
      return mark.attrs!.href!.trim();
    }
  }
  return null;
}

/** The dashboard this run links to, or null. */
export function dashboardIdFromMarks(marks: RichTextMark[] | undefined): number | null {
  for (const mark of marks ?? []) {
    if (mark.type === 'dashboardLink') {
      const id = mark.attrs?.dashboardId;
      if (typeof id === 'number' && Number.isInteger(id) && id > 0) return id;
    }
  }
  return null;
}

export type RichTextMark =
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' }
  | {
      type: 'textStyle';
      attrs?: { color?: string; fontSize?: string; fontFamily?: string };
    }
  | { type: 'link'; attrs?: { href?: string } }
  | { type: 'dashboardLink'; attrs?: { dashboardId?: number } };

export interface RichTextNode {
  type: string;
  text?: string;
  marks?: RichTextMark[];
  attrs?: {
    textAlign?: string;
    lineHeight?: string;
    level?: number;
    [key: string]: unknown;
  };
  content?: RichTextNode[];
}

export interface RichTextDoc {
  type: 'doc';
  content: RichTextNode[];
}

/** True for something shaped like a document we can render. */
export function isRichTextDoc(value: unknown): value is RichTextDoc {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as RichTextDoc).type === 'doc' &&
    Array.isArray((value as RichTextDoc).content)
  );
}

/** Flatten a document to plain text, one line per block. */
export function plainTextFromDoc(doc: unknown): string {
  if (!isRichTextDoc(doc)) return '';
  const lineOf = (node: RichTextNode, out: string[]): void => {
    if (node.type === 'text') {
      out.push(node.text ?? '');
      return;
    }
    if (node.type === 'hardBreak') {
      out.push('\n');
      return;
    }
    for (const child of node.content ?? []) lineOf(child, out);
  };
  return (doc.content ?? [])
    .map((block) => {
      const out: string[] = [];
      lineOf(block, out);
      return out.join('');
    })
    .join('\n');
}

/**
 * The box-level fields that describe *text*, as opposed to the box itself.
 * When a box gains a rich-text document these are reset to their defaults and
 * the document takes over, so there is exactly one source of truth: leaving
 * them set would mean un-bolding a run still rendered bold, inherited from
 * the container. `background_color` and `vertical_align` are not here —
 * they stay box-level, because neither can be expressed per paragraph.
 */
export const TEXT_LEVEL_FORMAT_KEYS = [
  'font_size',
  'font_family',
  'font_weight',
  'italic',
  'underline',
  'text_align',
  'text_color',
  'line_height',
] as const;

/** Marks that reproduce a box-level format on a run of text. */
function marksFromFormat(format: TextBoxFormat): RichTextMark[] {
  const marks: RichTextMark[] = [];
  if (format.font_weight === 'bold') marks.push({ type: 'bold' });
  if (format.italic) marks.push({ type: 'italic' });
  if (format.underline) marks.push({ type: 'underline' });

  const attrs: { color?: string; fontSize?: string; fontFamily?: string } = {};
  if (format.text_color !== TEXT_BOX_FORMAT_DEFAULTS.text_color) {
    attrs.color = format.text_color;
  }
  if (format.font_size !== TEXT_BOX_FORMAT_DEFAULTS.font_size) {
    attrs.fontSize = `${format.font_size}px`;
  }
  if (format.font_family !== TEXT_BOX_FORMAT_DEFAULTS.font_family) {
    attrs.fontFamily = FONT_FAMILY_STACKS[format.font_family];
  }
  if (Object.keys(attrs).length > 0) marks.push({ type: 'textStyle', attrs });
  return marks;
}

/**
 * Build a document from a box's plain text, so a text box saved before rich
 * text existed opens in the editor looking exactly as it already does.
 *
 * The box-level formatting is baked into marks and paragraph attributes here
 * rather than left on the container, because the container's base style would
 * otherwise keep applying underneath and a user could never turn it off.
 */
export function docFromPlainText(text: string, format?: TextBoxFormat): RichTextDoc {
  const lines = (text ?? '').split('\n');
  const marks = format ? marksFromFormat(format) : [];
  const attrs = format ? blockAttrsFromFormat(format) : undefined;
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      ...(attrs ? { attrs } : {}),
      // An empty paragraph must have no content array at all; a paragraph
      // holding an empty text node is invalid in ProseMirror and throws on
      // load ("Empty text nodes are not allowed").
      ...(line
        ? { content: [{ type: 'text', text: line, ...(marks.length ? { marks } : {}) }] }
        : {}),
    })),
  };
}

/** True when the document would render as nothing at all. */
export function isDocEmpty(doc: unknown): boolean {
  return !isRichTextDoc(doc) || plainTextFromDoc(doc).trim() === '';
}

/**
 * The document to edit/render for a widget: the stored one, or one built from
 * the plain text for a box that predates this feature.
 */
export function docForWidget(
  richText: unknown,
  text: string | undefined,
  format?: TextBoxFormat,
): RichTextDoc {
  if (isRichTextDoc(richText) && (richText.content ?? []).length > 0) {
    return richText;
  }
  return docFromPlainText(text ?? '', format);
}

/**
 * The patch that moves a box onto its rich-text document: store the document
 * and reset the text-level fields, which the document now owns.
 */
export function conversionPatch(doc: RichTextDoc) {
  const patch: Record<string, unknown> = { rich_text: doc };
  for (const key of TEXT_LEVEL_FORMAT_KEYS) {
    patch[key] = TEXT_BOX_FORMAT_DEFAULTS[key];
  }
  return patch;
}

/** Inline style contributed by a run's marks, over the box-level base. */
export function styleFromMarks(marks: RichTextMark[] | undefined): React.CSSProperties {
  const style: React.CSSProperties = {};
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        style.fontWeight = 'bold';
        break;
      case 'italic':
        style.fontStyle = 'italic';
        break;
      case 'underline':
        // Combine rather than overwrite: a run can be both.
        style.textDecoration = style.textDecoration === 'line-through'
          ? 'underline line-through'
          : 'underline';
        break;
      case 'strike':
        style.textDecoration = style.textDecoration === 'underline'
          ? 'underline line-through'
          : 'line-through';
        break;
      case 'code':
        style.fontFamily = FONT_FAMILY_STACKS.mono;
        break;
      case 'link':
      case 'dashboardLink':
        // A link becomes an element, not a style — see `RichTextRenderer`.
        break;
      case 'textStyle': {
        const attrs = mark.attrs ?? {};
        if (attrs.color) style.color = attrs.color;
        if (attrs.fontSize) style.fontSize = attrs.fontSize;
        if (isAllowedFontFamily(attrs.fontFamily)) {
          style.fontFamily = attrs.fontFamily;
        }
        break;
      }
    }
  }
  return style;
}

/** Inline style contributed by a block's own attributes. */
export function styleFromBlockAttrs(attrs: RichTextNode['attrs']): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (!attrs) return style;
  if (typeof attrs.textAlign === 'string') {
    style.textAlign = attrs.textAlign as React.CSSProperties['textAlign'];
  }
  if (attrs.lineHeight != null && attrs.lineHeight !== '') {
    const value = Number(attrs.lineHeight);
    if (Number.isFinite(value)) style.lineHeight = value;
  }
  return style;
}

/**
 * The paragraph attributes a *new* document should start with, taken from the
 * box-level format, so turning on rich text does not silently restyle a box.
 */
export function blockAttrsFromFormat(format: TextBoxFormat) {
  return { textAlign: format.text_align, lineHeight: String(format.line_height) };
}
