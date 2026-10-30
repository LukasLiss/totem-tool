import React, { useState, useEffect, useCallback } from "react";
import { Button } from '@/components/ui/button'; // ShadCN Button
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { GridStackNode } from 'gridstack';
import type { SelectedFile } from '@/contexts/SelectedFileContext';
import { processFile } from '@/api/fileApi';
import { Input } from '@/components/ui/input';
import { API_BASE_URL } from '@/config/api';
import {
  IMAGE_ASSET_ACCEPT,
  extractImageAssetApiError,
  imageAssetSrc,
  listImageAssets,
  uploadImageAsset,
  type ImageAsset as ImageAssetInfo,
} from '@/api/imageAssetsApi';
import VariantsExplorer from '@/react_component/VariantsExplorer';
import {
  EXTRACTION_OPTIONS,
  ISO_OPTIONS,
  type Extraction,
  type IsoStrategy,
} from '@/react_component/variants/types';
import { MultiSelectPopover } from '@/react_component/variants/MultiSelectPopover';
import { fetchActivities, fetchObjectTypes } from '@/react_component/variants/variantsApi';
import ProcessArea from '@/react_component/ProcessArea';
import {
  clampProcessAreaParams,
  DEFAULT_PROCESS_AREA_ALGORITHM,
  type ProcessAreaAlgorithm,
  type ProcessAreaParams,
} from '@/react_component/processAreaParams';
import { ReactFlowProvider } from "@xyflow/react";
import DottedChart from '@/react_component/DottedChart';
import type { DottedChartConfig } from '@/react_component/dottedChart/DottedChartControls';
import { axisOptionLabel } from '@/react_component/dottedChart/dottedChartAxisOptions';
import { useDottedChartOptions } from '@/react_component/dottedChart/useDottedChartOptions';
import DottedChartSketch from './DottedChartSketch';
import DottedChartSettingsBody from './DottedChartSettingsDialog';
import ProcessAreaSketch from './ProcessAreaSketch';
import TotemModelSketch from './TotemModelSketch';
import OcdfgSketch from './OcdfgSketch';
import OcdfgSettingsBody from './OcdfgSettingsDialog';
import OcpnSketch from './OcpnSketch';
import OcpnSettingsBody from './OcpnSettingsDialog';
import OccnSketch from './OccnSketch';
import OccnSettingsBody from './OccnSettingsDialog';
import ProcessAreaSettingsBody from './ProcessAreaSettingsDialog';
import { ChartSettingsDialog } from './sql-widgets/chartSettings';
import {
  axisOptionToParam,
  type AxisOption,
  type RowOrderOption,
} from '@/react_component/dottedChart/dottedChartUtils';
import TotemMiner from '@/react_component/TotemMiner';
import NewOCDFGVisualizer from '@/react_component/NewOCDFGVisualizer';
import NewOCDFGVariantsVisualizer from '@/react_component/NewOCDFGVariantsVisualizer';
import OCPNVisualizer from '@/react_component/OCPNVisualizer';
import { toast } from "sonner";
import OCCNVisualizer from '@/react_component/OCCNVisualizer';
import { Switch } from '@/components/ui/switch';
import LogStatistics from './LogStatistics';
import LogStatisticsSketch from './LogStatisticsSketch';
import LogStatisticsSettingsDialog from './LogStatisticsSettingsDialog';
import { selectionFromNode, type LogStatisticsSelection } from './logStatisticsUtils';
import WidgetDraftTile from './WidgetDraftTile';
import SqlTableSketch from './SqlTableSketch';
import { discoveryKey, useColumnDiscovery } from './sql-widgets/sqlWidgetUtils';
import SqlTableSettingsDialog, { type SqlTableSettings } from './SqlTableSettingsDialog';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import SqlQueryEditor, {
  SQL_QUERY_DEFAULT,
  type LinkedQuery,
  type SqlQueryConfig,
} from '@/react_component/SqlQueryEditor';
import { useFilterVersion } from '@/store/filterStore';
import { GlobalFilterToggle } from '@/components/ui/GlobalFilterToggle';
import { LocalFilterDropdown } from '@/components/ui/LocalFilterDropdown';
import TextBoxEditor from '@/components/text-box/TextBoxEditor';
import RichTextRenderer from '@/components/text-box/RichTextRenderer';
import { useProjectDashboards } from '@/components/text-box/useProjectDashboards';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  conversionPatch,
  docForWidget,
  isRichTextDoc,
  plainTextFromDoc,
  type RichTextDoc,
} from '@/components/text-box/richText';
import {
  TEXT_BOX_FORMAT_DEFAULTS,
  resolveTextBoxFormat,
  textBoxContainerStyle,
  textBoxTextStyle,
  type TextAlign,
  type TextBoxFormat,
  type TextFontFamily,
  type TextFontWeight,
  type TextVerticalAlign,
} from '@/components/text-box/textBoxFormat';

function WidgetFilterHeader({ title, filterEnabled, onToggle, fileId, onLocalFilterChange }: {
  title: string;
  filterEnabled: boolean;
  onToggle: () => void;
  fileId?: number | null;
  onLocalFilterChange?: (params: Record<string, string>) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--card)', flexShrink: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--card-foreground)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={onToggle} />
      {onLocalFilterChange && (
        <LocalFilterDropdown fileId={fileId} onFilterChange={onLocalFilterChange} />
      )}
    </div>
  );
}


// Define props interface for components (extend as needed)
export interface ComponentProps {
  node: GridStackNode & {
    component_id: number;
    component_name?: string;
    text?: string;
    // TextBoxComponent block-level formatting (#373)
    font_size?: number;
    font_family?: TextFontFamily;
    font_weight?: TextFontWeight;
    italic?: boolean;
    underline?: boolean;
    text_align?: TextAlign;
    vertical_align?: TextVerticalAlign;
    text_color?: string;
    background_color?: string;
    line_height?: number;
    // The TipTap document, when the box has per-selection formatting.
    rich_text?: RichTextDoc | null;
    color?: string;
    image?: string;
    // ImageComponent properties (asset-store based)
    image_asset?: number | null;
    image_asset_url?: string | null;
    image_fit?: string;
    image_alignment?: string;
    automatic_loading?: boolean;
    leading_object_type?: string;
    // Persisted advanced settings for the Variants Explorer
    extraction?: Extraction;
    iso?: IsoStrategy;
    timeout_s?: number;
    business_object_types?: string[];
    business_activities?: string[];
    // LogStatisticsComponent properties
    show_num_events?: boolean;
    show_num_activities?: boolean;
    show_num_objects?: boolean;
    show_num_object_types?: boolean;
    show_earliest_timestamp?: boolean;
    show_newest_timestamp?: boolean;
    show_duration?: boolean;
    // NewOCDFGComponent properties
    show_controls?: boolean;
    initial_interaction_locked?: boolean;
    // OCDottedChartComponent properties
    file_id?: number | null;
    x_axis?: string;
    y_axis?: string;
    color_by?: string;
    shape_by?: string;
    row_order?: RowOrderOption;
    max_points?: number;
    show_minimap?: boolean;
    // NewOCDFGComponent / OCCNComponent properties
    layout_direction?: 'TB' | 'LR';
    // OCCNComponent properties
    relative_occurrence_threshold?: number;
    object_types?: string;
    // ProcessAreaComponent properties
    algorithm?: ProcessAreaAlgorithm;
    w_temporal?: number;
    w_cardinality?: number;
    w_divergence?: number;
    alpha?: number;
    beta?: number;
    // OCHandoverComponent / ResourceProfilingComponent properties
    resource_types?: string[];
    businessobject_types?: string[];
    max_gap?: number | null;
    normalization?: 'by_source' | 'by_target' | 'by_arcs_in_eog' | 'by_total_weight';
    normalization_scope?: 'global' | 'per_bo_type';
    parallel_filter_enabled?: boolean;
    parallel_threshold?: number;
    min_parallel_observations?: number;
    cluster_by_ot?: boolean;
    view_mode?: 'graph' | 'table' | 'log';
    feature_groups?: string[];
    tooltip_feature_groups?: string[];
    compute_clusters?: boolean;
    cluster_method?: 'kmeans' | 'agglomerative' | 'hdbscan';
    n_clusters?: number;
    min_cluster_size?: number;
    distance_metric?: 'euclidean' | 'hellinger';
    // SqlQueryComponent properties
    name?: string;
    query?: string;
    query_asset?: number | null;
    query_asset_name?: string | null;
    row_limit?: number;
  };
  onUpdate?: (updates: Partial<GridStackNode>) => void;
  isEditMode?: boolean; // Now passed globally
  dashboardId: number;
  /**
   * Switch the app to another dashboard (a Text Box link).
   *
   * Passed down rather than read from `DashboardContext` where it is used:
   * every widget is mounted in its own `ReactDOM.createRoot`, and React
   * context does not cross a root boundary — a `useContext` inside a widget
   * gets the context's default value, whose `setViewMode` does nothing.
   */
  onOpenDashboard?: (dashboardId: number) => void;  // Added for API calls
  selectedFile?: SelectedFile; // Selected event log file
}


// TextBoxComponent: free text plus block-level formatting (#373). Edit mode
// shows a formatting toolbar above the textarea, the way ImageComponent
// shows its settings; view mode renders the same styles on a paragraph.
// The text is a React text node throughout, never HTML, so there is no
// markup to sanitise.
export const TextBoxComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
  onOpenDashboard,
}) => {
  // The picker needs their names; view mode needs the ids to tell a live
  // link from a deleted one. Fetched once per project, shared across boxes.
  const dashboards = useProjectDashboards(selectedFile?.project);
  const knownDashboardIds = React.useMemo(
    () => new Set(dashboards.map((dashboard) => dashboard.id)),
    [dashboards],
  );

  // Nothing says where the words lead before they are clicked, so ask first.
  const [pendingDashboard, setPendingDashboard] = React.useState<number | null>(null);
  const pendingName = dashboards.find((d) => d.id === pendingDashboard)?.name;

  // No literal placeholder text: the editor shows a real placeholder, so an
  // empty box stays empty instead of carrying words the user must delete.
  const [text, setText] = React.useState(node.text ?? '');
  // Sync local state with node.text when it changes (e.g., from loading or updates)
  React.useEffect(() => {
    setText(node.text ?? '');
  }, [node.text]);

  // Formatting has to live in React state, not be derived from the node on
  // each render: `onUpdate` reaches the node through `Object.assign`, which
  // mutates it without scheduling a render. Deriving it meant a click on
  // Bold changed nothing on screen until a save-and-reload rebuilt the
  // widget. Same shape as ImageComponent's fit/alignment state.
  const [format, setFormat] = React.useState(() => resolveTextBoxFormat(node));

  // Re-sync when the node itself changes — a layout load, or an update from
  // somewhere other than this toolbar.
  React.useEffect(() => {
    setFormat(resolveTextBoxFormat(node));
    // Each field is listed so a load actually re-syncs; `node` is mutated in
    // place, so depending on the object identity would never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    node.font_size,
    node.font_family,
    node.font_weight,
    node.italic,
    node.underline,
    node.text_align,
    node.vertical_align,
    node.text_color,
    node.background_color,
    node.line_height,
  ]);

  const containerStyle = textBoxContainerStyle(format);
  const textStyle = textBoxTextStyle(format);

  // Update the preview immediately, and push the patch onto the GridStack
  // node so getLayout() picks it up at save time.
  const handleFormatChange = (patch: Partial<TextBoxFormat>) => {
    setFormat((current) => resolveTextBoxFormat({ ...current, ...patch }));
    onUpdate?.(patch);
  };

  // The document to edit: the stored one, or one built from this box's plain
  // text and block formatting so a box saved before rich text existed opens
  // looking exactly as it already does.
  const doc = React.useMemo(
    () => docForWidget(node.rich_text, text, format),
    [node.rich_text, text, format],
  );
  const hasRichText = isRichTextDoc(node.rich_text);

  // On the first real edit the box moves onto its document: the text-level
  // block fields are reset, because the document now owns them (see
  // `conversionPatch`). Idempotent, so later edits just update the document.
  const handleDocChange = (next: RichTextDoc) => {
    const plain = plainTextFromDoc(next);
    setText(plain);
    if (!hasRichText) {
      setFormat((current) =>
        resolveTextBoxFormat({
          ...current,
          ...(conversionPatch(next) as Partial<TextBoxFormat>),
        }),
      );
    }
    onUpdate?.({ ...conversionPatch(next), text: plain } as Partial<GridStackNode>);
  };

  return (
    <div style={{ height: '100%', width: '100%' }}>
      {isEditMode ? (
        <Card className="w-full h-full rounded-none flex flex-col gap-0 py-0 overflow-hidden">
          <TextBoxEditor
            doc={doc}
            format={format}
            onDocChange={handleDocChange}
            onFormatChange={handleFormatChange}
            idPrefix={`text-box-${node.component_id}`}
            dashboards={dashboards}
          />
        </Card>
      ) : (
        // min-h is deliberately absent: the card fills whatever the grid tile
        // is, rather than forcing 320px into a 2-row widget.
        <Card className="w-full h-full rounded-none py-0 overflow-hidden">
          <CardContent className="h-full p-3" style={containerStyle}>
            {hasRichText ? (
              // The document carries its own styling; the container only
              // supplies the plain defaults for anything a run leaves unset.
              <div
                style={{
                  fontSize: TEXT_BOX_FORMAT_DEFAULTS.font_size,
                  color: TEXT_BOX_FORMAT_DEFAULTS.text_color,
                  lineHeight: TEXT_BOX_FORMAT_DEFAULTS.line_height,
                }}
              >
                <RichTextRenderer
                  doc={doc}
                  onDashboardLink={setPendingDashboard}
                  knownDashboardIds={knownDashboardIds}
                />
              </div>
            ) : (
              <p style={{ ...textStyle, whiteSpace: 'pre-wrap', margin: 0 }}>{text}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* The same Dialog grid.tsx uses to confirm discarding changes. It
          portals to the body, escaping this widget's cell and React root. */}
      <Dialog
        open={pendingDashboard !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDashboard(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open another dashboard?</DialogTitle>
            <DialogDescription>
              {pendingName
                ? `This link opens "${pendingName}". You will leave the dashboard you are on.`
                : 'This link opens another dashboard. You will leave the dashboard you are on.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDashboard(null)}>
              Stay here
            </Button>
            <Button
              onClick={() => {
                const id = pendingDashboard;
                setPendingDashboard(null);
                if (id !== null) onOpenDashboard?.(id);
              }}
            >
              Open dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};


// NumberOfEventsComponent: Static display with a button (customize as needed)
export const NumberOfEventsComponent: React.FC<ComponentProps> = ({ selectedFile, node }) => {
  const [processedResult, setProcessedResult] = useState(null);

  // Refetch when the global filter changes so the count follows the filter.
  const filterVersion = useFilterVersion();

  const [, setIsLoading] = useState(false);
  const [, setError] = useState(null);



  useEffect(() => {
    const handleProcessFile = async () => {
      if (!selectedFile?.id) {
        setProcessedResult(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await processFile(selectedFile.id);
        setProcessedResult(result);
      } catch (err) {
        console.error("Failed to process file in NumberOfEventsComponent:", err);
        setError("Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };

    handleProcessFile();
  }, [selectedFile, filterVersion]);

  return (
    <div style={{width: '100%', height: '100%', color: node.color, textAlign: 'center' }}>
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardDescription>Number of Events</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{processedResult || 'Loading...'}</p>
        </CardContent>
      </Card>
    </div>
  );
};


// ImageComponent: shows an image from the project asset store. In edit mode
// the user picks a stored image (or uploads a new one, which lands in the
// asset store) and chooses standard positioning options; in view mode the
// image is rendered with the chosen object-fit/object-position on a white
// background.
const IMAGE_FIT_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'contain', label: 'Scale to fit', hint: 'Whole image visible, aspect ratio kept' },
  { value: 'cover', label: 'Fill (crop)', hint: 'Fills the box, aspect ratio kept, edges cropped' },
  { value: 'fill', label: 'Stretch', hint: 'Fills the box, aspect ratio NOT kept' },
  { value: 'none', label: 'Original size', hint: 'No scaling, may be cropped' },
  { value: 'scale-down', label: 'Scale down only', hint: 'Like "Scale to fit", but never enlarges' },
];

const IMAGE_ALIGNMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top left', label: 'Top left' },
  { value: 'top right', label: 'Top right' },
  { value: 'bottom left', label: 'Bottom left' },
  { value: 'bottom right', label: 'Bottom right' },
];

export const ImageComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  const projectId = selectedFile?.project as number | undefined;
  const [assets, setAssets] = useState<ImageAssetInfo[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<number | null>(node.image_asset ?? null);
  const [assetUrl, setAssetUrl] = useState<string | null>(node.image_asset_url ?? null);
  const [fit, setFit] = useState<string>(node.image_fit ?? 'contain');
  const [alignment, setAlignment] = useState<string>(node.image_alignment ?? 'center');

  useEffect(() => {
    setAssetId(node.image_asset ?? null);
    setAssetUrl(node.image_asset_url ?? null);
    setFit(node.image_fit ?? 'contain');
    setAlignment(node.image_alignment ?? 'center');
  }, [node.image_asset, node.image_asset_url, node.image_fit, node.image_alignment]);

  // Load the project's image assets while editing so the user can pick one.
  useEffect(() => {
    if (!isEditMode || !projectId) return;
    let cancelled = false;
    setLoadingAssets(true);
    listImageAssets(projectId)
      .then((data) => {
        if (!cancelled) setAssets(data);
      })
      .catch(() => toast.error('Image assets could not be loaded'))
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEditMode, projectId]);

  const selectAsset = (asset: ImageAssetInfo | null) => {
    setAssetId(asset?.id ?? null);
    setAssetUrl(asset?.url ?? null);
    onUpdate?.({
      image_asset: asset?.id ?? null,
      image_asset_url: asset?.url ?? null,
    });
  };

  const handleFitChange = (value: string) => {
    setFit(value);
    onUpdate?.({ image_fit: value });
  };

  const handleAlignmentChange = (value: string) => {
    setAlignment(value);
    onUpdate?.({ image_alignment: value });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !projectId) return;

    setUploading(true);
    setUploadError(null);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'Image';
    try {
      let created: ImageAssetInfo;
      try {
        created = await uploadImageAsset({ projectId, name: baseName, file });
      } catch {
        // Most likely a duplicate name — retry once with a unique suffix.
        created = await uploadImageAsset({
          projectId,
          name: `${baseName} (${new Date().toISOString().slice(0, 19).replace('T', ' ')})`,
          file,
        });
      }
      setAssets((current) => [...current, created]);
      selectAsset(created);
    } catch (error) {
      setUploadError(extractImageAssetApiError(error).message);
    } finally {
      setUploading(false);
    }
  };

  // Resolve what to render: asset-store image first, legacy upload second.
  const legacySrc = node.image
    ? node.image.startsWith('http')
      ? node.image
      : `${API_BASE_URL}${node.image.startsWith('/') ? '' : '/'}${node.image}`
    : null;
  const src = imageAssetSrc(assetUrl) ?? legacySrc;
  const selectedAsset = assets.find((asset) => asset.id === assetId) ?? null;

  if (isEditMode) {
    const fitOption = IMAGE_FIT_OPTIONS.find((o) => o.value === fit);
    return (
      <Card className="w-full h-full rounded-none overflow-auto">
        <CardHeader>
          <CardTitle>Image Settings</CardTitle>
          <CardDescription>
            Pick an image from the project's asset store or upload a new one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Image</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between font-normal"
                  disabled={!projectId}
                >
                  <span className="truncate">
                    {selectedAsset?.name ??
                      (assetId != null ? `Image #${assetId}` : 'Select an image')}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-72 w-[280px] overflow-y-auto">
                <DropdownMenuLabel>Project images</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={assetId != null ? String(assetId) : ''}
                  onValueChange={(value) =>
                    selectAsset(assets.find((asset) => String(asset.id) === value) ?? null)
                  }
                >
                  <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
                  {assets.map((asset) => (
                    <DropdownMenuRadioItem key={asset.id} value={String(asset.id)}>
                      <span className="truncate">{asset.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {loadingAssets && (
              <p className="text-xs text-muted-foreground">Loading images…</p>
            )}
            {!projectId && (
              <p className="text-xs text-muted-foreground">
                Select an event log to see the project's images.
              </p>
            )}
            {projectId && !loadingAssets && assets.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No images in this project yet — upload one below or in
                Project Assets &gt; Images.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`image-upload-${node.component_id}`}>
              Upload new image to the asset store
            </Label>
            <Input
              id={`image-upload-${node.component_id}`}
              type="file"
              accept={IMAGE_ASSET_ACCEPT}
              onChange={handleFileUpload}
              disabled={uploading || !projectId}
            />
            {uploading && <p className="text-xs text-muted-foreground">Uploading…</p>}
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
          </div>

          <div className="space-y-2">
            <Label>Positioning</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">{fitOption?.label ?? fit}</span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[280px]">
                <DropdownMenuLabel>Positioning</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={fit} onValueChange={handleFitChange}>
                  {IMAGE_FIT_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                      className="items-start py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm">{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.hint}</span>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {fitOption && (
              <p className="text-xs text-muted-foreground">{fitOption.hint}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Alignment</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">
                    {IMAGE_ALIGNMENT_OPTIONS.find((o) => o.value === alignment)?.label ??
                      alignment}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[200px]">
                <DropdownMenuRadioGroup
                  value={alignment}
                  onValueChange={handleAlignmentChange}
                >
                  {IMAGE_ALIGNMENT_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {src && (
            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="h-32 w-full overflow-hidden rounded-md border bg-white">
                <img
                  src={src}
                  alt="Preview"
                  className="h-full w-full"
                  style={{ objectFit: fit as React.CSSProperties['objectFit'], objectPosition: alignment }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE
  return (
    <div className="h-full w-full overflow-hidden bg-white">
      {src ? (
        <img
          src={src}
          alt={selectedAsset?.name ?? 'Dashboard image'}
          className="h-full w-full"
          style={{ objectFit: fit as React.CSSProperties['objectFit'], objectPosition: alignment }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
          No image selected
        </div>
      )}
    </div>
  );
};


// VariantsComponent: Wrapper for VariantsExplorer with configurable settings
export const VariantsComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  // Local state for form values
  const [automaticLoading, setAutomaticLoading] = useState(node.automatic_loading ?? false);
  const [leadingType, setLeadingType] = useState(node.leading_object_type ?? '');
  const [extraction, setExtraction] = useState<Extraction>(
    (node.extraction as Extraction) ?? 'leading_1hop'
  );
  const [iso, setIso] = useState<IsoStrategy>(
    (node.iso as IsoStrategy) ?? 'wl+vf2'
  );
  const [timeoutS, setTimeoutS] = useState<number>(node.timeout_s ?? 10);
  const [businessObjectTypes, setBusinessObjectTypes] = useState<string[]>(
    node.business_object_types ?? []
  );
  const [businessActivities, setBusinessActivities] = useState<string[]>(
    node.business_activities ?? []
  );
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [availableActivities, setAvailableActivities] = useState<string[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);

  // Sync with node when it changes (e.g. dashboard reloads with persisted values).
  const nodeBusinessObjectTypes = JSON.stringify(node.business_object_types ?? []);
  const nodeBusinessActivities = JSON.stringify(node.business_activities ?? []);
  useEffect(() => {
    setAutomaticLoading(node.automatic_loading ?? false);
    setLeadingType(node.leading_object_type ?? '');
    setExtraction((node.extraction as Extraction) ?? 'leading_1hop');
    setIso((node.iso as IsoStrategy) ?? 'wl+vf2');
    setTimeoutS(node.timeout_s ?? 10);
    setBusinessObjectTypes(JSON.parse(nodeBusinessObjectTypes));
    setBusinessActivities(JSON.parse(nodeBusinessActivities));
  }, [
    node.automatic_loading,
    node.leading_object_type,
    node.extraction,
    node.iso,
    node.timeout_s,
    nodeBusinessObjectTypes,
    nodeBusinessActivities,
  ]);

  // Fetch object types and activities when file changes (for edit mode dropdowns)
  useEffect(() => {
    if (!selectedFile?.id || !isEditMode) return;

    const fetchOptions = async () => {
      setLoadingTypes(true);
      try {
        const [types, activities] = await Promise.all([
          fetchObjectTypes(selectedFile.id),
          fetchActivities(selectedFile.id),
        ]);
        setAvailableTypes(types);
        setAvailableActivities(activities);
      } catch {
        toast.error('Object types could not be loaded');
      } finally {
        setLoadingTypes(false);
      }
    };
    fetchOptions();
  }, [selectedFile?.id, isEditMode]);

  // Handlers for form changes
  const handleAutomaticLoadingChange = (checked: boolean) => {
    setAutomaticLoading(checked);
    onUpdate?.({ automatic_loading: checked });
  };

  const handleLeadingTypeChange = (value: string) => {
    setLeadingType(value);
    onUpdate?.({ leading_object_type: value });
  };

  const handleExtractionChange = (value: string) => {
    const v = value as Extraction;
    setExtraction(v);
    onUpdate?.({ extraction: v });
  };

  const handleIsoChange = (value: string) => {
    const v = value as IsoStrategy;
    setIso(v);
    onUpdate?.({ iso: v });
  };

  const handleTimeoutChange = (raw: string) => {
    const n = Number(raw);
    const safe = Number.isFinite(n) && n > 0 ? n : 10;
    setTimeoutS(safe);
    onUpdate?.({ timeout_s: safe });
  };

  const handleBusinessObjectTypesChange = (value: string[]) => {
    setBusinessObjectTypes(value);
    onUpdate?.({ business_object_types: value });
  };

  const handleBusinessActivitiesChange = (value: string[]) => {
    setBusinessActivities(value);
    onUpdate?.({ business_activities: value });
  };

  if (isEditMode) {
    // EDIT MODE: Configuration form
    const extractionOpt = EXTRACTION_OPTIONS.find((o) => o.value === extraction);
    const isoOpt = ISO_OPTIONS.find((o) => o.value === iso);
    const leadingTypeIgnored = extraction === 'connected' || extraction === 'resource_aware';
    const resourceAware = extraction === 'resource_aware';

    return (
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardTitle>Variants Explorer Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 overflow-auto">
          {/* Automatic Loading Toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-loading">Automatic variant computation</Label>
            <Switch
              id="auto-loading"
              checked={automaticLoading}
              onCheckedChange={handleAutomaticLoadingChange}
            />
          </div>

          {/* Leading Object Type Dropdown */}
          <div className="space-y-2">
            <Label>Leading object type</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  disabled={leadingTypeIgnored}
                  title={
                    leadingTypeIgnored
                      ? 'Ignored when extraction is "Connected components"'
                      : undefined
                  }
                >
                  {leadingTypeIgnored
                    ? `— (ignored for ${extractionOpt?.label ?? extraction})`
                    : (leadingType || 'Select object type (optional)')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuRadioGroup value={leadingType} onValueChange={handleLeadingTypeChange}>
                  <DropdownMenuRadioItem value="">None (use default)</DropdownMenuRadioItem>
                  {availableTypes.map((type) => (
                    <DropdownMenuRadioItem key={type} value={type}>{type}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {loadingTypes && <p className="text-sm text-muted-foreground">Loading types...</p>}
            {!selectedFile?.id && <p className="text-sm text-muted-foreground">Select a file to see available types</p>}
          </div>

          {/* Extraction strategy */}
          <div className="space-y-2">
            <Label>Extraction strategy</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">
                    {extractionOpt?.label ?? extraction}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[320px]">
                <DropdownMenuLabel>Extraction</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={extraction} onValueChange={handleExtractionChange}>
                  {EXTRACTION_OPTIONS.map((opt) => (
                    <DropdownMenuRadioItem
                      key={opt.value}
                      value={opt.value}
                      className="items-start py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.hint}</span>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {extractionOpt && (
              <p className="text-xs text-muted-foreground">{extractionOpt.hint}</p>
            )}
          </div>

          {resourceAware && (
            <>
              <div className="space-y-2">
                <Label>Business object types</Label>
                <MultiSelectPopover
                  label="Business object types"
                  options={availableTypes}
                  selected={businessObjectTypes}
                  onChange={handleBusinessObjectTypesChange}
                  placeholder="Select object types"
                  allLabel="All object types"
                  loading={loadingTypes}
                  disabled={!selectedFile?.id}
                />
                <p className="text-xs text-muted-foreground">
                  Object types left out are treated as resources.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Business activities</Label>
                <MultiSelectPopover
                  label="Business activities"
                  options={availableActivities}
                  selected={businessActivities}
                  onChange={handleBusinessActivitiesChange}
                  placeholder="All activities"
                  allLabel="All activities"
                  loading={loadingTypes}
                  disabled={!selectedFile?.id}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to connect business objects through every activity.
                </p>
              </div>
            </>
          )}

          {/* Isomorphism strategy */}
          <div className="space-y-2">
            <Label>Isomorphism strategy</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">{isoOpt?.label ?? iso}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[300px]">
                <DropdownMenuLabel>Isomorphism</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={iso} onValueChange={handleIsoChange}>
                  {ISO_OPTIONS.map((opt) => (
                    <DropdownMenuRadioItem
                      key={opt.value}
                      value={opt.value}
                      className="items-start py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.hint}</span>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {isoOpt && (
              <p className="text-xs text-muted-foreground">{isoOpt.hint}</p>
            )}
          </div>

          {/* Timeout (seconds) */}
          <div className="space-y-2">
            <Label htmlFor="variants-timeout">Timeout (seconds)</Label>
            <Input
              id="variants-timeout"
              type="number"
              min={1}
              max={120}
              step={1}
              value={timeoutS}
              onChange={(e) => handleTimeoutChange(e.target.value)}
              className="w-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Wall-clock budget per computation. The default of 10 s protects
              against runaway runs on hard combinations.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE: Render VariantsExplorer with stored settings
  return (
    <Card className="w-full h-full rounded-none overflow-auto">
      <CardContent className="p-0 h-full">
        <VariantsExplorer
          fileId={selectedFile?.id}
          embedded={true}
          automaticLoading={automaticLoading}
          defaultLeadingType={leadingType || undefined}
          defaultExtraction={extraction}
          defaultIso={iso}
          defaultTimeoutS={timeoutS}
          defaultBusinessObjectTypes={businessObjectTypes}
          defaultBusinessActivities={businessActivities}
          onAdvancedChange={(s) => {
            // Mirror the explorer's choices into our local state so this
            // wrapper stays in sync with what the user sees inside.
            setExtraction(s.extraction);
            setIso(s.iso);
            setTimeoutS(s.timeout_s);
            setLeadingType(s.leading_type);
            setBusinessObjectTypes(s.business_object_types);
            setBusinessActivities(s.business_activities);
            onUpdate?.({
              extraction: s.extraction,
              iso: s.iso,
              timeout_s: s.timeout_s,
              leading_object_type: s.leading_type,
              business_object_types: s.business_object_types,
              business_activities: s.business_activities,
            });
          }}
        />
      </CardContent>
    </Card>
  );
};


// ProcessAreaComponent: Wrapper for ProcessArea (Totem Visualizer)
//
// Persists the discovery algorithm and its five parameters. Tuning happens in
// view mode through the visualizer's own panel, so `onUpdate` is called from
// there too — otherwise the main interaction this component offers would be
// lost on every reload.
const PROCESS_AREA_SKETCH_HINT =
  "Layout preview: object types as colored boxes on their levels, grouped into process areas and linked across levels. The hierarchy itself comes from the log; names and counts are placeholders.";

export const ProcessAreaComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  // Local state, kept in step with the node. `onUpdate` mutates the gridstack
  // node without re-rendering this React root, so reading straight from `node`
  // would leave the edit-mode sliders frozen while dragging.
  const [algorithm, setAlgorithm] = useState<ProcessAreaAlgorithm>(
    node.algorithm ?? DEFAULT_PROCESS_AREA_ALGORITHM,
  );
  // Clamped, so a dashboard saved with an alpha or beta of 0 — possible before
  // the thesis' strictly-positive lower bound was enforced — opens on 0.1
  // instead of a slider sitting below its own minimum.
  const paramsFromNode = (): ProcessAreaParams =>
    clampProcessAreaParams({
      wTemporal: node.w_temporal,
      wCardinality: node.w_cardinality,
      wDivergence: node.w_divergence,
      alpha: node.alpha,
      beta: node.beta,
    });

  const [params, setParams] = useState<ProcessAreaParams>(paramsFromNode);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setAlgorithm(node.algorithm ?? DEFAULT_PROCESS_AREA_ALGORITHM);
    setParams(paramsFromNode());
  }, [
    node.algorithm,
    node.w_temporal,
    node.w_cardinality,
    node.w_divergence,
    node.alpha,
    node.beta,
  ]);

  const handleSettingsChange = useCallback(
    (settings: { algorithm: ProcessAreaAlgorithm; params: ProcessAreaParams }) => {
      setAlgorithm(settings.algorithm);
      setParams(settings.params);
      onUpdate?.({
        algorithm: settings.algorithm,
        w_temporal: settings.params.wTemporal,
        w_cardinality: settings.params.wCardinality,
        w_divergence: settings.params.wDivergence,
        alpha: settings.params.alpha,
        beta: settings.params.beta,
      });
    },
    [onUpdate],
  );

  if (isEditMode) {
    // EDIT MODE: the tile shows a draft of the visualizer; the settings open in a popup.
    return (
      <WidgetDraftTile
        typeLabel="Process area"
        hint={PROCESS_AREA_SKETCH_HINT}
        notice={selectedFile?.id ? undefined : "Select an event log file to see the visualization."}
        onConfigure={() => setSettingsOpen(true)}
        sketch={<ProcessAreaSketch className="h-full w-full" />}
      >
        <ChartSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <ProcessAreaSettingsBody
            id={`process-area-${node.component_id}`}
            initial={{ algorithm, params }}
            sketchHint={PROCESS_AREA_SKETCH_HINT}
            onApply={(settings) => {
              handleSettingsChange(settings);
              setSettingsOpen(false);
            }}
            onCancel={() => setSettingsOpen(false)}
          />
        </ChartSettingsDialog>
      </WidgetDraftTile>
    );
  }

  // VIEW MODE: Render ProcessArea with controls visible
  return (
    <ProcessArea
      fileId={selectedFile?.id}
      embedded={false}
      height="100%"
      initialAlgorithm={algorithm}
      initialParams={params}
      onSettingsChange={handleSettingsChange}
    />
  );
};


// TotemMinerComponent: Wrapper for TOTeM Miner Visualizer
export const TotemMinerComponent: React.FC<ComponentProps> = ({
  isEditMode = false,
  selectedFile
}) => {
  if (isEditMode) {
    // EDIT MODE: a draft of the model; the miner has no settings to open.
    return (
      <WidgetDraftTile
        typeLabel="TOTeM Miner"
        hint="Layout preview: object types as colored boxes and the relations between them, with their labels and cardinalities. The model itself is discovered from the log; all labels are placeholders."
        sketch={<TotemModelSketch className="h-full w-full" />}
      />
    );
  }

  // VIEW MODE: Render TotemMiner with controls visible
  return (
    <TotemMiner
      fileId={selectedFile?.id}
      embedded={false}
      height="100%"
    />
  );
};


// LogStatisticsComponent: Dashboard wrapper for LogStatistics. In edit mode
// the tile shows a draft of the cards and the settings open in a popup.
export const LogStatisticsComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [selection, setSelection] = useState<LogStatisticsSelection>(() => selectionFromNode(node));
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Sync with node when it changes
  useEffect(() => {
    setSelection(selectionFromNode(node));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the selection fields matter
  }, [node.show_num_events, node.show_num_activities, node.show_num_objects, node.show_num_object_types, node.show_earliest_timestamp, node.show_newest_timestamp, node.show_duration]);

  const applySelection = (next: LogStatisticsSelection) => {
    setSelection(next);
    onUpdate?.(next);
  };

  if (isEditMode) {
    return (
      <WidgetDraftTile
        typeLabel="Log statistics"
        // A row of cards is wide; let it use more of a wide tile than the other drafts.
        sketchMaxWidth="max-w-3xl"
        hint="Layout preview: one card per selected statistic. Grey bars stand in for the values; the real statistics are shown when you leave edit mode."
        onConfigure={() => setSettingsOpen(true)}
        sketch={<LogStatisticsSketch selection={selection} className="h-full w-full" />}
      >
        <LogStatisticsSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          widgetId={node.component_id}
          selection={selection}
          onApply={applySelection}
        />
      </WidgetDraftTile>
    );
  }

  // VIEW MODE: Delegate to reusable LogStatistics component
  return (
    <LogStatistics
      fileId={selectedFile?.id}
      showNumEvents={selection.show_num_events}
      showNumActivities={selection.show_num_activities}
      showNumObjects={selection.show_num_objects}
      showNumObjectTypes={selection.show_num_object_types}
      showEarliestTimestamp={selection.show_earliest_timestamp}
      showNewestTimestamp={selection.show_newest_timestamp}
      showDuration={selection.show_duration}
      className="w-full h-full"
    />
  );
};



const DOTTED_CHART_SKETCH_HINT =
  "Layout preview: events as dots along the x axis, one row per y value in the chosen order, colored and shaped as selected. Positions and labels are placeholders.";

const DOTTED_CHART_DEFAULT_CONFIG: DottedChartConfig = {
  xAxis: { type: "time" },
  yAxis: { type: "activity" },
  colorBy: { type: "activity" },
  shapeBy: { type: "none" },
  rowOrder: "first_occurrence",
  maxPoints: 10000,
};

// OCDottedChartComponent: Dashboard wrapper for Object-Centric Dotted Chart
export const OCDottedChartComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [localFilterParams, setLocalFilterParams] = useState<Record<string, string>>({});
  const effectiveFileId = selectedFile?.id;
  const config = nodeToDottedChartConfig(node);

  // Edit mode: the settings as last applied, for the draft (onUpdate changes
  // the node without re-rendering), synced when the saved settings change.
  const configJson = JSON.stringify(config);
  const [editConfig, setEditConfig] = useState<DottedChartConfig>(config);
  useEffect(() => { setEditConfig(JSON.parse(configJson)); }, [configJson]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The column options (for the popup's dropdowns and the draft's axis captions), only loaded in edit mode.
  const { options, loading: loadingOptions, error: optionsError } = useDottedChartOptions(
    isEditMode ? effectiveFileId : undefined,
  );

  const handleConfigChange = (nextConfig: DottedChartConfig) => {
    onUpdate?.({
      x_axis: axisOptionToPersistedValue(nextConfig.xAxis),
      y_axis: axisOptionToPersistedValue(nextConfig.yAxis),
      color_by: axisOptionToPersistedValue(nextConfig.colorBy),
      shape_by: axisOptionToPersistedValue(nextConfig.shapeBy),
      row_order: nextConfig.rowOrder,
      max_points: nextConfig.maxPoints,
    });
  };

  if (isEditMode) {
    // The tile shows a draft of the chart; the settings open in a popup.
    return (
      <WidgetDraftTile
        typeLabel="OC dotted chart"
        hint={DOTTED_CHART_SKETCH_HINT}
        notice={effectiveFileId ? undefined : "Select an event log in the application sidebar to render this widget."}
        onConfigure={() => setSettingsOpen(true)}
        sketch={
          <DottedChartSketch
            config={editConfig}
            xLabel={axisOptionLabel(options.x_axis, editConfig.xAxis)}
            yLabel={axisOptionLabel(options.y_axis, editConfig.yAxis)}
            className="h-full w-full"
          />
        }
      >
        <ChartSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DottedChartSettingsBody
            id={`dotted-chart-${node.component_id}`}
            initial={editConfig}
            options={options}
            loadingOptions={loadingOptions}
            optionsError={optionsError}
            fileId={effectiveFileId}
            sketchHint={DOTTED_CHART_SKETCH_HINT}
            onApply={(next) => {
              setEditConfig(next);
              handleConfigChange(next);
              setSettingsOpen(false);
            }}
            onCancel={() => setSettingsOpen(false)}
          />
        </ChartSettingsDialog>
      </WidgetDraftTile>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <WidgetFilterHeader title="OC Dotted Chart" filterEnabled={filterEnabled} onToggle={() => setFilterEnabled(p => !p)} fileId={effectiveFileId} onLocalFilterChange={setLocalFilterParams} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <DottedChart
          fileId={effectiveFileId}
          xAxis={config.xAxis}
          yAxis={config.yAxis}
          colorBy={config.colorBy}
          shapeBy={config.shapeBy}
          rowOrder={config.rowOrder}
          maxPoints={config.maxPoints}
          showControls={false}
          showMinimap={true}
          filterEnabled={filterEnabled}
          localFilterParams={localFilterParams}
          className="h-full"
        />
      </div>
    </div>
  );
};

function nodeToDottedChartConfig(node: ComponentProps["node"]): DottedChartConfig {
  return {
    xAxis: persistedValueToAxisOption(node.x_axis, DOTTED_CHART_DEFAULT_CONFIG.xAxis),
    yAxis: persistedValueToAxisOption(node.y_axis, DOTTED_CHART_DEFAULT_CONFIG.yAxis),
    colorBy: persistedValueToAxisOption(node.color_by, DOTTED_CHART_DEFAULT_CONFIG.colorBy),
    shapeBy: persistedValueToAxisOption(node.shape_by, DOTTED_CHART_DEFAULT_CONFIG.shapeBy),
    rowOrder: node.row_order ?? DOTTED_CHART_DEFAULT_CONFIG.rowOrder,
    maxPoints: node.max_points ?? DOTTED_CHART_DEFAULT_CONFIG.maxPoints,
  };
}

function persistedValueToAxisOption(value: string | undefined, fallback: AxisOption): AxisOption {
  if (!value) return fallback;
  if (isBuiltinDottedChartAxis(value)) return { type: value };
  return { type: "event_attribute", name: value };
}

function axisOptionToPersistedValue(axis: AxisOption): string {
  return axis.type === "none" ? "none" : axisOptionToParam(axis) ?? "none";
}

function isBuiltinDottedChartAxis(
  value: string
): value is "time" | "timestamp" | "timestamp_unix" | "since_start" | "activity" | "none" {
  return ["time", "timestamp", "timestamp_unix", "since_start", "activity", "none"].includes(value);
}


const OCDFG_SKETCH_HINT =
  "Layout preview: a colored start and end per object type, activities with their type dots, and one colored arc per object type, in the chosen direction. The graph itself comes from the log; names are placeholders.";

// NewOCDFGComponent: Dashboard wrapper for the new Object-Centric Directly Follows Graph (ELK layout)
export const NewOCDFGComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [localFilterParams, setLocalFilterParams] = useState<Record<string, string>>({});
  const [showControls, setShowControls] = useState(node.show_controls ?? true);
  const [initialInteractionLocked, setInitialInteractionLocked] = useState(node.initial_interaction_locked ?? true);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>(node.layout_direction ?? 'TB');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setShowControls(node.show_controls ?? true);
    setInitialInteractionLocked(node.initial_interaction_locked ?? true);
    setLayoutDirection(node.layout_direction ?? 'TB');
  }, [node.show_controls, node.initial_interaction_locked, node.layout_direction]);

  const handleShowControlsChange = (checked: boolean) => {
    setShowControls(checked);
    onUpdate?.({ show_controls: checked });
  };

  const handleInitialInteractionLockedChange = (checked: boolean) => {
    setInitialInteractionLocked(checked);
    onUpdate?.({ initial_interaction_locked: checked });
  };

  const handleLayoutDirectionChange = (value: string) => {
    setLayoutDirection(value as 'TB' | 'LR');
    onUpdate?.({ layout_direction: value as "TB" | "LR" });
  };

  if (isEditMode) {
    // EDIT MODE: the tile shows a draft of the graph; the settings open in a popup.
    return (
      <WidgetDraftTile
        typeLabel="OCDFG"
        hint={OCDFG_SKETCH_HINT}
        onConfigure={() => setSettingsOpen(true)}
        sketch={
          <OcdfgSketch
            layoutDirection={layoutDirection}
            showControls={showControls}
            interactionLocked={initialInteractionLocked}
            className="h-full w-full"
          />
        }
      >
        <ChartSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <OcdfgSettingsBody
            id={`ocdfg-${node.component_id}`}
            heading="OCDFG settings"
            description="New Object-Centric Directly Follows Graph (OCDFG) visualization with ELK layout."
            initial={{ showControls, initialInteractionLocked, layoutDirection }}
            sketchHint={OCDFG_SKETCH_HINT}
            onApply={(next) => {
              handleShowControlsChange(next.showControls);
              handleInitialInteractionLockedChange(next.initialInteractionLocked);
              handleLayoutDirectionChange(next.layoutDirection);
              setSettingsOpen(false);
            }}
            onCancel={() => setSettingsOpen(false)}
          />
        </ChartSettingsDialog>
      </WidgetDraftTile>
    );
  }

  // VIEW MODE: Render NewOCDFGVisualizer
  return (
    <div className="w-full h-full flex flex-col">
      <WidgetFilterHeader title="Object-Centric DFG (Arc Weight)" filterEnabled={filterEnabled} onToggle={() => setFilterEnabled(p => !p)} fileId={selectedFile?.id} onLocalFilterChange={setLocalFilterParams} />
      <div style={{ flex: 1, minHeight: 0, background: '#fff' }}>
        <ReactFlowProvider>
          <NewOCDFGVisualizer
            height="100%"
            fileId={selectedFile?.id}
            showControls={showControls}
            initialInteractionLocked={initialInteractionLocked}
            layoutDirection={layoutDirection}
            filterEnabled={filterEnabled}
            localFilterParams={localFilterParams}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
};


export const NewOCDFGVariantsComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [showControls, setShowControls] = useState(node.show_controls ?? true);
  const [initialInteractionLocked, setInitialInteractionLocked] = useState(node.initial_interaction_locked ?? true);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>(node.layout_direction ?? 'TB');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setShowControls(node.show_controls ?? true);
    setInitialInteractionLocked(node.initial_interaction_locked ?? true);
    setLayoutDirection(node.layout_direction ?? 'TB');
  }, [node.show_controls, node.initial_interaction_locked, node.layout_direction]);

  const handleShowControlsChange = (checked: boolean) => {
    setShowControls(checked);
    onUpdate?.({ show_controls: checked });
  };

  const handleInitialInteractionLockedChange = (checked: boolean) => {
    setInitialInteractionLocked(checked);
    onUpdate?.({ initial_interaction_locked: checked });
  };

  const handleLayoutDirectionChange = (value: string) => {
    setLayoutDirection(value as 'TB' | 'LR');
    onUpdate?.({ layout_direction: value as "TB" | "LR" });
  };

  if (isEditMode) {
    // EDIT MODE: the tile shows a draft of the graph; the settings open in a popup.
    return (
      <WidgetDraftTile
        typeLabel="OCDFG (variants)"
        hint={OCDFG_SKETCH_HINT}
        onConfigure={() => setSettingsOpen(true)}
        sketch={
          <OcdfgSketch
            layoutDirection={layoutDirection}
            showControls={showControls}
            interactionLocked={initialInteractionLocked}
            className="h-full w-full"
          />
        }
      >
        <ChartSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <OcdfgSettingsBody
            id={`ocdfg-variants-${node.component_id}`}
            heading="OCDFG (variants) settings"
            description="Object-Centric Directly Follows Graph (OCDFG) visualization with Variant/Trace filtering."
            initial={{ showControls, initialInteractionLocked, layoutDirection }}
            sketchHint={OCDFG_SKETCH_HINT}
            onApply={(next) => {
              handleShowControlsChange(next.showControls);
              handleInitialInteractionLockedChange(next.initialInteractionLocked);
              handleLayoutDirectionChange(next.layoutDirection);
              setSettingsOpen(false);
            }}
            onCancel={() => setSettingsOpen(false)}
          />
        </ChartSettingsDialog>
      </WidgetDraftTile>
    );
  }

  // VIEW MODE: Render NewOCDFGVariantsVisualizer
  return (
    <div className="w-full h-full">
      <ReactFlowProvider>
        <NewOCDFGVariantsVisualizer
          height="100%"
          fileId={selectedFile?.id}
          showControls={showControls}
          initialInteractionLocked={initialInteractionLocked}
          layoutDirection={layoutDirection}
          filterEnabled={filterEnabled}
          onToggleFilter={() => setFilterEnabled(p => !p)}
        />
      </ReactFlowProvider>
    </div>
  );
};


const OCCN_SKETCH_HINT =
  "Layout preview: start and end per object type, activities striped in their object types' colors, colored arcs and the binding markers next to the activities, in the chosen direction. The net itself is discovered from the log; names are placeholders.";

// OCCNComponent: Dashboard wrapper for the Object-Centric Causal Net (ELK layout)
export const OCCNComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [localFilterParams, setLocalFilterParams] = useState<Record<string, string>>({});
  const [threshold, setThreshold] = useState(node.relative_occurrence_threshold ?? 0);
  const [objectTypes, setObjectTypes] = useState(node.object_types ?? '');
  const [showControls, setShowControls] = useState(node.show_controls ?? true);
  const [initialInteractionLocked, setInitialInteractionLocked] = useState(node.initial_interaction_locked ?? true);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>(node.layout_direction ?? 'LR');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setThreshold(node.relative_occurrence_threshold ?? 0);
    setObjectTypes(node.object_types ?? '');
    setShowControls(node.show_controls ?? true);
    setInitialInteractionLocked(node.initial_interaction_locked ?? true);
    setLayoutDirection(node.layout_direction ?? 'LR');
  }, [
    node.relative_occurrence_threshold,
    node.object_types,
    node.show_controls,
    node.initial_interaction_locked,
    node.layout_direction,
  ]);

  const handleThresholdChange = (value: number[]) => {
    const next = value[0] ?? 0;
    setThreshold(next);
    onUpdate?.({ relative_occurrence_threshold: next });
  };

  const handleObjectTypesChange = (value: string) => {
    setObjectTypes(value);
    onUpdate?.({ object_types: value });
  };

  const handleShowControlsChange = (checked: boolean) => {
    setShowControls(checked);
    onUpdate?.({ show_controls: checked });
  };

  const handleInitialInteractionLockedChange = (checked: boolean) => {
    setInitialInteractionLocked(checked);
    onUpdate?.({ initial_interaction_locked: checked });
  };

  const handleLayoutDirectionChange = (value: string) => {
    setLayoutDirection(value as 'TB' | 'LR');
    onUpdate?.({ layout_direction: value as "TB" | "LR" });
  };

  if (isEditMode) {
    // EDIT MODE: the tile shows a draft of the net; the settings open in a popup.
    return (
      <WidgetDraftTile
        typeLabel="OC causal net"
        hint={OCCN_SKETCH_HINT}
        onConfigure={() => setSettingsOpen(true)}
        sketch={
          <OccnSketch
            layoutDirection={layoutDirection}
            showControls={showControls}
            interactionLocked={initialInteractionLocked}
            threshold={threshold}
            className="h-full w-full"
          />
        }
      >
        <ChartSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <OccnSettingsBody
            id={`occn-${node.component_id}`}
            initial={{ threshold, objectTypes, showControls, initialInteractionLocked, layoutDirection }}
            sketchHint={OCCN_SKETCH_HINT}
            onApply={(next) => {
              handleThresholdChange([next.threshold]);
              handleObjectTypesChange(next.objectTypes);
              handleShowControlsChange(next.showControls);
              handleInitialInteractionLockedChange(next.initialInteractionLocked);
              handleLayoutDirectionChange(next.layoutDirection);
              setSettingsOpen(false);
            }}
            onCancel={() => setSettingsOpen(false)}
          />
        </ChartSettingsDialog>
      </WidgetDraftTile>
    );
  }

  // VIEW MODE: Render OCCNVisualizer
  return (
    <div className="w-full h-full flex flex-col">
      <WidgetFilterHeader title="OC Causal Net" filterEnabled={filterEnabled} onToggle={() => setFilterEnabled(p => !p)} fileId={selectedFile?.id} onLocalFilterChange={setLocalFilterParams} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlowProvider>
          <OCCNVisualizer
            height="100%"
            fileId={selectedFile?.id}
            localFilterParams={localFilterParams}
            showControls={showControls}
            showTitle={false}
            initialInteractionLocked={initialInteractionLocked}
            initialLayoutDirection={layoutDirection}
            initialThreshold={threshold}
            objectTypes={objectTypes.split(',').map((t) => t.trim()).filter(Boolean)}
            filterEnabled={filterEnabled}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
};


const OCPN_SKETCH_HINT =
  "Layout preview: places in their object type's color (start and end filled), transitions with their type dots, a silent transition, and variable arcs as double lines. The net itself is discovered from the log; names are placeholders.";

// OCPNComponent: Dashboard wrapper for the OC Petri Net discovery view.
// Settings: automatic loading (start discovery when the dashboard opens)
// and the discovery timeout in seconds.
export const OCPNComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [automaticLoading, setAutomaticLoading] = useState(node.automatic_loading ?? false);
  const [timeoutS, setTimeoutS] = useState<number>(node.timeout_s ?? 30);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [localFilterParams, setLocalFilterParams] = useState<Record<string, string>>({});

  // Sync with node when it changes (e.g. dashboard reloads with persisted values).
  useEffect(() => {
    setAutomaticLoading(node.automatic_loading ?? false);
    setTimeoutS(node.timeout_s ?? 30);
  }, [node.automatic_loading, node.timeout_s]);

  const handleAutomaticLoadingChange = (checked: boolean) => {
    setAutomaticLoading(checked);
    onUpdate?.({ automatic_loading: checked });
  };

  const handleTimeoutChange = (raw: string) => {
    const n = Number(raw);
    const safe = Number.isFinite(n) && n > 0 ? n : 30;
    setTimeoutS(safe);
    onUpdate?.({ timeout_s: safe });
  };

  if (isEditMode) {
    // EDIT MODE: the tile shows a draft of the net; the settings open in a popup.
    return (
      <WidgetDraftTile
        typeLabel="OC Petri net"
        hint={OCPN_SKETCH_HINT}
        onConfigure={() => setSettingsOpen(true)}
        sketch={<OcpnSketch className="h-full w-full" />}
      >
        <ChartSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <OcpnSettingsBody
            id={`ocpn-${node.component_id}`}
            initial={{ automaticLoading, timeoutS }}
            sketchHint={OCPN_SKETCH_HINT}
            onApply={(next) => {
              handleAutomaticLoadingChange(next.automaticLoading);
              handleTimeoutChange(String(next.timeoutS));
              setSettingsOpen(false);
            }}
            onCancel={() => setSettingsOpen(false)}
          />
        </ChartSettingsDialog>
      </WidgetDraftTile>
    );
  }

  // VIEW MODE: Render the OCPN visualizer with stored settings
  return (
    <div className="w-full h-full flex flex-col bg-white">
      <WidgetFilterHeader title="OC Petri Net" filterEnabled={filterEnabled} onToggle={() => setFilterEnabled(p => !p)} fileId={selectedFile?.id} onLocalFilterChange={setLocalFilterParams} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <OCPNVisualizer
          height="100%"
          fileId={selectedFile?.id}
          autoStart={automaticLoading}
          defaultTimeoutS={timeoutS}
          showControls={true}
          filterEnabled={filterEnabled}
          localFilterParams={localFilterParams}
          onTimeoutSChange={(t) => {
            setTimeoutS(t);
            onUpdate?.({ timeout_s: t } as Partial<typeof node>);
          }}
        />
      </div>
    </div>
  );
};



// SqlQueryComponent: dashboard-grid adapter around the standalone
// SqlQueryEditor (frontend/src/react_component/SqlQueryEditor.tsx). All
// behavior lives there; this just maps the GridStack node/onUpdate contract
// onto SqlQueryEditor's plain value/onChange props.

export const SqlQueryComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  const value: SqlQueryConfig = {
    name: node.name ?? "",
    query: node.query ?? SQL_QUERY_DEFAULT,
    rowLimit: node.row_limit ?? 25,
  };
  // The grid host does not re-render this tree on onUpdate, so the link is
  // mirrored in local state (same reason SqlQueryEditor keeps its own text).
  const [linkedQuery, setLinkedQuery] = useState<LinkedQuery | null>(
    node.query_asset
      ? { id: node.query_asset, name: node.query_asset_name ?? `stored query #${node.query_asset}` }
      : null
  );
  useEffect(() => {
    setLinkedQuery(
      node.query_asset
        ? { id: node.query_asset, name: node.query_asset_name ?? `stored query #${node.query_asset}` }
        : null
    );
  }, [node.query_asset, node.query_asset_name]);

  const handleChange = (patch: Partial<SqlQueryConfig>) => {
    const update: Partial<GridStackNode> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.query !== undefined) update.query = patch.query;
    if (patch.rowLimit !== undefined) update.row_limit = patch.rowLimit;
    onUpdate?.(update);
  };

  const handleLinkChange = (link: LinkedQuery | null) => {
    setLinkedQuery(link);
    onUpdate?.({ query_asset: link?.id ?? null, query_asset_name: link?.name ?? null });
  };

  // Edit mode: a draft of the result table, the settings in a popup. The
  // applied values are mirrored in local state for the draft, like the link.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [applied, setApplied] = useState({ name: value.name, query: value.query, rowLimit: value.rowLimit });
  useEffect(() => {
    setApplied({ name: value.name, query: value.query, rowLimit: value.rowLimit });
  }, [value.name, value.query, value.rowLimit]);

  // The draft's column names: looked up with a one-row query in edit mode,
  // again whenever the query or the link changes.
  const discovery = useColumnDiscovery(selectedFile?.id, applied.query, linkedQuery?.id);
  const { discover } = discovery;
  useEffect(() => {
    if (isEditMode && selectedFile?.id && (applied.query.trim() || linkedQuery)) void discover();
  }, [isEditMode, discover, selectedFile?.id, applied.query, linkedQuery]);
  const draftColumns =
    discovery.resultFor === discoveryKey(applied.query, linkedQuery?.id) ? discovery.columns : undefined;

  const applySettings = (next: SqlTableSettings) => {
    setApplied({ name: next.name, query: next.query, rowLimit: next.rowLimit });
    setLinkedQuery(next.linked);
    onUpdate?.({
      name: next.name,
      query: next.query,
      row_limit: next.rowLimit,
      query_asset: next.linked?.id ?? null,
      query_asset_name: next.linked?.name ?? null,
    });
  };

  if (isEditMode) {
    return (
      <WidgetDraftTile
        typeLabel="SQL editor"
        hint="Layout preview of the result table: grey bars for the values, and the paging with your rows per page. The real result is shown when you leave edit mode."
        onConfigure={() => setSettingsOpen(true)}
        sketch={
          <SqlTableSketch
            name={applied.name}
            linked={Boolean(linkedQuery)}
            columns={draftColumns}
            rowsPerPage={applied.rowLimit}
            className="h-full w-full"
          />
        }
      >
        <SqlTableSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          widgetId={node.component_id}
          settings={{ ...applied, linked: linkedQuery }}
          onApply={applySettings}
          fileId={selectedFile?.id}
          projectId={selectedFile?.project}
        />
      </WidgetDraftTile>
    );
  }

  return (
    <SqlQueryEditor
      value={value}
      onChange={handleChange}
      isEditMode={isEditMode}
      fileId={selectedFile?.id}
      projectId={selectedFile?.project}
      linkedQuery={linkedQuery}
      onLinkChange={handleLinkChange}
    />
  );
};


// Dashboard widget registry (component_name -> renderer) lives in
// componentMapRegistry.ts — see the comment there for why it's split out.
