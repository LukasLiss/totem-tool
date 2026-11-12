/**
 * The body of the OC-DFG visualizers (arc weight and variants): legend with
 * a switch and a slider per object type, toolbar, and the graph drawn with
 * the OC-DFG layout (layout.ts) instead of a generic graph layout.
 *
 * The toolbar's layout button opens the layout panel; its options are kept
 * by `useLayoutOptions` where the caller stores them (dashboard widget or
 * project). The `detail` variant (process-area drill-downs) shows only the
 * graph and reports its size so the surrounding box can follow it.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LockIcon, MinusIcon, PlusIcon, ScanIcon, SlidersHorizontal, UnlockIcon, ZapIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import SaveModelAssetButton from '@/components/SaveModelAssetDialog';
import { ControlPill, type PillRegion, type PillSpot } from '@/components/canvas/ControlPill';
import { roomBelowForPill } from '@/components/canvas/pillSpots';
import { ObjectTypePanel } from '@/components/canvas/ObjectTypePanel';
import { mapTypesToColors } from '@/utils/objectColors';
import OcdfgLayoutStatusCard from '../OcdfgLayoutStatusCard';
import Gallery from './Gallery';
import { subgraph } from './graph';
import LabCanvas, { type LabCanvasHandle } from './LabCanvas';
import LayoutPanel from './LayoutPanel';
import { computeLayout } from './layout';
import { LAYOUT_PANEL_WIDTH, MAX_AUTO_LAYOUT_ARCS, type Aspect } from './options';
import type { LabGraph, LayoutOptions, LayoutResult } from './types';
import { useLayoutExtras } from './useLayoutExtras';
import { useLayoutOptions, type SaveLayout } from './useLayoutOptions';
import AnimationPanel from './AnimationPanel';
import { useOcdfgFlows } from './useOcdfgFlows';

/** Screen space the legend column takes on the left of the canvas. */
const LEGEND_ROOM = 360;
const LEGEND_AUTO_COLLAPSE_WIDTH = 480;
const DETAIL_PADDING = 16;
/** How far the legend column reaches from the left edge: its 16 px offset plus the panel's widest 320 px. */
const LEGEND_PANEL_REACH = 16 + 320;
/** Free places for the control pill: the legend holds the top left, the animation panel the top right. */
const OCDFG_PILL_SPOTS: readonly PillSpot[] = ['bottom-left', 'bottom-right', 'left', 'right'];

export interface OcdfgViewProps {
  /** The full graph; null while there is none (yet). */
  graph: LabGraph | null;
  height?: string | number;
  /** Per-type slider of the legend: minimum arc weight, or number of variants. */
  sliderMode: 'weight' | 'variants';
  variant?: 'full' | 'detail';
  /** Shown above the legend (title, filter controls). */
  title?: ReactNode;
  showControls?: boolean;
  initialInteractionLocked?: boolean;
  /** The event log, for "save to assets" and the layouts that need the log. */
  fileId?: number;
  filterEnabled?: boolean;
  localFilterParams?: Record<string, string>;
  canSaveAsset?: boolean;
  typeColorOverrides?: Record<string, string>;
  /** Defaults of this view's layout ("Reset to defaults" returns to them). */
  layoutDefaults: LayoutOptions;
  /** Stored layout entry (undefined while it loads) and how to store a new one. */
  storedLayout?: unknown;
  saveLayout?: SaveLayout;
  layoutScope?: string;
  /** Show the layout button and panel. */
  layoutEditable?: boolean;
  onSizeChange?: (size: { width: number; height: number }) => void;
  /** Overlays (loading, empty state) drawn above the canvas. */
  children?: ReactNode;
}

function resolveHeight(height: string | number) {
  return typeof height === 'number' ? `${height}px` : height;
}

export default function OcdfgView({
  graph,
  height = 'calc(100vh - 50px)',
  sliderMode,
  variant = 'full',
  title,
  showControls = true,
  initialInteractionLocked = true,
  fileId,
  filterEnabled = true,
  localFilterParams,
  canSaveAsset = false,
  typeColorOverrides,
  layoutDefaults,
  storedLayout,
  saveLayout,
  layoutScope,
  layoutEditable = true,
  onSizeChange,
  children,
}: OcdfgViewProps) {
  const detail = variant === 'detail';
  const chrome = !detail && showControls;
  const canvasRef = useRef<LabCanvasHandle>(null);

  // --- layout options -------------------------------------------------------
  const { options, update, reset } = useLayoutOptions(layoutDefaults, storedLayout, saveLayout, layoutScope);
  const deferredOptions = useDeferredValue(options);
  const [panelOpen, setPanelOpen] = useState(false);
  const [galleryAspect, setGalleryAspect] = useState<Aspect | null>(null);
  const editable = chrome && layoutEditable;
  const { extras, trees, areas } = useLayoutExtras({
    fileId,
    filterEnabled,
    localFilterParams,
    enabled: editable && !!fileId,
    blockDetection: deferredOptions.blockDetection,
    laneOrder: deferredOptions.laneOrder,
  });

  // --- legend: object types and their sliders -------------------------------
  const types = useMemo(() => graph?.types ?? [], [graph]);
  const colors = useMemo(() => mapTypesToColors(types, typeColorOverrides), [types, typeColorOverrides]);
  const available = useMemo(() => new Set((graph?.arcs ?? []).map((a) => a.type)), [graph]);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const sliderMax = useMemo(() => {
    const max: Record<string, number> = {};
    if (!graph) return max;
    if (sliderMode === 'variants') {
      for (const t of types) if (graph.variantCounts?.[t]) max[t] = graph.variantCounts[t];
    } else {
      for (const a of graph.arcs) max[a.type] = Math.max(max[a.type] ?? 0, a.weight);
    }
    return max;
  }, [graph, types, sliderMode]);
  const [sliderValue, setSliderValue] = useState<Record<string, number>>({});
  // New data: unknown types start visible, sliders start fully open.
  useEffect(() => {
    setVisibility((prev) => {
      const next: Record<string, boolean> = {};
      for (const t of types) next[t] = available.has(t) ? prev[t] !== false : false;
      return next;
    });
    setSliderValue((prev) => {
      const next: Record<string, number> = {};
      for (const t of types) {
        const max = sliderMax[t];
        if (max === undefined) continue;
        const open = sliderMode === 'variants' ? max : 0;
        next[t] = prev[t] === undefined ? open : Math.min(prev[t], max);
      }
      return next;
    });
  }, [types, available, sliderMax, sliderMode]);

  const visibleGraph = useMemo(() => {
    if (!graph) return null;
    return subgraph(graph, (a) => {
      if (visibility[a.type] === false) return false;
      const limit = sliderValue[a.type];
      if (limit === undefined) return true;
      if (sliderMode === 'weight') return a.weight >= limit;
      // Variant rank 0 (or none) marks start/end connectors: always shown.
      return !a.variantRank || a.variantRank <= limit;
    });
  }, [graph, visibility, sliderValue, sliderMode]);

  // --- layout -----------------------------------------------------------------
  const arcCount = visibleGraph?.arcs.length ?? 0;
  const [approvedGraph, setApprovedGraph] = useState<LabGraph | null>(null);
  const held = arcCount > MAX_AUTO_LAYOUT_ARCS && approvedGraph !== graph;
  const layout = useMemo((): { result: LayoutResult | null; error?: string } => {
    if (!visibleGraph || held) return { result: null };
    try {
      return { result: computeLayout(visibleGraph, deferredOptions, extras) };
    } catch (e) {
      console.error('OC-DFG layout failed', e);
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [visibleGraph, held, deferredOptions, extras]);
  const result = layout.result;

  // The drill-down boxes take their size from the graph.
  const onSizeChangeRef = useRef(onSizeChange);
  onSizeChangeRef.current = onSizeChange;
  const lastSize = useRef<string>('');
  useEffect(() => {
    if (!onSizeChangeRef.current || !result || result.nodes.length === 0) return;
    const b = result.bounds;
    const size = {
      width: Math.ceil(b.maxX - b.minX + 2 * DETAIL_PADDING),
      height: Math.ceil(b.maxY - b.minY + 2 * DETAIL_PADDING),
    };
    const key = `${size.width}x${size.height}`;
    if (key === lastSize.current) return;
    lastSize.current = key;
    onSizeChangeRef.current(size);
  }, [result]);

  // --- toolbar state ----------------------------------------------------------
  const [locked, setLocked] = useState(initialInteractionLocked);
  const [animate, setAnimate] = useState(false);
  // Where the control pill sits, so the legend (left) and the animation panel
  // (right) end above it instead of running underneath.
  const [pillRegion, setPillRegion] = useState<PillRegion | null>(null);
  const legendRoomBelow = roomBelowForPill(pillRegion, true, { reach: LEGEND_PANEL_REACH });

  // --- token animation: objects replaying the log on their arcs ---------------
  // Its steps are only loaded while it is switched on.
  const canAnimateTokens = chrome && fileId != null;
  const [tokensOn, setTokensOn] = useState(false);
  const tokenLayer = useRef<SVGGElement | null>(null);
  const flows = useOcdfgFlows({
    enabled: tokensOn && canAnimateTokens,
    fileId,
    filterEnabled,
    localFilterParams,
    variantRanks: sliderMode === 'variants',
  });
  // null = not chosen by the user yet; the default then follows the width.
  const [legendCollapsedChoice, setLegendCollapsed] = useState<boolean | null>(null);
  const [hoverType, setHoverType] = useState<string | null>(null);

  // --- per-type filter, folded into the object type panel ----------------------
  /** The legend slider's value of a type; fully open (no filter) when untouched. */
  const sliderOf = (type: string) => sliderValue[type] ?? (sliderMode === 'variants' ? sliderMax[type] : 0);
  const renderTypeFilter = (type: string) => {
    const max = sliderMax[type];
    if (max === undefined || max <= 0) return null;
    const value = sliderOf(type);
    // Thin and in the type's colour; its value sits on the type's line (typeFilterSummary).
    // The coloured part is what stays: above the minimum weight, or the variants up to the thumb.
    // (Class names written out in full, so Tailwind finds them.)
    const colouring =
      sliderMode === 'weight'
        ? '[&_[data-slot=slider-track]]:bg-(--type-color) [&_[data-slot=slider-range]]:bg-slate-200'
        : '[&_[data-slot=slider-track]]:bg-slate-200 [&_[data-slot=slider-range]]:bg-(--type-color)';
    return (
      <Slider
        min={0}
        max={max}
        step={1}
        value={[value]}
        onValueChange={(values) => setSliderValue((prev) => ({ ...prev, [type]: values?.[0] ?? 0 }))}
        disabled={!available.has(type)}
        inverted={sliderMode === 'weight'}
        thumbAriaLabel={sliderMode === 'weight' ? `Minimum arc weight of ${type}` : `Variants of ${type}`}
        className={`${colouring} [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-(--type-color)`}
        style={{ '--type-color': colors[type] ?? '#64748b' } as React.CSSProperties}
      />
    );
  };
  /** The type's filter value for its line; `active` when it filters something. */
  const typeFilterSummary = (type: string) => {
    const max = sliderMax[type];
    if (max === undefined || max <= 0) return null;
    const value = sliderOf(type);
    return sliderMode === 'weight'
      ? { text: `≥ ${value}`, active: value > 0 }
      : { text: `${value}/${max}`, active: value < max };
  };
  const resetTypeFilters = useCallback(
    () =>
      setSliderValue(() => {
        const next: Record<string, number> = {};
        for (const [type, max] of Object.entries(sliderMax)) next[type] = sliderMode === 'variants' ? max : 0;
        return next;
      }),
    [sliderMax, sliderMode],
  );
  const anyTypeVisible = Object.values(visibility).some(Boolean);
  const hasActivities = (visibleGraph?.nodes ?? []).some((n) => n.kind === 'activity');
  const noActivitiesMessage =
    graph && graph.nodes.length > 0 && anyTypeVisible && !hasActivities && !held
      ? 'All activities are displayed in lower levels.'
      : null;

  const notes = [
    ...(result?.notes ?? []),
    ...(trees.status === 'loading' ? ['Running the inductive miner…'] : []),
    ...(trees.status === 'error' ? [`Inductive miner: ${trees.message}`] : []),
    ...(areas.status === 'loading' ? ['Computing the process areas…'] : []),
    ...(areas.status === 'error' ? [`Process areas: ${areas.message}`] : []),
  ];

  // Keep the graph clear of the legend and the layout panel when there is
  // room for that; in narrow boxes (dashboard widgets) they overlay it.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Phone-sized boxes: the open legend would cover the whole graph, so it
  // starts collapsed there until the user expands it.
  const legendCollapsed = legendCollapsedChoice ?? (width > 0 && width < LEGEND_AUTO_COLLAPSE_WIDTH);
  const legendRoom = chrome && !legendCollapsed && width >= 2.5 * LEGEND_ROOM ? LEGEND_ROOM : 24;
  const panelRoom = editable && panelOpen && width - legendRoom >= 2 * LAYOUT_PANEL_WIDTH ? LAYOUT_PANEL_WIDTH + 36 : 24;
  // Where there is no room beside the legend, the title and the collapsed
  // legend sit stacked in the top-left corner; start the graph below them.
  // (The control pill is a movable ControlPill of its own, bottom left by default.)
  const stackedChromeRoom =
    chrome && legendCollapsed && width > 0 && width < LEGEND_AUTO_COLLAPSE_WIDTH ? 136 : 24;
  const fitPadding = detail
    ? { top: 4, right: 4, bottom: 4, left: 4 }
    : { top: stackedChromeRoom, bottom: 24, left: legendRoom, right: panelRoom };
  const fitKey = `${options.direction}|${types.join(',')}`;

  return (
    <div
      ref={wrapRef}
      style={{ height: resolveHeight(height), width: '100%', position: 'relative', overflow: 'hidden', background: '#fff' }}
      data-testid="ocdfg-view"
    >
      {result && result.nodes.length > 0 && (
        <LabCanvas
          ref={canvasRef}
          result={result}
          options={deferredOptions}
          colors={colors}
          panZoom={!detail && !locked}
          animate={animate}
          tokenLayerRef={tokensOn && canAnimateTokens ? tokenLayer : undefined}
          dimArcs={tokensOn && canAnimateTokens && flows.status === 'ready' && flows.tokens.count > 0}
          fitPadding={fitPadding}
          maxFitScale={detail ? 1 : 1.4}
          fitKey={fitKey}
          highlightType={hoverType}
        />
      )}

      {children}

      {layout.error && (
        <div className="absolute inset-x-0 top-1/2 z-10 text-center text-sm text-red-600">The layout failed: {layout.error}</div>
      )}

      {noActivitiesMessage && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255, 255, 255, 0.96)',
            color: '#64748B',
            fontFamily: 'var(--font-primary, Inter, sans-serif)',
            fontSize: 12,
            fontWeight: 500,
            textAlign: 'center',
            padding: 24,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          {noActivitiesMessage}
        </div>
      )}

      {held && (
        <OcdfgLayoutStatusCard
          state="held"
          nodes={visibleGraph?.nodes.length ?? 0}
          arcs={arcCount}
          hint={
            chrome
              ? sliderMode === 'weight'
                ? 'Hide object types or raise Min Weight in the legend for a smaller graph.'
                : 'Hide object types or lower the variant sliders in the legend for a smaller graph.'
              : undefined
          }
          compact={detail}
          graphShown={false}
          onCancel={() => undefined}
          onStart={() => setApprovedGraph(graph)}
        />
      )}

      {chrome && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxHeight: `calc(100% - ${16 + legendRoomBelow}px)`,
            zIndex: 15,
          }}
        >
          {title && (
            <div
              style={{
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: 12,
                padding: '10px 14px',
                fontFamily: 'var(--font-primary, Inter, sans-serif)',
                minWidth: 240,
              }}
            >
              {title}
            </div>
          )}

          {types.length > 0 && (
            <ObjectTypePanel
              testId="ocdfg-legend"
              types={types.map((type) => ({ type, color: colors[type], available: available.has(type) }))}
              visibility={visibility}
              onVisibilityChange={setVisibility}
              onHighlight={setHoverType}
              renderDetail={renderTypeFilter}
              detailSummary={typeFilterSummary}
              menuItems={[{ label: sliderMode === 'weight' ? 'Reset min. weights' : 'Reset variant filters', onSelect: resetTypeFilters }]}
              collapsed={legendCollapsed}
              onCollapsedChange={setLegendCollapsed}
            />
          )}

        </div>
      )}

      {chrome && (
        // The legend holds the top-left corner and the animation panel the top right.
        <ControlPill
          spots={OCDFG_PILL_SPOTS}
          storageKey={`ocdfg:${layoutScope ?? 'default'}`}
          onRegionChange={setPillRegion}
        >
            <Button type="button" variant="outline" size="icon" onClick={() => canvasRef.current?.zoom(1 / 1.25)} className="rounded-full h-9 w-9" title="Zoom in">
              <PlusIcon className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={() => canvasRef.current?.zoom(1.25)} className="rounded-full h-9 w-9" title="Zoom out">
              <MinusIcon className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={() => canvasRef.current?.fit()} className="rounded-full h-9 w-9" title="Fit to view">
              <ScanIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={locked ? 'secondary' : 'outline'}
              size="icon"
              onClick={() => setLocked((prev) => !prev)}
              className="rounded-full h-9 w-9"
              title={locked ? 'Unlock interactions' : 'Lock interactions'}
            >
              {locked ? <UnlockIcon className="h-4 w-4" /> : <LockIcon className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant={animate ? 'secondary' : 'outline'}
              size="icon"
              onClick={() => setAnimate((prev) => !prev)}
              className="rounded-full h-9 w-9"
              title={animate ? 'Disable edge animation' : 'Enable edge animation'}
            >
              <ZapIcon className="h-4 w-4" />
            </Button>
            {editable && (
              <Button
                type="button"
                variant={panelOpen ? 'secondary' : 'outline'}
                size="icon"
                onClick={() => setPanelOpen((prev) => !prev)}
                className="rounded-full h-9 w-9"
                title={panelOpen ? 'Close the layout settings' : 'Change the layout'}
                aria-label="Change the layout"
                aria-pressed={panelOpen}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            )}
            {canSaveAsset && fileId != null && (
              <SaveModelAssetButton
                fileId={fileId}
                filterEnabled={filterEnabled}
                modelType="OCDFG"
                disabled={graph == null}
                iconOnly
                className="rounded-full h-9 w-9"
              />
            )}
        </ControlPill>
      )}

      {canAnimateTokens && (
        <AnimationPanel
          // Always starts collapsed to its chip, whatever the size (like the handover's).
          narrow
          pillRegion={pillRegion}
          active={tokensOn}
          onStart={() => setTokensOn(true)}
          onStop={() => setTokensOn(false)}
          state={flows}
          layer={tokenLayer}
          result={result}
          colors={colors}
          variantLimit={sliderMode === 'variants' ? sliderValue : undefined}
        />
      )}

      {editable && panelOpen && (
        <LayoutPanel
          options={options}
          defaults={layoutDefaults}
          onChange={update}
          onReset={reset}
          onClose={() => setPanelOpen(false)}
          onGallery={visibleGraph ? setGalleryAspect : undefined}
          laneOrder={result?.laneOrder ?? []}
          colors={colors}
          metrics={result?.metrics}
          notes={notes}
        />
      )}

      {galleryAspect && visibleGraph && (
        <Gallery
          graph={visibleGraph}
          extras={extras}
          options={options}
          colors={colors}
          aspect={galleryAspect}
          onPick={update}
          onClose={() => setGalleryAspect(null)}
        />
      )}
    </div>
  );
}
