/**
 * A link from a Text Box to another dashboard.
 *
 * Deliberately *not* the `link` mark with some invented URL scheme. There are
 * no per-dashboard routes in this app — `ViewMode` is in-memory state and
 * every view lands on `/overview` — so a dashboard link was never going to be
 * a URL. Storing a plain integer id instead means this mark has no `href` for
 * a hostile scheme to hide in, and `api/rich_text.py` can validate it by
 * asking whether the number names a dashboard in the same project rather than
 * by parsing a string.
 *
 * The rendered HTML here only matters inside the editor. View mode is walked
 * into React elements by `RichTextRenderer`, which turns this mark into a
 * `<button>` that calls back into `setViewMode`.
 */
import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dashboardLink: {
      setDashboardLink: (attributes: { dashboardId: number }) => ReturnType;
      unsetDashboardLink: () => ReturnType;
    };
  }
}

export const DashboardLink = Mark.create({
  name: 'dashboardLink',

  // Matches the `link` mark's behaviour: typing on from the end of a link
  // should not silently extend it.
  inclusive: false,

  // A run is either a web/email link or a dashboard link, never both. The
  // commands below also unset the other explicitly, because ProseMirror's
  // exclusion only applies in the direction it is declared.
  excludes: 'link dashboardLink',

  addAttributes() {
    return {
      dashboardId: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-dashboard-id');
          if (raw === null) return null;
          const id = Number.parseInt(raw, 10);
          return Number.isInteger(id) && id > 0 ? id : null;
        },
        renderHTML: (attributes) =>
          typeof attributes.dashboardId === 'number'
            ? { 'data-dashboard-id': String(attributes.dashboardId) }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-dashboard-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'totem-dashboard-link' }),
      0,
    ];
  },

  addCommands() {
    return {
      setDashboardLink:
        (attributes) =>
        ({ chain }) =>
          chain()
            .unsetMark('link')
            .setMark(this.name, attributes)
            .run(),

      unsetDashboardLink:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});

export default DashboardLink;
