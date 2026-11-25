/**
 * The object type panel of the graph canvases: one compact line per object
 * type, in the frosted-glass look of the other canvas panels.
 *
 * Every feature is optional, so each visualizer switches on what it has:
 *  - show/hide (`visibility` + `onVisibilityChange`): click a type to toggle
 *    it, Alt-click to show only that type (again: show all), and "Show all" /
 *    "Hide all" in the ⋯ menu;
 *  - highlight (`onHighlight`): hovering a type highlights it in the graph;
 *  - pinned highlight (`pinned` + `onPinnedChange`, for lists without
 *    show/hide): clicking a type keeps it highlighted, clicking it again
 *    releases it; the other types are greyed meanwhile;
 *  - more groups below the types (`sections`), e.g. the clusters of the
 *    resource profiling, listed in the same lines (colour only);
 *  - per-type details (`renderDetail`), e.g. a filter slider, folded behind a
 *    › on the type's line, with a short value (`detailSummary`) on the line.
 *
 * Collapsed, the panel is a chip with the type count. It filters its list
 * with a search field once there are many types.
 */
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CANVAS_PANEL_SHELL,
  PANEL_CHIP_CHEVRON_CLASS,
  PANEL_CHIP_CLASS,
  PANEL_HEADER_CLASS,
  PANEL_ICON_BUTTON_CLASS,
  PANEL_TITLE_CLASS,
} from './panelHeader';

export interface ObjectTypePanelEntry {
  type: string;
  color: string;
  /** False greys the type out (e.g. it has no arcs); it can't be shown then. */
  available?: boolean;
  /** False: listed for its colour only, it can't be highlighted (e.g. node-only types). */
  highlightable?: boolean;
}

/** A group of colour entries below the types (e.g. clusters); `dashed`: an outlined, dashed dot (e.g. outliers). */
export interface ObjectTypePanelSection {
  title: string;
  entries: { key: string; label: string; color: string; dashed?: boolean }[];
}

export interface ObjectTypePanelProps {
  types: ObjectTypePanelEntry[];
  title?: string;
  /** Show/hide per type (missing = shown). Leave out for a list without toggles. */
  visibility?: Record<string, boolean>;
  onVisibilityChange?: (next: Record<string, boolean>) => void;
  /** Called with the hovered (shown) type, and null when the pointer leaves it. */
  onHighlight?: (type: string | null) => void;
  /** The type kept highlighted by a click (null: none). Only without show/hide. */
  pinned?: string | null;
  onPinnedChange?: (type: string | null) => void;
  /** Folded content of a type, e.g. its filter slider; null when it has none. */
  renderDetail?: (type: string) => React.ReactNode | null;
  /**
   * A short value of a type's details shown on its line, e.g. its filter
   * ("≥ 12"): always while unfolded, and while folded only when `active`
   * (it changes something). Null for none.
   */
  detailSummary?: (type: string) => { text: string; active: boolean } | null;
  /** Extra entries of the ⋯ menu. */
  menuItems?: { label: string; onSelect: () => void }[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** From this many types on, a search field filters the list. */
  searchFrom?: number;
  /** More groups listed below the types, with a small heading each. */
  sections?: ObjectTypePanelSection[];
  testId?: string;
}

const PANEL_SHELL = CANVAS_PANEL_SHELL;

const ICON_BUTTON = PANEL_ICON_BUTTON_CLASS;

export function ObjectTypePanel({
  types,
  title = 'Object types',
  visibility,
  onVisibilityChange,
  onHighlight,
  pinned = null,
  onPinnedChange,
  renderDetail,
  detailSummary,
  menuItems = [],
  collapsed,
  onCollapsedChange,
  searchFrom = 10,
  sections = [],
  testId,
}: ObjectTypePanelProps) {
  const toggles = visibility != null && onVisibilityChange != null;
  const isShown = (type: string) => !toggles || visibility![type] !== false;
  const isAvailable = (entry: ObjectTypePanelEntry) => entry.available !== false;
  const pins = !toggles && onPinnedChange != null;
  const canHighlight = (entry: ObjectTypePanelEntry) => isAvailable(entry) && entry.highlightable !== false;
  const hiddenCount = toggles ? types.filter((t) => isAvailable(t) && !isShown(t.type)).length : 0;

  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const searchable = types.length >= searchFrom;
  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q && searchable ? types.filter((t) => t.type.toLowerCase().includes(q)) : types;
  }, [types, query, searchable]);

  const setAll = (visible: boolean) =>
    onVisibilityChange?.(Object.fromEntries(types.map((t) => [t.type, visible && isAvailable(t)])));

  const toggle = (entry: ObjectTypePanelEntry, solo: boolean) => {
    if (!toggles) return;
    if (solo) {
      const onlyThis = types.every((t) => (t.type === entry.type) === isShown(t.type) || !isAvailable(t));
      if (onlyThis) setAll(true);
      else onVisibilityChange!(Object.fromEntries(types.map((t) => [t.type, t.type === entry.type])));
      return;
    }
    onVisibilityChange!({ ...visibility, [entry.type]: !isShown(entry.type) });
  };

  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  };

  if (collapsed) {
    const label =
      `${types.length} object type${types.length === 1 ? '' : 's'}` +
      (hiddenCount > 0 ? ` · ${hiddenCount} hidden` : '') +
      (pins && pinned ? ` · ${pinned} highlighted` : '');
    return (
      <button
        type="button"
        {...stop}
        onClick={() => onCollapsedChange(false)}
        title={`Show ${title.toLowerCase()}`}
        aria-label={`Show ${title.toLowerCase()}`}
        data-testid={testId}
        style={{ ...PANEL_SHELL, alignSelf: 'flex-start' }}
        className={PANEL_CHIP_CLASS}
      >
        <span className="flex -space-x-1">
          {types.slice(0, 4).map((t) => (
            <span
              key={t.type}
              className="h-2.5 w-2.5 rounded-full ring-1 ring-white"
              style={{ background: isShown(t.type) ? t.color : 'transparent', border: `1.5px solid ${t.color}` }}
            />
          ))}
        </span>
        <span className="tabular-nums">{label}</span>
        <ChevronDown className={PANEL_CHIP_CHEVRON_CLASS} />
      </button>
    );
  }

  return (
    // No height cap of its own: the container decides how far down it may grow
    // (e.g. to the view's bottom, or to just above the control pill), and
    // minHeight 0 lets it shrink to that, its list then scrolling. As wide as
    // its content (alignSelf: a column container would stretch it to its
    // widest item, e.g. a title above it).
    <div
      {...stop}
      data-testid={testId}
      style={{ ...PANEL_SHELL, minWidth: 220, maxWidth: 280, alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      <div className={PANEL_HEADER_CLASS}>
        <span className={PANEL_TITLE_CLASS}>
          {title}
          {hiddenCount > 0 && <span className="ml-1.5 font-normal text-slate-400">{hiddenCount} hidden</span>}
        </span>
        {(toggles || menuItems.length > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={ICON_BUTTON} title="More" aria-label={`${title} options`}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {toggles && (
                <>
                  <DropdownMenuItem onSelect={() => setAll(true)}>Show all</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAll(false)}>Hide all</DropdownMenuItem>
                </>
              )}
              {toggles && menuItems.length > 0 && <DropdownMenuSeparator />}
              {menuItems.map((item) => (
                <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          className={ICON_BUTTON}
          onClick={() => onCollapsedChange(true)}
          title={`Hide ${title.toLowerCase()}`}
          aria-label={`Hide ${title.toLowerCase()}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {searchable && (
        <div className="px-2 pt-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a type…"
            aria-label="Find an object type"
            className="h-7 w-full rounded-md border border-slate-200 bg-white/70 px-2 text-xs outline-none focus:border-slate-400"
          />
        </div>
      )}

      <div className="flex min-h-0 flex-col overflow-y-auto p-1.5">
        {listed.map((entry) => {
          const { type, color } = entry;
          const available = isAvailable(entry);
          const shown = isShown(type);
          const highlightable = canHighlight(entry);
          const isPinned = pins && pinned === type;
          // While a type is pinned, the others are greyed like hidden ones.
          const muted = pins && pinned != null && !isPinned;
          const detail = renderDetail?.(type) ?? null;
          const expanded = detail != null && open.has(type);
          const summary = detailSummary?.(type) ?? null;
          const label = (
            <>
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: shown && available ? color : 'transparent', border: `2px solid ${color}`, opacity: muted ? 0.4 : 1 }}
              />
              <span
                className={`truncate text-[13px] ${shown && available && !muted ? 'text-slate-700' : 'text-slate-400'} ${isPinned ? 'font-semibold' : ''}`}
              >
                {type}
              </span>
            </>
          );
          return (
            <div
              key={type}
              data-object-type={type}
              className={`rounded-md ${isPinned ? 'bg-slate-100' : highlightable || toggles ? 'hover:bg-slate-100/70' : ''}`}
              style={{ opacity: available ? 1 : 0.45 }}
              onMouseEnter={() => onHighlight && shown && highlightable && onHighlight(type)}
              onMouseLeave={() => onHighlight?.(null)}
            >
              <div className="flex min-h-8 items-center gap-1 pl-2 pr-1">
                {toggles ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shown}
                    aria-label={`Show ${type}`}
                    disabled={!available}
                    title={available ? `${shown ? 'Hide' : 'Show'} ${type} · Alt-click: only ${type}` : `${type}: nothing to show`}
                    onClick={(e) => toggle(entry, e.altKey)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left disabled:cursor-not-allowed"
                  >
                    {label}
                  </button>
                ) : pins && highlightable ? (
                  <button
                    type="button"
                    aria-pressed={isPinned}
                    aria-label={`Highlight ${type}`}
                    title={isPinned ? `Stop highlighting ${type}` : `Keep ${type} highlighted`}
                    onClick={() => onPinnedChange!(isPinned ? null : type)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left"
                  >
                    {label}
                  </button>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-2.5 py-1">{label}</span>
                )}
                {summary && (expanded || summary.active) && (
                  <span
                    className={`shrink-0 text-[11px] tabular-nums ${expanded ? 'font-medium text-slate-700' : 'text-slate-500'}`}
                  >
                    {summary.text}
                  </span>
                )}
                {detail != null && (
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    aria-label={`${expanded ? 'Fold' : 'Unfold'} ${type} settings`}
                    aria-expanded={expanded}
                    title={expanded ? 'Fold' : 'More for this type'}
                    onClick={() =>
                      setOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(type)) next.delete(type);
                        else next.add(type);
                        return next;
                      })
                    }
                  >
                    <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                  </button>
                )}
              </div>
              {/* Aligned with the type's name, up to the line's right edge. */}
              {expanded && <div className="pb-2.5 pl-[30px] pr-2.5 pt-0.5">{detail}</div>}
            </div>
          );
        })}
        {listed.length === 0 && <div className="px-2 py-1.5 text-xs text-slate-400">No type matches.</div>}
        {sections
          .filter((section) => section.entries.length > 0)
          .map((section) => (
            <div key={section.title} data-panel-section={section.title} className="mt-1 border-t border-slate-100 pt-1">
              <div className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-slate-500">{section.title}</div>
              {section.entries.map((entry) => (
                <div key={entry.key} className="flex min-h-8 items-center gap-2.5 pl-2 pr-1">
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={
                      entry.dashed
                        ? { border: `2px dashed ${entry.color}` }
                        : { background: entry.color, border: `2px solid ${entry.color}` }
                    }
                  />
                  <span className="truncate text-[13px] text-slate-700">{entry.label}</span>
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}

export default ObjectTypePanel;
