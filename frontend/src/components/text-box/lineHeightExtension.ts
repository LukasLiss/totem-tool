/**
 * `lineHeight` as a real paragraph/heading attribute.
 *
 * The backend validates it and the renderer renders it, but nothing declared
 * it on the schema, so ProseMirror discarded it on load and a box saved at 2
 * came back at the 1.5 default — which `conversionPatch` then persisted.
 *
 * Declared the way `extension-text-align` declares `textAlign`.
 */
import { Extension } from '@tiptap/core';

export const LINE_HEIGHT_TYPES = ['heading', 'paragraph'] as const;

export const LineHeight = Extension.create({
  name: 'lineHeight',

  addGlobalAttributes() {
    return [
      {
        types: [...LINE_HEIGHT_TYPES],
        attributes: {
          lineHeight: {
            default: null,
            // A string, matching the backend and `styleFromBlockAttrs`.
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) =>
              attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
          },
        },
      },
    ];
  },
});

export default LineHeight;
