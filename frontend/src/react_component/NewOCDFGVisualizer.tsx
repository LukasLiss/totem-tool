import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useFilterVersion, getEffectiveFilterConfig } from '@/store/filterStore';
import { isCancelledError } from '@/store/computationStore';
import ComputationStatus from '@/components/ComputationStatus';
import { VisualizerEmptyState } from '@/components/ui/VisualizerEmptyState';
import OcdfgView from './ocdfg-layout/OcdfgView';
import { fromBackendDfg } from './ocdfg-layout/graph';
import { DEFAULT_OPTIONS } from './ocdfg-layout/options';
import type { SaveLayout } from './ocdfg-layout/useLayoutOptions';

export type DfgNode = {
  id: string;
  label: string;
  types?: string[];
  metrics?: { frequency?: number; avg_lead_time?: number | null } | null;
};

export type DfgLink = {
  source: string;
  target: string;
  key?: string;
  objtype?: string;
  weight?: number;
  variant_rank?: number;
  metrics?: { frequency?: number; avg_lead_time?: number | null } | null;
};

export type OcdfgGraph = {
  nodes: DfgNode[];
  links: DfgLink[];
};

interface TraceVariantEntry {
  trace: string[];
  count: number;
  objects?: string[];
}
interface TraceVariantsForType {
  variants: TraceVariantEntry[];
  total_objects: number;
}
export type TraceVariantsMap = Record<string, TraceVariantsForType>;

interface DfgData {
  dfg: OcdfgGraph;
  trace_variants?: TraceVariantsMap;
}

interface NewOCDFGVisualizerProps {
  height?: string | number;
  data?: OcdfgGraph;
  fileId?: number;
  /** `detail`: graph only, sized by its content (process-area drill-downs). */
  variant?: 'full' | 'canvas' | 'detail';
  /** Default flow direction; the layout panel can change it. */
  layoutDirection?: 'TB' | 'LR';
  instanceId?: string;
  typeColorOverrides?: Record<string, string>;
  onSizeChange?: (size: { width: number; height: number }) => void;
  showControls?: boolean;
  initialInteractionLocked?: boolean;
  filterEnabled?: boolean;
  localFilterParams?: Record<string, string>;
  /** Stored layout preferences (undefined while loading) and how to store them. */
  storedLayout?: unknown;
  onLayoutChange?: SaveLayout;
  layoutScope?: string;
}

/**
 * Object-centric directly-follows graph with a per-type minimum arc weight.
 * Laid out with the OC-DFG layout (see ocdfg-layout/layout.ts); the layout
 * button of the toolbar opens its settings.
 */
function NewOCDFGVisualizer({
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
  localFilterParams,
  storedLayout,
  onLayoutChange,
  layoutScope,
}: NewOCDFGVisualizerProps) {
  const filterVersion = useFilterVersion();
  const effectiveFilterVersion = filterEnabled ? filterVersion : 0;
  const [dfgData, setDfgData] = useState<OcdfgGraph | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (data) {
      setDfgData(data);
      return;
    }
    if (!fileId) {
      setDfgData({ nodes: [], links: [] });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const filterConfig = getEffectiveFilterConfig(localFilterParams, filterEnabled);
    if (filterConfig._noResults) {
      setDfgData({ nodes: [], links: [] });
      return;
    }
    setLoading(true);
    axios
      .get<DfgData>(`/api/new-ocdfg/?file_id=${fileId}`, { ...filterConfig, signal: controller.signal })
      .then(({ data: payload }) => {
        if (!cancelled) setDfgData(payload?.dfg ?? { nodes: [], links: [] });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isCancelledError(err)) toast.info('OC-DFG computation cancelled');
        else toast.error('OC-DFG could not be loaded');
        setDfgData({ nodes: [], links: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Leaving the page or changing the filter stops the running computation
    // on the backend as well, so it does not block the next request.
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [data, fileId, filterEnabled, effectiveFilterVersion, localFilterParams]);

  const graph = useMemo(() => (dfgData ? fromBackendDfg(dfgData as Parameters<typeof fromBackendDfg>[0]) : null), [dfgData]);
  const layoutDefaults = useMemo(() => ({ ...DEFAULT_OPTIONS, direction: layoutDirection }), [layoutDirection]);
  const detail = variant === 'detail';
  const noEventLog = data == null && !fileId;

  return (
    <OcdfgView
      graph={graph}
      height={height}
      sliderMode="weight"
      variant={detail ? 'detail' : 'full'}
      title={<div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>Object-Centric DFG (Arc Weight)</div>}
      showControls={showControls}
      initialInteractionLocked={initialInteractionLocked}
      fileId={data == null ? fileId : undefined}
      filterEnabled={filterEnabled}
      localFilterParams={localFilterParams}
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

export default NewOCDFGVisualizer;
