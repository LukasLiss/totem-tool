import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

import { GlobalFilterToggle } from '@/components/ui/GlobalFilterToggle';
import { LocalFilterDropdown } from '@/components/ui/LocalFilterDropdown';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Layers, Pencil, RefreshCcw, Save, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import TotemVisualizer, {
  type ProcessAreaDiscoveryInfo,
  type TotemVisualizerControls,
} from './TotemVisualizer';
import { SelectedFileContext } from '@/contexts/SelectedFileContext';
import { extractAssetApiError } from '@/api/assetsApi';
import { createProcessAreaAsset, updateProcessAreaAsset } from '@/api/processAreaAssetsApi';
import { useProcessAreaAssets, useProcessAreaAssetsStore } from '@/store/processAreaAssetsStore';
import { useProcessAreaStore } from '@/store/processAreaStore';
import { mapTypesToColors } from '@/utils/objectColors';
import { ProcessAreaEditor } from './process-area/ProcessAreaEditor';
import {
  compositionFromLayers,
  compositionToLayers,
  fromAssetContent,
  hasBlockingProblems,
  type ProcessAreaComposition,
} from './process-area/composition';
import { discoveredSnapshotAreas } from './variants/variantsApi';
import {
  PROCESS_AREA_ALGORITHM_LABELS,
  PROCESS_AREA_PARAM_RANGES,
  type ProcessAreaAlgorithm,
  type ProcessAreaParams,
} from './processAreaParams';

export type { TotemVisualizerControls } from './TotemVisualizer';

/**
 * The five tunables of the advanced algorithm.
 *
 * `alpha` and `beta` are labelled by what they do rather than by their symbol:
 * alpha decides how hard resources are pushed above the types they serve,
 * beta how hard related types are pulled onto the same layer. Both are shown
 * with their symbol so the panel maps onto the thesis.
 */
const PARAM_CONTROLS: Array<{
  key: keyof ProcessAreaParams;
  label: string;
  hint: string;
}> = [
  { key: 'wTemporal', label: 'Temporal', hint: 'Resources outlive what they serve' },
  { key: 'wCardinality', label: 'Cardinality', hint: 'Resources serve varying numbers of objects' },
  { key: 'wDivergence', label: 'Divergence', hint: 'Resources are swapped out between executions' },
  { key: 'alpha', label: 'Separation (α)', hint: 'How strongly resources are pushed upwards' },
  { key: 'beta', label: 'Cohesion (β)', hint: 'How strongly related types are pulled together' },
];

export type ProcessAreaProps = {
  fileId?: number | string | null;
  embedded?: boolean;
  backendBaseUrl?: string;
  height?: string | number;
  /** Persisted dashboard settings, if this instance lives in a dashboard. */
  initialAlgorithm?: ProcessAreaAlgorithm;
  initialParams?: Partial<ProcessAreaParams>;
  onSettingsChange?: (settings: {
    algorithm: ProcessAreaAlgorithm;
    params: ProcessAreaParams;
  }) => void;
  /** Stored composition (PROCESS_AREAS asset) to show instead of the discovery. */
  initialCompositionAssetId?: number | null;
  /** Fired when the user switches between the discovery and a stored composition. */
  onCompositionAssetChange?: (assetId: number | null) => void;
};

const DISCOVERED = '__discovered__';
const UNSAVED = '__unsaved__';

/** "Process areas", "Process areas 2", … — the first name no stored asset has. */
function freshCompositionName(taken: string[]): string {
  const names = new Set(taken.map((n) => n.toLocaleLowerCase()));
  if (!names.has('process areas')) return 'Process areas';
  let n = 2;
  while (names.has(`process areas ${n}`)) n += 1;
  return `Process areas ${n}`;
}

import { API_BASE_URL } from '../config/api';

export default function ProcessArea({
  fileId,
  embedded = false,
  backendBaseUrl = API_BASE_URL,
  height = 600,
  initialAlgorithm,
  initialParams,
  onSettingsChange,
  initialCompositionAssetId,
  onCompositionAssetChange,
}: ProcessAreaProps) {
  const [totemControls, setTotemControls] = useState<TotemVisualizerControls | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [localFilterParams, setLocalFilterParams] = useState<Record<string, string>>({});

  // ---- compositions ------------------------------------------------------
  const { selectedFile } = useContext(SelectedFileContext);
  const projectId = selectedFile?.project ?? null;
  const storedAssets = useProcessAreaAssets(projectId);
  const upsertAsset = useProcessAreaAssetsStore((state) => state.upsert);
  const [discovery, setDiscovery] = useState<ProcessAreaDiscoveryInfo | null>(null);
  /** Shown instead of the discovered areas; null shows the discovery. */
  const [composition, setComposition] = useState<ProcessAreaComposition | null>(null);
  /** Applied edits that are not stored in the project assets yet. */
  const [dirty, setDirty] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const numericFileId = Number(fileId);
  const validFileId = Number.isFinite(numericFileId) && numericFileId > 0 ? numericFileId : null;
  const activeAssetId = composition?.source?.kind === 'asset' ? composition.source.assetId ?? null : null;

  const handleDiscoveryLoaded = useCallback((info: ProcessAreaDiscoveryInfo) => {
    setDiscovery(info);
  }, []);

  // A different log: start from its discovery again unless a stored
  // composition is pinned (dashboards).
  const lastFileRef = useRef(validFileId);
  useEffect(() => {
    if (lastFileRef.current === validFileId) return;
    lastFileRef.current = validFileId;
    setDiscovery(null);
    if (!activeAssetId) {
      setComposition(null);
      setDirty(false);
    }
  }, [validFileId, activeAssetId]);

  const loadAsset = useCallback(
    (assetId: number) => {
      const asset = storedAssets.assets.find((a) => a.id === assetId);
      if (!asset) return false;
      setComposition(
        fromAssetContent(asset.content_json, {
          name: asset.name,
          assetId: asset.id,
          allObjectTypes: discovery?.allObjectTypes,
        }),
      );
      setDirty(false);
      return true;
    },
    [storedAssets.assets, discovery?.allObjectTypes],
  );

  // Open the persisted / deep-linked composition once the assets are known.
  const seededAssetRef = useRef<number | null>(null);
  useEffect(() => {
    if (!initialCompositionAssetId || seededAssetRef.current === initialCompositionAssetId) return;
    if (!storedAssets.loaded) return;
    seededAssetRef.current = initialCompositionAssetId;
    if (!loadAsset(initialCompositionAssetId)) onCompositionAssetChange?.(null);
  }, [initialCompositionAssetId, storedAssets.loaded, loadAsset, onCompositionAssetChange]);

  // A stored composition changed elsewhere (another view saved it): follow
  // it, unless there are unsaved edits here.
  const activeAsset = activeAssetId ? storedAssets.assets.find((a) => a.id === activeAssetId) : undefined;
  const activeAssetVersion = activeAsset?.updated_at;
  useEffect(() => {
    if (!activeAssetId || dirty || !activeAssetVersion) return;
    loadAsset(activeAssetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAssetVersion]);

  const discoveredComposition = useMemo(
    () =>
      discovery
        ? compositionFromLayers(discovery.layers, {
            name: freshCompositionName(storedAssets.assets.map((a) => a.name)),
            allObjectTypes: discovery.allObjectTypes,
            source: { kind: 'discovered', algorithm: discovery.algorithm, fileId: validFileId ?? undefined },
          })
        : null,
    [discovery, storedAssets.assets, validFileId],
  );
  const compositionLayers = useMemo(
    () => (composition ? compositionToLayers(composition) : null),
    [composition],
  );
  const typeColors = useMemo(
    () => mapTypesToColors(discovery?.allObjectTypes ?? []),
    [discovery?.allObjectTypes],
  );

  // Share what is shown, so the Variants Explorer and the alignments use
  // the same areas (the visualizer publishes plain discoveries itself).
  useEffect(() => {
    if (!validFileId) return;
    if (composition && compositionLayers) {
      useProcessAreaStore.getState().publish({
        fileId: validFileId,
        algorithm: 'manual',
        filtered: false,
        composition: { name: composition.name, assetId: activeAssetId },
        areas: compositionLayers.flatMap((layer) => layer.areas),
        objectTypeToActivities: discovery?.objectTypeToActivities ?? {},
      });
    } else if (discovery) {
      useProcessAreaStore.getState().publish({
        fileId: validFileId,
        algorithm: discovery.algorithm,
        filtered: discovery.filtered,
        areas: discoveredSnapshotAreas(discovery.layers),
        objectTypeToActivities: discovery.objectTypeToActivities,
      });
    }
    // Only when what is shown changes, not on every discovery of the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validFileId, composition, compositionLayers, activeAssetId]);

  const handleSourceChange = (value: string) => {
    if (value === UNSAVED) return;
    if (value === DISCOVERED) {
      setComposition(null);
      setDirty(false);
      onCompositionAssetChange?.(null);
      return;
    }
    const assetId = Number(value.replace('asset:', ''));
    if (loadAsset(assetId)) onCompositionAssetChange?.(assetId);
  };

  const saveDirectly = async () => {
    if (!composition || !projectId) return;
    if (hasBlockingProblems(composition)) {
      setEditorOpen(true);
      return;
    }
    setSaving(true);
    try {
      const asset = activeAssetId
        ? await updateProcessAreaAsset({ assetId: activeAssetId, composition })
        : await createProcessAreaAsset({ projectId, composition });
      upsertAsset(asset);
      setComposition({ ...composition, name: asset.name, source: { kind: 'asset', assetId: asset.id } });
      setDirty(false);
      onCompositionAssetChange?.(asset.id);
      toast.success(`Saved process areas "${asset.name}" to the project assets.`);
    } catch (error) {
      toast.error(`Saving failed: ${extractAssetApiError(error).message}`);
      setEditorOpen(true);
    } finally {
      setSaving(false);
    }
  };

  const sourceValue = composition ? (activeAssetId ? `asset:${activeAssetId}` : UNSAVED) : DISCOVERED;
  const editorSeed = composition ?? discoveredComposition;

  const handleControlsReady = useCallback((controls: TotemVisualizerControls) => {
    setTotemControls(controls);
  }, []);

  const handleReload = useCallback(() => {
    setReloadSignal((prev) => prev + 1);
  }, []);

  const heightStyle = typeof height === 'number' ? `${height}px` : height;
  const fillContainer = height === "100%";

  const visualizerContent = (
    <ReactFlowProvider>
      <TotemVisualizer
        eventLogId={fileId}
        height="100%"
        backendBaseUrl={backendBaseUrl}
        reloadSignal={reloadSignal}
        title="Totem Visualizer"
        embedded={true}
        onControlsReady={handleControlsReady}
        filterEnabled={filterEnabled}
        localFilterParams={localFilterParams}
        initialAlgorithm={initialAlgorithm}
        initialParams={initialParams}
        onSettingsChange={onSettingsChange}
        compositionLayers={compositionLayers}
        onDiscoveryLoaded={handleDiscoveryLoaded}
      />
    </ReactFlowProvider>
  );

  if (embedded) {
    return (
      <div style={{ height: heightStyle }}>
        {visualizerContent}
      </div>
    );
  }

  return (
    <Card
      className={`@container/card w-full flex flex-col ${fillContainer ? 'h-full rounded-none' : ''}`}
    >
      <CardHeader className="items-center relative z-10 justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <CardTitle>Process Area Visualizer</CardTitle>
          <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={() => setFilterEnabled(prev => !prev)} />
          <LocalFilterDropdown fileId={fileId} onFilterChange={setLocalFilterParams} />
        </div>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <Select value={sourceValue} onValueChange={handleSourceChange}>
            <SelectTrigger
              className="h-8 w-[220px]"
              aria-label="Shown process areas"
              title="Show the discovered process areas or a composition stored in the project assets"
            >
              <Layers className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DISCOVERED}>Discovered areas</SelectItem>
              {composition && !activeAssetId ? (
                <SelectItem value={UNSAVED}>{composition.name || 'Adjusted'} (not saved)</SelectItem>
              ) : null}
              {storedAssets.assets.length > 0 ? (
                <>
                  <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                    Stored in project assets
                  </div>
                  {storedAssets.assets.map((asset) => (
                    <SelectItem key={asset.id} value={`asset:${asset.id}`}>
                      {asset.name}
                      {asset.id === activeAssetId && dirty ? ' (edited)' : ''}
                    </SelectItem>
                  ))}
                </>
              ) : null}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditorOpen(true)}
            disabled={!editorSeed}
            title={
              editorSeed
                ? 'Move object types between process areas and levels, name the areas and choose their activities'
                : 'Waiting for the discovery to finish'
            }
          >
            <Pencil className="h-4 w-4" />
            Adjust
          </Button>
          {composition && (dirty || !activeAssetId) ? (
            <Button
              type="button"
              size="sm"
              onClick={() => void saveDirectly()}
              disabled={saving || !projectId}
              title={activeAssetId ? 'Store the changes in the project assets' : 'Store this composition in the project assets'}
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          ) : null}
          <div className="w-px h-6 bg-border" />
          {totemControls && !composition && (
            <>
              <Select
                value={totemControls.algorithm}
                onValueChange={(value) =>
                  totemControls.onAlgorithmChange(value as ProcessAreaAlgorithm)
                }
              >
                <SelectTrigger className="h-8 w-[230px]" aria-label="Discovery algorithm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROCESS_AREA_ALGORITHM_LABELS) as ProcessAreaAlgorithm[]).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {PROCESS_AREA_ALGORITHM_LABELS[value]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              {/* The parameters only exist for the advanced algorithm; showing
                  them next to MLPA would suggest they do something. */}
              {totemControls.algorithm === 'advanced' && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="rounded-full h-8 w-8"
                      title="Indicator weights and layering parameters"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[320px] space-y-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Resource indicators</p>
                      <p className="text-xs text-muted-foreground">
                        Which signals decide what counts as a resource, and how strongly
                        the hierarchy is pulled apart.
                      </p>
                    </div>
                    {PARAM_CONTROLS.map(({ key, label, hint }) => (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">{label}</Label>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {totemControls.params[key].toFixed(2)}
                          </span>
                        </div>
                        <Slider
                          {...PROCESS_AREA_PARAM_RANGES[key]}
                          value={[totemControls.params[key]]}
                          onValueChange={(values) =>
                            totemControls.onParamChange(key, values?.[0] ?? 0)
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">{hint}</p>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={totemControls.onParamsReset}
                    >
                      Reset to defaults
                    </Button>
                  </PopoverContent>
                </Popover>
              )}
              <div className="w-px h-6 bg-border" />
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleReload}
            disabled={!fileId}
            className="flex items-center gap-2"
          >
            <RefreshCcw className="h-4 w-4" />
            Reload
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent
        className={`p-0 ${fillContainer ? 'flex-1 min-h-0' : ''}`}
        style={fillContainer ? undefined : { height: heightStyle }}
      >
        {visualizerContent}
      </CardContent>
      {editorSeed ? (
        <ProcessAreaEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          initial={editorSeed}
          discovered={discoveredComposition}
          objectTypeToActivities={discovery?.objectTypeToActivities ?? {}}
          allActivities={discovery?.allActivities ?? []}
          typeColors={typeColors}
          projectId={projectId}
          assetId={activeAssetId}
          onApply={(next) => {
            setComposition(next);
            setDirty(true);
          }}
          onSaved={(next, asset) => {
            setComposition({ ...next, name: asset.name });
            setDirty(false);
            onCompositionAssetChange?.(asset.id);
          }}
        />
      ) : null}
    </Card>
  );
}
