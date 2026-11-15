/**
 * Layout primitives shared by the two organizational mining explorers when
 * they run as dashboard widgets.
 *
 * The visual language is the one OCCNVisualizer established: a full-bleed
 * canvas that owns the whole tile, with every piece of chrome absolutely
 * positioned over it. Nothing sits in normal flow, so the graph always gets
 * the tile's full height no matter how the user resizes it.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  CANVAS_PANEL_SHELL,
  PANEL_CHIP_CHEVRON_CLASS,
  PANEL_CHIP_CLASS,
  PANEL_CHIP_ICON_CLASS,
} from "@/components/canvas/panelHeader";
import type { Size } from "./canvasGeometry";

/**
 * A `position: relative` box that fills its parent and reports its own size.
 *
 * Children render against the measured size; a zero measurement (the tile is
 * hidden, or GridStack has not sized the cell yet) is reported as-is so the
 * caller can hold off drawing rather than compute against a bogus box.
 */
export function CanvasShell({
  className = "",
  title,
  children,
}: {
  className?: string;
  /**
   * The card's title (with its filters), top left like on the DFG canvas.
   * Shown in every state (also before computing), so the filters stay reachable.
   * It sits below the explorer's panels (12–14), which cover it when opened.
   */
  title?: React.ReactNode;
  children: (size: Size) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    // data-canvas-shell: the box in which a graph's fit looks for the controls (data-fit-avoid).
    <div ref={ref} data-canvas-shell className={`relative w-full h-full min-h-0 overflow-hidden bg-background ${className}`}>
      {children(size)}
      {title && (
        <div
          data-testid="canvas-title"
          data-fit-avoid="header"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: "absolute", top: 16, left: 16, zIndex: 11, maxWidth: "calc(100% - 32px)" }}
        >
          {title}
        </div>
      )}
    </div>
  );
}

/** The frame of the canvas panels and chips, shared with the DFG's (components/canvas/panelHeader). */
const PANEL_SHELL: React.CSSProperties = CANVAS_PANEL_SHELL;

/**
 * A card floating over the canvas that collapses to a chip.
 *
 * Two collapsed shapes: an icon-only button for tool panels, or a labelled
 * chip with a chevron (`collapsedLabel`) for panels whose headline number is
 * worth reading without opening them. Expanded, both close with an ✕.
 *
 * `narrow` sets the initial state only — once the user has clicked, their
 * choice wins and a later resize will not overrule it. Without that, dragging
 * a tile across the breakpoint would keep reopening a panel the user closed.
 *
 * `plainHeading` swaps the small-caps title for the plain header of the
 * toolbar popovers (centrality, download): sentence case, no icon, a divider
 * below. The icon still marks the collapsed chip.
 */
export function FloatingPanel({
  title,
  icon,
  narrow,
  children,
  style,
  collapsedLabel,
  plainHeading = false,
}: {
  title: string;
  icon?: React.ReactNode;
  narrow: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** Chip text while collapsed, e.g. "4 object types". Omit for an icon-only chip. */
  collapsedLabel?: string;
  plainHeading?: boolean;
}) {
  // Without either an icon or a label the chip would be an empty button.
  const chipLabel = collapsedLabel ?? (icon ? null : title);
  const [open, setOpen] = useState(!narrow);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setOpen(!narrow);
  }, [narrow]);

  const toggle = () => {
    touched.current = true;
    setOpen((prev) => !prev);
  };

  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={`Show ${title}`}
        aria-label={`Show ${title}`}
        {...stop}
        // The size of the DFG's collapsed legend chip: 30 px tall, square with only an icon.
        style={{ ...PANEL_SHELL, ...style, cursor: "pointer" }}
        className={chipLabel != null ? PANEL_CHIP_CLASS : PANEL_CHIP_ICON_CLASS}
      >
        {icon}
        {chipLabel != null && (
          <>
            <span className="tabular-nums">{chipLabel}</span>
            <ChevronDown className={PANEL_CHIP_CHEVRON_CLASS} />
          </>
        )}
      </button>
    );
  }

  if (plainHeading) {
    return (
      <div
        {...stop}
        style={{
          ...PANEL_SHELL,
          maxHeight: "min(75%, 380px)",
          overflowY: "auto",
          minWidth: 132,
          ...style,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 8px", borderBottom: "1px solid #F1F5F9" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{title}</span>
          <button
            type="button"
            onClick={toggle}
            title={`Hide ${title}`}
            aria-label={`Hide ${title}`}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#64748b", display: "flex", alignItems: "center" }}
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>
        <div style={{ padding: "10px 14px" }}>{children}</div>
      </div>
    );
  }

  return (
    <div
      {...stop}
      style={{
        ...PANEL_SHELL,
        ...style,
        padding: "8px 12px 10px",
        maxHeight: "min(75%, 380px)",
        overflowY: "auto",
        minWidth: 132,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {icon}
        <span style={{ fontWeight: 700, fontSize: 11, color: "#0F172A", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
          {title}
        </span>
        <button
          type="button"
          onClick={toggle}
          title={`Hide ${title}`}
          aria-label={`Hide ${title}`}
          style={{
            marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
            padding: 0, paddingLeft: 8, color: "#94a3b8", display: "flex", alignItems: "center",
          }}
        >
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * A search as a chip: collapsed a square search icon, the size of the other
 * chips; opened it widens into a search field of the same height, with a ✕
 * to close it. In a right-anchored row it grows to the left. The field is
 * the caller's (`children`, given a `close`); its matches can drop below the
 * chip, which is their positioning box.
 */
export function CanvasSearchChip({
  label,
  width = 240,
  children,
}: {
  /** What is searched, e.g. "Find resource": the chip's name and title. */
  label: string;
  width?: number;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        {...stop}
        style={{ ...PANEL_SHELL, cursor: "pointer" }}
        className={PANEL_CHIP_ICON_CLASS}
      >
        <Search className="h-3.5 w-3.5 text-slate-500" />
      </button>
    );
  }
  return (
    <div {...stop} style={{ ...PANEL_SHELL, width }} className={`${PANEL_CHIP_CLASS} relative pr-1`}>
      <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      <div className="min-w-0 flex-1">{children(close)}</div>
      <button
        type="button"
        onClick={close}
        title={`Close ${label.toLowerCase()}`}
        aria-label={`Close ${label.toLowerCase()}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * A chip that opens a dropdown, styled like a collapsed FloatingPanel: the
 * current choice plus the same chevron, so a panel that expands and a chip
 * that opens a menu read as the same kind of control.
 */
export function CanvasSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  style,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Accessible name; the chip itself shows only the current choice. */
  label: string;
  style?: React.CSSProperties;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ ...PANEL_SHELL, ...style, cursor: "pointer" }}
          className={PANEL_CHIP_CLASS}
        >
          <span>{current?.label ?? value}</span>
          <ChevronDown className={PANEL_CHIP_CHEVRON_CLASS} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The rounded control bar, bottom right. It is the shared pill of all graph
 * canvases now (components/canvas/ControlPill); the explorers use it fixed,
 * since their popovers open at a fixed place above it.
 */
export { ControlPill } from "@/components/canvas/ControlPill";

/** Segmented control for the explorers' view modes, sized for the pill. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  compact = false,
}: {
  value: T;
  options: { value: T; label: string; short: string }[];
  onChange: (value: T) => void;
  compact?: boolean;
}) {
  return (
    <div style={{ display: "flex", border: "1px solid #E2E8F0", borderRadius: 9999, overflow: "hidden", height: 36 }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            title={option.label}
            style={{
              padding: compact ? "0 10px" : "0 14px",
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              border: "none",
              cursor: "pointer",
              background: active ? "#0F172A" : "transparent",
              color: active ? "#FFFFFF" : "#475569",
            }}
          >
            {compact ? option.short : option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Centred message over the canvas — empty states, errors, progress. */
export function CanvasMessage({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        textAlign: "center",
        fontFamily: "var(--font-primary, Inter, sans-serif)",
        fontSize: 14,
        color: tone === "error" ? "#B91C1C" : "#475569",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Collapsible list of key/value readouts (MDS stress, explained variance).
 * Collapsed it shows the first entry's value only, which is the one worth
 * seeing at a glance.
 */
export function MetricChips({
  metrics,
  narrow,
  style,
}: {
  metrics: { label: string; value: string; title?: string }[];
  narrow: boolean;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(!narrow);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setOpen(!narrow);
  }, [narrow]);

  const visible = useMemo(() => (open ? metrics : metrics.slice(0, 1)), [open, metrics]);
  if (metrics.length === 0) return null;

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      // The chip size of the collapsed panels and the select, so chips sharing
      // a row are all exactly the same height.
      style={{ ...PANEL_SHELL, ...style }}
      className={PANEL_CHIP_CLASS}
    >
      {visible.map((metric) => (
        <span key={metric.label} title={metric.title} style={{ whiteSpace: "nowrap", cursor: metric.title ? "help" : "default" }}>
          <span style={{ color: "#94a3b8", fontWeight: 400 }}>{metric.label} </span>
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{metric.value}</span>
        </span>
      ))}
      {metrics.length > 1 && (
        <button
          type="button"
          onClick={() => { touched.current = true; setOpen((prev) => !prev); }}
          aria-label={open ? "Hide metrics" : "Show all metrics"}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            color: "#94a3b8", display: "flex", alignItems: "center",
          }}
        >
          <ChevronDown style={{ width: 12, height: 12, transform: open ? "rotate(180deg)" : undefined }} />
        </button>
      )}
    </div>
  );
}
