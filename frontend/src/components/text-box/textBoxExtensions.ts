/**
 * The Text Box editor's TipTap extensions (#373 follow-up).
 *
 * In its own module rather than next to the editor component because
 * `react-refresh/only-export-components` requires a component file to export
 * components only — the same reason `componentMapRegistry.ts` is split out of
 * `componentMap.tsx`.
 *
 * Exported so tests drive the exact configuration that ships rather than a
 * lookalike. Links are the one mark that carries a URL, so the gate on what
 * may become an href is `isSafeHref`, shared with the renderer and mirrored
 * by `_clean_href` in `api/rich_text.py`.
 */
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { DashboardLink } from './dashboardLinkExtension';
import { LineHeight } from './lineHeightExtension';
import {
  isSafeHref,
  normalizePastedColor,
  normalizePastedFontFamily,
  normalizePastedFontSize,
} from './richText';

type GlobalAttributes = Array<{
  types: string[];
  attributes: Record<string, { parseHTML?: (element: HTMLElement) => unknown }>;
}>;

/**
 * Run an extension's parsed attribute through `normalize`, so pasted HTML
 * only ever produces a value the backend will keep.
 */
function narrowParsedAttribute(
  attributes: GlobalAttributes,
  name: string,
  normalize: (value: unknown) => string | null,
): GlobalAttributes {
  return attributes.map((entry) => {
    const spec = entry.attributes[name];
    if (!spec?.parseHTML) return entry;
    const parse = spec.parseHTML;
    return {
      ...entry,
      attributes: {
        ...entry.attributes,
        [name]: { ...spec, parseHTML: (element: HTMLElement) => normalize(parse(element)) },
      },
    };
  });
}

export const TEXT_BOX_EXTENSIONS = [
  StarterKit.configure({
    // StarterKit bundles its own Link; disable it so the one below is the
    // only registration of the mark.
    link: false,
    // The backend and renderer know three heading sizes. Left at the default
    // of six, "#### " made an H4 that came back as an H1 after saving.
    heading: { levels: [1, 2, 3] },
  }),
  Link.configure({
    openOnClick: false,
    // The toolbar is the only way to make a link.
    autolink: false,
    linkOnPaste: false,
    // NOT a narrower `protocols` list: that option only *adds* to Tiptap's
    // allowlist and cannot subtract from it, and the default `isAllowedUri`
    // also lets through anything with no apparent scheme, `//evil.com`
    // included. Narrowing `protocols` looks like a restriction and enforces
    // nothing — the gate has to be replaced.
    isAllowedUri: (url: string) => isSafeHref(url),
    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
  }).extend({
    // The other half of the exclusion on `DashboardLink`; `link` is named
    // because spelling `excludes` out replaces the self-exclusion default.
    excludes: 'link dashboardLink',
  }),
  DashboardLink,
  // A real placeholder, so an empty box shows a hint instead of carrying the
  // words "Enter text here" as actual content the user has to delete.
  Placeholder.configure({ placeholder: 'Type here…' }),
  TextStyle,
  Color.extend({
    addGlobalAttributes() {
      return narrowParsedAttribute(
        (this.parent?.() ?? []) as GlobalAttributes,
        'color',
        normalizePastedColor,
      );
    },
  }),
  FontFamily.extend({
    addGlobalAttributes() {
      return narrowParsedAttribute(
        (this.parent?.() ?? []) as GlobalAttributes,
        'fontFamily',
        normalizePastedFontFamily,
      );
    },
  }),
  FontSize.extend({
    addGlobalAttributes() {
      return narrowParsedAttribute(
        (this.parent?.() ?? []) as GlobalAttributes,
        'fontSize',
        normalizePastedFontSize,
      );
    },
  }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  // Without this the schema drops `lineHeight` on load.
  LineHeight,
];
