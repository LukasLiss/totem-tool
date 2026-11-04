import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useFilterVersion, getEffectiveFilterConfig } from '@/store/filterStore';
import { isCancelledError } from '@/store/computationStore';
import ComputationStatus from '@/components/ComputationStatus';
import { GlobalFilterToggle } from '@/components/ui/GlobalFilterToggle';
import { LocalFilterDropdown } from '@/components/ui/LocalFilterDropdown';
import { VisualizerEmptyState } from '@/components/ui/VisualizerEmptyState';
import type { OcdfgGraph } from './NewOCDFGVisualizer';
import OcdfgView from './ocdfg-layout/OcdfgView';
import { fromBackendDfg } from './ocdfg-layout/graph';
import { DEFAULT_OPTIONS } from './ocdfg-layout/options';
import type { SaveLayout } from './ocdfg-layout/useLayoutOptions';

interface DfgData {
  dfg: OcdfgGraph;
  /** Per-type total variant count — used to seed slider maxima. */
  variant_counts?: Record<string, number>;
}

interface NewOCDFGVariantsVisualizerProps {
  height?: string | number;
  data?: OcdfgGraph;
  fileId?: number;
  variant?: 'full' | 'canvas' | 'detail';
  /** Default flow direction; the layout panel can change it. */
  layoutDirection?: 'TB' | 'LR';
  instanceId?: string;
  typeColorOverrides?: Record<string, string>;
  onSizeChange?: (size: { width: number; height: number }) => void;
  showControls?: boolean;
  initialInteractionLocked?: boolean;
  filterEnabled?: boolean;
  onToggleFilter?: () => void;
  showTitle?: boolean;
  localFilterParams?: Record<string, string>;
  onLocalFilterChange?: (params: Record<string, string>) => void;
  /** Stored layout preferences (undefined while loading) and how to store them. */
  storedLayout?: unknown;
  onLayoutChange?: SaveLayout;
  layoutScope?: string;
}

/**
 * Object-centric directly-follows graph with a per-type slider for the
 * number of variants whose arcs are shown (filtered client-side by the
 * `variant_rank` the backend puts on every arc). Laid out with the OC-DFG
 * layout; the layout button of the toolbar opens its settings.
 */
function NewOCDFGVariantsVisualizer({
  height = 'calc(100vh - 50px)',
  data,
  fileId,
  variant = 'full',
  layoutDirection = 'TB',
  typeColorOverrides,
  onSizeChange,
  showControls = true,
  initialInteractionLocked = true,
  filterEnabled = true,
  onToggleFilter = () => {},
  showTitle = true,
  localFilterParams,
  onLocalFilterChange,
  storedLayout,
  onLayoutChange,
  layoutScope,
}: NewOCDFGVariantsVisualizerProps) {
  const filterVersion = useFilterVersion();
  const effectiveFilterVersion = filterEnabled ? filterVersion : 0;
  const [internalLocalParams, setInternalLocalParams] = useState<Record<string, string>>({});
  const effectiveLocalParams = localFilterParams ?? internalLocalParams;
  const [payload, setPayload] = useState<DfgData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (data) {
      setPayload({ dfg: data });
      return;
    }
    if (!fileId) {
      setPayload({ dfg: { nodes: [], links: [] } });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const filterConfig = getEffectiveFilterConfig(
      Object.keys(effectiveLocalParams).length > 0 ? effectiveLocalParams : undefined,
      filterEnabled,
    );
    if (filterConfig._noResults) {
      setPayload({ dfg: { nodes: [], links: [] } });
      return;
    }
    setLoading(true);
    axios
      .get<DfgData>(`/api/new-ocdfg/?file_id=${fileId}`, { ...filterConfig, signal: controller.signal })
      .then(({ data: body }) => {
        if (!cancelled) setPayload({ dfg: body?.dfg ?? { nodes: [], links: [] }, variant_counts: body?.variant_counts });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isCancelledError(err)) toast.info('OC-DFG computation cancelled');
        else toast.error('OC-DFG variants could not be loaded');
        setPayload({ dfg: { nodes: [], links: [] } });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [data, fileId, filterEnabled, effectiveFilterVersion, effectiveLocalParams]);

  const graph = useMemo(
    () => (payload ? fromBackendDfg(payload.dfg as Parameters<typeof fromBackendDfg>[0], payload.variant_counts) : null),
    [payload],
  );
  const layoutDefaults = useMemo(() => ({ ...DEFAULT_OPTIONS, direction: layoutDirection }), [layoutDirection]);
  const detail = variant === 'detail';
  const noEventLog = data == null && !fileId;

  const title = showTitle ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--foreground)' }}>Object-Centric DFG (Variants)</div>
      <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={onToggleFilter} stopPropagation />
      <LocalFilterDropdown fileId={fileId} onFilterChange={onLocalFilterChange ?? setInternalLocalParams} stopPropagation />
    </div>
  ) : undefined;

  return (
    <OcdfgView
      graph={graph}
      height={height}
      sliderMode="variants"
      variant={detail ? 'detail' : 'full'}
      title={title}
      showControls={showControls}
      initialInteractionLocked={initialInteractionLocked}
      fileId={data == null ? fileId : undefined}
      filterEnabled={filterEnabled}
      localFilterParams={Object.keys(effectiveLocalParams).length > 0 ? effectiveLocalParams : undefined}
      canSaveAsset={data == null}
      typeColorOverrides={typeColorOverrides}
      layoutDefaults={layoutDefaults}
      storedLayout={storedLayout}
      saveLayout={onLayoutChange}
      layoutScope={layoutScope}
      layoutEditable={!detail}
      onSizeChange={onSizeChange}
    >
      {loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/60 backdrop-blur-sm">
          <ComputationStatus
            fileId={fileId}
            urlIncludes="/new-ocdfg/"
            fallback={
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-5 py-3 shadow-lg">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm font-medium text-slate-700">Computing directly-follows graph…</span>
              </div>
            }
          />
        </div>
      )}
      {noEventLog && (
        <VisualizerEmptyState label="Object-Centric DFG" message="Select an event log to discover its directly-follows graph." />
      )}
    </OcdfgView>
  );
}

export default NewOCDFGVariantsVisualizer;
