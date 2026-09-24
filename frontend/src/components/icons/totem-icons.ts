/**
 * Icons this tool needs that Lucide does not have.
 *
 * Object-centric process mining draws things Lucide has no glyph for — a
 * directly-follows edge, a causal net's bindings — so those are drawn here
 * instead of settling for an approximation from the library.
 *
 * They are built with Lucide's own factory, so a custom icon is
 * indistinguishable from an imported one at the call site: same props, same
 * `currentColor`, same default size, and the same type, so it drops straight
 * into the `icon:` field of the sidebar's nav arrays.
 *
 * To add one: draw it on a 24x24 grid with a 2px stroke, round caps and joins,
 * and roughly 2px of outer padding — the conventions the Lucide set follows, so
 * a new icon sits beside the others without looking foreign. Then translate the
 * SVG elements into a node array below. Each node is `[tag, attributes]`; the
 * `key` is React's and only needs to be unique within the icon.
 */
import { createElement, forwardRef } from 'react';
import {
  createLucideIcon,
  type IconNode,
  type LucideProps,
} from 'lucide-react';

/**
 * Lucide's factory with a default stroke width.
 *
 * Lucide draws everything at 2. An icon whose shapes are small relative to the
 * canvas — two 6x6 boxes, say — reads heavier than its neighbours at that
 * weight once the sidebar scales it to 16px, so it can be given a finer line
 * here. A caller can still override with `strokeWidth`.
 */
function totemIcon(name: string, nodes: IconNode, strokeWidth = 2) {
  const Base = createLucideIcon(name, nodes);
  const Icon = forwardRef<SVGSVGElement, LucideProps>((props, ref) =>
    createElement(Base, { strokeWidth, ...props, ref }),
  );
  Icon.displayName = name;
  return Icon;
}

/**
 * Two activities joined by a directed edge — the directly-follows relation an
 * OC-DFG is built from.
 */
export const BoxesArrowRight = totemIcon(
  'boxes-arrow-right',
  [
    ['rect', { x: '2', y: '9', width: '6', height: '6', rx: '1', key: 'source' }],
    ['rect', { x: '16', y: '9', width: '6', height: '6', rx: '1', key: 'target' }],
    ['path', { d: 'M9 12h5', key: 'edge' }],
    ['path', { d: 'm12 10 2 2-2 2', key: 'arrowhead' }],
  ],
  1.8,
);

/**
 * One activity fanning out to two successors, each edge carrying a binding
 * node; the arc between the two nodes marks them as one output binding.
 */
export const CausalNet = totemIcon(
  'causal-net',
  [
    ['rect', { x: '2', y: '9.5', width: '5.5', height: '5.5', rx: '1', key: 'activity' }],
    ['rect', { x: '17', y: '2', width: '5.5', height: '5.5', rx: '1', key: 'successor-top' }],
    ['rect', { x: '17', y: '17', width: '5.5', height: '5.5', rx: '1', key: 'successor-bottom' }],
    ['path', { d: 'M7 12 17 4.5', key: 'edge-top' }],
    ['path', { d: 'M7 12 17 19.5', key: 'edge-bottom' }],
    ['path', { d: 'M12 8.25C17.5 9.6 17.5 14.4 12 15.75', key: 'binding-arc' }],
    [
      'circle',
      { cx: '12', cy: '8.25', r: '2.3', fill: 'currentColor', stroke: 'none', key: 'binding-top' },
    ],
    [
      'circle',
      { cx: '12', cy: '15.75', r: '2.3', fill: 'currentColor', stroke: 'none', key: 'binding-bottom' },
    ],
  ],
  1.8,
);

/*
 * The two conformance icons are their Analysis counterpart with a small alert
 * triangle in the top-right corner. The base geometry is the real glyph — no
 * redraw — so the pair always matches; where the base would reach into the
 * corner it is scaled towards the bottom-left with a `transform` rather than
 * having every coordinate rewritten by hand.
 */

/** Shared badge: outline, stem, dot. Finer than the base so it reads as a mark. */
const alertBadge: IconNode = [
  ['path', { d: 'M19.2 3.2 22.4 8.9H16Z', 'stroke-width': '1.5', key: 'badge-triangle' }],
  ['path', { d: 'M19.2 5.5v1.2', 'stroke-width': '1.5', key: 'badge-stem' }],
  ['path', { d: 'M19.2 7.9h.01', 'stroke-width': '1.5', key: 'badge-dot' }],
];

/** Lucide's Workflow — the TOTeM mark — badged. Its corner is already clear. */
export const WorkflowAlert = totemIcon(
  'workflow-alert',
  [
    ['rect', { width: '8', height: '8', x: '3', y: '3', rx: '2', key: 'first' }],
    ['path', { d: 'M7 11v4a2 2 0 0 0 2 2h4', key: 'connector' }],
    ['rect', { width: '8', height: '8', x: '13', y: '13', rx: '2', key: 'second' }],
    ...alertBadge,
  ],
  1.8,
);

/**
 * The causal net badged. The net reaches into the top-right, so it is scaled
 * about the bottom-left corner to make room; that also thins its strokes,
 * which the dense little shape wants anyway.
 */
const shrinkToCorner = 'translate(0 24) scale(0.60) translate(0 -24)';

export const CausalNetAlert = totemIcon(
  'causal-net-alert',
  [
    ['rect', { x: '2', y: '9.5', width: '5', height: '5', rx: '1', transform: shrinkToCorner, key: 'activity' }],
    ['rect', { x: '17', y: '2', width: '5', height: '5', rx: '1', transform: shrinkToCorner, key: 'successor-top' }],
    ['rect', { x: '17', y: '17', width: '5', height: '5', rx: '1', transform: shrinkToCorner, key: 'successor-bottom' }],
    ['path', { d: 'M7 12 17 4.5', transform: shrinkToCorner, key: 'edge-top' }],
    ['path', { d: 'M7 12 17 19.5', transform: shrinkToCorner, key: 'edge-bottom' }],
    ['path', { d: 'M12 8.25C17.5 9.6 17.5 14.4 12 15.75', transform: shrinkToCorner, key: 'binding-arc' }],
    [
      'circle',
      { cx: '12', cy: '8.25', r: '2.3', fill: 'currentColor', stroke: 'none', transform: shrinkToCorner, key: 'binding-top' },
    ],
    [
      'circle',
      { cx: '12', cy: '15.75', r: '2.3', fill: 'currentColor', stroke: 'none', transform: shrinkToCorner, key: 'binding-bottom' },
    ],
    ...alertBadge,
  ],
  1.8,
);
