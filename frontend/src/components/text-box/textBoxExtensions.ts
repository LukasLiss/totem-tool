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
import { isSafeHref } from './richText';

export const TEXT_BOX_EXTENSIONS = [
  // StarterKit bundles its own copy of Link; disable it so the configured
  // one below is the only registration of the mark.
  StarterKit.configure({ link: false }),
  Link.configure({
    // Clicking in the editor should place the caret, not navigate away from
    // under the user.
    openOnClick: false,
    // The toolbar is the only way to make a link. Typing or pasting a URL
    // does not silently become one.
    autolink: false,
    linkOnPaste: false,
    // NOT a narrower `protocols` list. That option only *adds* to Tiptap's
    // built-in allowlist (ftp, tel, sms, xmpp and more) and cannot subtract
    // from it, and its default `isAllowedUri` additionally lets through
    // anything with no apparent scheme — protocol-relative `//evil.com`
    // included. Replacing the gate is the whole point; narrowing `protocols`
    // would look like a restriction and enforce nothing.
    isAllowedUri: (url: string) => isSafeHref(url),
    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
  }),
  DashboardLink,
  // A real placeholder, so an empty box shows a hint instead of carrying the
  // words "Enter text here" as actual content the user has to delete.
  Placeholder.configure({ placeholder: 'Type here…' }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];
