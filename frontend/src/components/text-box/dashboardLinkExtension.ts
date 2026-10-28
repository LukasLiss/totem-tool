/**
 * A link from a Text Box to another dashboard.
 *
 * Not the `link` mark with an invented scheme: there are no per-dashboard
 * routes (`ViewMode` is in-memory state), so this was never going to be a
 * URL. An integer id has no `href` for a hostile scheme to hide in.
 *
 * The HTML here only matters inside the editor — view mode is walked into a
 * `<button>` by `RichTextRenderer`.
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

  // As with `link`: typing on from the end should not extend it.
  inclusive: false,

  // Exclusion is directional, so `Link` declares the other half in
  // textBoxExtensions.ts. Naming this mark too is required: spelling
  // `excludes` out replaces the default of excluding itself.
  excludes: 'dashboardLink link',

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
        ({ commands }) =>
          commands.setMark(this.name, attributes),

      unsetDashboardLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export default DashboardLink;
