/**
 * The header of the canvas panels (object type panel, the DFG's animation
 * panel): title left, small icon buttons right, a divider below. Shared so
 * the headers line up exactly; kept apart from the components (Fast Refresh).
 */

import type { CSSProperties } from 'react';
import { GLASS_SURFACE } from '@/react_component/orgamining/canvasSurface';

/** The frame of a canvas panel (and its chip): frosted glass, thin border, rounded. */
export const CANVAS_PANEL_SHELL: CSSProperties = {
  ...GLASS_SURFACE,
  border: '1px solid #E5E7EB',
  borderRadius: 12,
  boxShadow: '0 6px 16px rgba(15, 23, 42, 0.05)',
  fontFamily: 'var(--font-primary, Inter, sans-serif)',
  // Dashboard widgets centre their text (.grid-stack-item-content); panels are left-aligned.
  textAlign: 'left',
};

/** The header row: 8 px top/bottom, 14 px left, 8 px right (the buttons bring their own room). */
export const PANEL_HEADER_CLASS = 'flex items-center gap-1 border-b border-slate-100 py-2 pl-3.5 pr-2';

export const PANEL_TITLE_CLASS = 'flex-1 select-none text-xs font-semibold text-slate-900';

/** What every collapsed-panel chip shares: 30 px tall (border included), text style. */
const PANEL_CHIP_BASE = 'flex h-[30px] items-center whitespace-nowrap text-[11px] font-semibold leading-4 text-slate-700';

/** A chip with a marker (icon or colour dots), a short label and a chevron. */
export const PANEL_CHIP_CLASS = `${PANEL_CHIP_BASE} gap-2 px-2.5`;

/** A chip with just an icon: the same height, square. */
export const PANEL_CHIP_ICON_CLASS = `${PANEL_CHIP_BASE} w-[30px] justify-center`;

export const PANEL_CHIP_CHEVRON_CLASS = 'h-3 w-3 shrink-0 text-slate-400';

/** A 24×24 icon button of the header (close, menu), grey with a light hover background. */
export const PANEL_ICON_BUTTON_CLASS =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800';

/** A text button of the header (e.g. "Hide"): the icon button's look and height (24 px), as wide as its word. */
export const PANEL_TEXT_BUTTON_CLASS =
  'flex h-6 shrink-0 items-center justify-center rounded-md px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800';
