import React, { useState, useEffect, useContext, useCallback, useMemo } from "react";
import axios from "axios";
import { Textarea } from '@/components/ui/textarea'; // ShadCN Textarea
import { Button } from '@/components/ui/button'; // ShadCN Button
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { GridStackNode } from 'gridstack';
import { SelectedFileContext } from '@/contexts/SelectedFileContext';
import { processFile } from '@/api/fileApi';
import { Input } from '@/components/ui/input';
import { uploadImageToComponent } from "@/api/componentsApi";
import VariantsExplorer, {
  EXTRACTION_OPTIONS,
  ISO_OPTIONS,
  type Extraction,
  type IsoStrategy,
} from '@/react_component/VariantsExplorer';
import ProcessArea from '@/react_component/ProcessArea';
import {
  clampProcessAreaParams,
  DEFAULT_PROCESS_AREA_ALGORITHM,
  PROCESS_AREA_ALGORITHM_LABELS,
  PROCESS_AREA_PARAM_RANGES,
  type ProcessAreaAlgorithm,
  type ProcessAreaParams,
} from '@/react_component/TotemVisualizer';
import { ReactFlowProvider } from "@xyflow/react";
import OCDFGVisualizer from '@/react_component/OCDFGVisualizer';
import DottedChart from '@/react_component/DottedChart';
import {
  DottedChartControls,
  type DottedChartConfig,
} from '@/react_component/dottedChart/DottedChartControls';
import {
  axisOptionToParam,
  type AxisOption,
  type RowOrderOption,
} from '@/react_component/dottedChart/dottedChartUtils';
import TotemMiner from '@/react_component/TotemMiner';
import NewOCDFGVisualizer from '@/react_component/NewOCDFGVisualizer';
import NewOCDFGVariantsVisualizer from '@/react_component/NewOCDFGVariantsVisualizer';
import OCPNVisualizer from '@/react_component/OCPNVisualizer';
import OCCNVisualizer from '@/react_component/OCCNVisualizer';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import LogStatistics from './LogStatistics';
import SQLQueryComponent from './SQLQueryComponent';
import PieChartComponent from './PieChartComponent';
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

// Define props interface for components (extend as needed)
interface ComponentProps {
  node: GridStackNode & {
    component_id: number;
    component_name?: string;
    text?: string;
    font_size?: number;
    color?: string;
    image?: string;
    automatic_loading?: boolean;
    leading_object_type?: string;
    // Persisted advanced settings for the Variants Explorer
    extraction?: "leading_1hop" | "leading_bfs" | "connected";
    iso?: "db_signature" | "trace" | "signature" | "wl" | "wl+vf2" | "exact";
    timeout_s?: number;
    // LogStatisticsComponent properties
    show_num_events?: boolean;
    show_num_activities?: boolean;
    show_num_objects?: boolean;
    show_num_object_types?: boolean;
    show_earliest_timestamp?: boolean;
    show_newest_timestamp?: boolean;
    show_duration?: boolean;
    // OCDFGComponent properties
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
  };
  onUpdate?: (updates: Partial<GridStackNode>) => void;
  isEditMode?: boolean; // Now passed globally
  dashboardId: number;  // Added for API calls
  selectedFile?: { id: number; [key: string]: any }; // Selected event log file
}


// TextBoxComponent: Editable text with ShadCN UI
const TextBoxComponent: React.FC<ComponentProps> = ({ node, onUpdate, isEditMode = false }) => {
  //console.log('TextBoxComponent render - isEditMode:', isEditMode, 'node.text:', node.text);
  const [text, setText] = React.useState(node.text || 'Enter text here');
  // Sync local state with node.text when it changes (e.g., from loading or updates)
  React.useEffect(() => {
    //console.log('TextBoxComponent useEffect - updating text to:', node.text);
    setText(node.text || 'Enter text here');
  }, [node.text]);

  const handleTextChange = (value: string) => {
    //console.log('TextBoxComponent handleTextChange - new value:', value);
    setText(value);
    onUpdate?.({ text: value });
  };

  return (
    <div style={{ height: '100%', width: '100%',fontSize: node.font_size || 14 }}>
      {isEditMode ? (
        // Edit mode: Editable
        <Card className="w-full h-full min-h-80 rounded-none">
          
          <CardContent>
            <Textarea
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="Type here..."
            className="w-full h-full resize-none"
          />
          </CardContent>
        </Card>
        
      ) : (
        // Normal mode: Read-only
        <Card className="w-full h-full min-h-80 rounded-none">
          <CardContent>
            <div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};


// NumberOfEventsComponent: Static display with a button (customize as needed)
const NumberOfEventsComponent: React.FC<ComponentProps> = ({ selectedFile, node, isEditMode = false }) => {
  const [processedResult, setProcessedResult] = useState(null);

  
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  console.log("selectedFile start:", selectedFile);

  useEffect(() => {
    const handleProcessFile = async () => {
      
      
      if (!selectedFile?.id) {
        console.log("No file selected, skipping processing");
        setProcessedResult(null);
        return;
      }
      
      setIsLoading(true);
      setError(null);

      try {
        const result = await processFile(selectedFile.id);
        setProcessedResult(result);
        console.log("Processing result:", result);
      } catch (err) {
        console.error("Failed to process file in NumberOfEventsComponent:", err);
        setError("Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };
    
    handleProcessFile();
  }, [selectedFile]); // Only re-run when selectedFile changes

  return (
    <div style={{width: '100%', height: '100%', color: node.color, textAlign: 'center' }}>
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardDescription>
            Number of Events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{processedResult || 'Loading...'}</p>
        </CardContent>
      </Card>
    </div>
  );
};


const ImageComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  dashboardId,
}) => {
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      const data = await uploadImageToComponent(
        dashboardId,
        node.component_id,
        file
      );

      // Single source of truth
      onUpdate?.({ image: data.image });
    } catch (error) {
      console.error("Upload error:", error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="w-full h-full rounded-none">
      

      
        {isEditMode ? (
          <><CardHeader>
              <CardTitle>Image Component</CardTitle>
            </CardHeader>
            <CardContent>
            <Input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              disabled={uploading}
            />
            </CardContent>

            {uploading && <p>Uploading...</p>}
          </>
        ) : node.image ? (
          <CardContent>
          
          <img
            src={`http://localhost:8000${node.image}`}
            alt="Uploaded"
            className="w-full h-full object-cover"
          />
          </CardContent>) : (<CardContent>
          <p>No image uploaded</p>
        </CardContent>)
          
        }
    </Card>
  );
};


// VariantsComponent: Wrapper for VariantsExplorer with configurable settings
const VariantsComponent: React.FC<ComponentProps> = ({
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
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);

  // Sync with node when it changes (e.g. dashboard reloads with persisted values).
  useEffect(() => {
    setAutomaticLoading(node.automatic_loading ?? false);
    setLeadingType(node.leading_object_type ?? '');
    setExtraction((node.extraction as Extraction) ?? 'leading_1hop');
    setIso((node.iso as IsoStrategy) ?? 'wl+vf2');
    setTimeoutS(node.timeout_s ?? 10);
  }, [
    node.automatic_loading,
    node.leading_object_type,
    node.extraction,
    node.iso,
    node.timeout_s,
  ]);

  // Fetch object types when file changes (for edit mode dropdown)
  useEffect(() => {
    if (!selectedFile?.id || !isEditMode) return;

    const fetchTypes = async () => {
      setLoadingTypes(true);
      try {
        const { data } = await axios.get(`/api/files/${selectedFile.id}/object_types/`);
        setAvailableTypes(data.sort());
      } catch (err) {
        console.error('Failed to fetch object types:', err);
      } finally {
        setLoadingTypes(false);
      }
    };
    fetchTypes();
  }, [selectedFile?.id, isEditMode]);

  // Handlers for form changes
  const handleAutomaticLoadingChange = (checked: boolean) => {
    setAutomaticLoading(checked);
    onUpdate?.({ automatic_loading: checked } as any);
  };

  const handleLeadingTypeChange = (value: string) => {
    setLeadingType(value);
    onUpdate?.({ leading_object_type: value } as any);
  };

  const handleExtractionChange = (value: string) => {
    const v = value as Extraction;
    setExtraction(v);
    onUpdate?.({ extraction: v } as any);
  };

  const handleIsoChange = (value: string) => {
    const v = value as IsoStrategy;
    setIso(v);
    onUpdate?.({ iso: v } as any);
  };

  const handleTimeoutChange = (raw: string) => {
    const n = Number(raw);
    const safe = Number.isFinite(n) && n > 0 ? n : 10;
    setTimeoutS(safe);
    onUpdate?.({ timeout_s: safe } as any);
  };

  if (isEditMode) {
    // EDIT MODE: Configuration form
    const extractionOpt = EXTRACTION_OPTIONS.find((o) => o.value === extraction);
    const isoOpt = ISO_OPTIONS.find((o) => o.value === iso);
    const leadingTypeIgnored = extraction === 'connected';

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
                    ? '— (ignored for Connected components)'
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
          onAdvancedChange={(s) => {
            // Mirror the explorer's choices into our local state so this
            // wrapper stays in sync with what the user sees inside.
            setExtraction(s.extraction);
            setIso(s.iso);
            setTimeoutS(s.timeout_s);
            onUpdate?.({
              extraction: s.extraction,
              iso: s.iso,
              timeout_s: s.timeout_s,
            } as any);
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
const PROCESS_AREA_PARAM_FIELDS: Array<{
  nodeKey: 'w_temporal' | 'w_cardinality' | 'w_divergence' | 'alpha' | 'beta';
  paramKey: keyof ProcessAreaParams;
  label: string;
}> = [
  { nodeKey: 'w_temporal', paramKey: 'wTemporal', label: 'Temporal weight' },
  { nodeKey: 'w_cardinality', paramKey: 'wCardinality', label: 'Cardinality weight' },
  { nodeKey: 'w_divergence', paramKey: 'wDivergence', label: 'Divergence weight' },
  { nodeKey: 'alpha', paramKey: 'alpha', label: 'Separation (α)' },
  { nodeKey: 'beta', paramKey: 'beta', label: 'Cohesion (β)' },
];

const ProcessAreaComponent: React.FC<ComponentProps> = ({
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
      } as any);
    },
    [onUpdate],
  );

  if (isEditMode) {
    // EDIT MODE: Show configuration controls
    return (
      <Card className="w-full h-full rounded-none overflow-y-auto">
        <CardHeader>
          <CardTitle>Process Area Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The Process Area visualizes the object-type hierarchy of your event log.
            Select an event log file to see the visualization.
          </p>
          <div className="flex items-center justify-between">
            <Label>Discovery algorithm</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[240px] justify-between font-normal">
                  <span className="truncate">{PROCESS_AREA_ALGORITHM_LABELS[algorithm]}</span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[240px]">
                <DropdownMenuRadioGroup
                  value={algorithm}
                  onValueChange={(value) =>
                    handleSettingsChange({
                      algorithm: value as ProcessAreaAlgorithm,
                      params,
                    })
                  }
                >
                  {(Object.keys(PROCESS_AREA_ALGORITHM_LABELS) as ProcessAreaAlgorithm[]).map(
                    (value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {PROCESS_AREA_ALGORITHM_LABELS[value]}
                      </DropdownMenuRadioItem>
                    ),
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {algorithm === 'advanced' &&
            PROCESS_AREA_PARAM_FIELDS.map(({ nodeKey, paramKey, label }) => (
              <div className="space-y-2" key={nodeKey}>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`process-area-${nodeKey}`}>{label}</Label>
                  <span className="text-sm text-muted-foreground">
                    {params[paramKey].toFixed(2)}
                  </span>
                </div>
                <Slider
                  id={`process-area-${nodeKey}`}
                  {...PROCESS_AREA_PARAM_RANGES[paramKey]}
                  value={[params[paramKey]]}
                  onValueChange={(values) =>
                    handleSettingsChange({
                      algorithm,
                      params: { ...params, [paramKey]: values?.[0] ?? 0 },
                    })
                  }
                />
              </div>
            ))}
        </CardContent>
      </Card>
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
const TotemMinerComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  if (isEditMode) {
    // EDIT MODE: Show configuration placeholder
    return (
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardTitle>TOTeM Miner</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The TOTeM Miner discovers and visualizes the structure of your event log.
          </p>
          <p className="text-sm text-muted-foreground">
            {selectedFile 
              ? `Currently analyzing: ${selectedFile.name || selectedFile.filename || 'Event Log'}`
              : 'Automatically analyzing the current project\'s event log.'}
          </p>
        </CardContent>
      </Card>
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


// LogStatisticsComponent: Dashboard wrapper for LogStatistics with edit mode
const LogStatisticsComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  // Local state for toggle values (synced with node for edit mode)
  const [showNumEvents, setShowNumEvents] = useState(node.show_num_events ?? true);
  const [showNumActivities, setShowNumActivities] = useState(node.show_num_activities ?? true);
  const [showNumObjects, setShowNumObjects] = useState(node.show_num_objects ?? true);
  const [showNumObjectTypes, setShowNumObjectTypes] = useState(node.show_num_object_types ?? true);
  const [showEarliestTimestamp, setShowEarliestTimestamp] = useState(node.show_earliest_timestamp ?? false);
  const [showNewestTimestamp, setShowNewestTimestamp] = useState(node.show_newest_timestamp ?? false);
  const [showDuration, setShowDuration] = useState(node.show_duration ?? false);

  // Sync with node when it changes
  useEffect(() => {
    setShowNumEvents(node.show_num_events ?? true);
    setShowNumActivities(node.show_num_activities ?? true);
    setShowNumObjects(node.show_num_objects ?? true);
    setShowNumObjectTypes(node.show_num_object_types ?? true);
    setShowEarliestTimestamp(node.show_earliest_timestamp ?? false);
    setShowNewestTimestamp(node.show_newest_timestamp ?? false);
    setShowDuration(node.show_duration ?? false);
  }, [node.show_num_events, node.show_num_activities, node.show_num_objects, node.show_num_object_types, node.show_earliest_timestamp, node.show_newest_timestamp, node.show_duration]);

  // Handlers for toggle changes
  const handleShowNumEventsChange = (checked: boolean) => {
    setShowNumEvents(checked);
    onUpdate?.({ show_num_events: checked } as any);
  };
  const handleShowNumActivitiesChange = (checked: boolean) => {
    setShowNumActivities(checked);
    onUpdate?.({ show_num_activities: checked } as any);
  };
  const handleShowNumObjectsChange = (checked: boolean) => {
    setShowNumObjects(checked);
    onUpdate?.({ show_num_objects: checked } as any);
  };
  const handleShowNumObjectTypesChange = (checked: boolean) => {
    setShowNumObjectTypes(checked);
    onUpdate?.({ show_num_object_types: checked } as any);
  };
  const handleShowEarliestTimestampChange = (checked: boolean) => {
    setShowEarliestTimestamp(checked);
    onUpdate?.({ show_earliest_timestamp: checked } as any);
  };
  const handleShowNewestTimestampChange = (checked: boolean) => {
    setShowNewestTimestamp(checked);
    onUpdate?.({ show_newest_timestamp: checked } as any);
  };
  const handleShowDurationChange = (checked: boolean) => {
    setShowDuration(checked);
    onUpdate?.({ show_duration: checked } as any);
  };

  if (isEditMode) {
    // EDIT MODE: Configuration form with toggles
    return (
      <Card className="w-full h-full rounded-none overflow-auto">
        <CardHeader>
          <CardTitle>Log Statistics Settings</CardTitle>
          <CardDescription>Select which statistics to display</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="show-events">Number of Events</Label>
            <Switch id="show-events" checked={showNumEvents} onCheckedChange={handleShowNumEventsChange} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="show-activities">Number of Activities</Label>
            <Switch id="show-activities" checked={showNumActivities} onCheckedChange={handleShowNumActivitiesChange} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="show-objects">Number of Objects</Label>
            <Switch id="show-objects" checked={showNumObjects} onCheckedChange={handleShowNumObjectsChange} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="show-object-types">Number of Object Types</Label>
            <Switch id="show-object-types" checked={showNumObjectTypes} onCheckedChange={handleShowNumObjectTypesChange} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="show-earliest">Earliest Timestamp</Label>
            <Switch id="show-earliest" checked={showEarliestTimestamp} onCheckedChange={handleShowEarliestTimestampChange} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="show-newest">Newest Timestamp</Label>
            <Switch id="show-newest" checked={showNewestTimestamp} onCheckedChange={handleShowNewestTimestampChange} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="show-duration">Duration</Label>
            <Switch id="show-duration" checked={showDuration} onCheckedChange={handleShowDurationChange} />
          </div>
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE: Delegate to reusable LogStatistics component
  return (
    <LogStatistics
      fileId={selectedFile?.id}
      showNumEvents={showNumEvents}
      showNumActivities={showNumActivities}
      showNumObjects={showNumObjects}
      showNumObjectTypes={showNumObjectTypes}
      showEarliestTimestamp={showEarliestTimestamp}
      showNewestTimestamp={showNewestTimestamp}
      showDuration={showDuration}
      className="w-full h-full"
    />
  );
};


// OCDFGComponent: Dashboard wrapper for Object-Centric Directly Follows Graph
const OCDFGComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [showControls, setShowControls] = useState(node.show_controls ?? true);
  const [initialInteractionLocked, setInitialInteractionLocked] = useState(node.initial_interaction_locked ?? true);

  useEffect(() => {
    setShowControls(node.show_controls ?? true);
    setInitialInteractionLocked(node.initial_interaction_locked ?? true);
  }, [node.show_controls, node.initial_interaction_locked]);

  const handleShowControlsChange = (checked: boolean) => {
    setShowControls(checked);
    onUpdate?.({ show_controls: checked } as any);
  };

  const handleInitialInteractionLockedChange = (checked: boolean) => {
    setInitialInteractionLocked(checked);
    onUpdate?.({ initial_interaction_locked: checked } as any);
  };

  if (isEditMode) {
    // EDIT MODE: Show configuration controls
    return (
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardTitle>OCDFG Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Object-Centric Directly Follows Graph (OCDFG) visualization.
          </p>
          <div className="flex items-center justify-between">
            <Label htmlFor="show-controls">Show Controls Panel</Label>
            <Switch
              id="show-controls"
              checked={showControls}
              onCheckedChange={handleShowControlsChange}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="initial-locked">Lock Interactions Initially</Label>
            <Switch
              id="initial-locked"
              checked={initialInteractionLocked}
              onCheckedChange={handleInitialInteractionLockedChange}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE: Render OCDFGVisualizer
  return (
    <div className="w-full h-full bg-white">
      <ReactFlowProvider>
        <NewOCDFGVisualizer
          height="100%"
          fileId={selectedFile?.id}
          showControls={showControls}
          initialInteractionLocked={initialInteractionLocked}
        />
      </ReactFlowProvider>
    </div>
  );
};

const DOTTED_CHART_DEFAULT_CONFIG: DottedChartConfig = {
  xAxis: { type: "time" },
  yAxis: { type: "activity" },
  colorBy: { type: "activity" },
  shapeBy: { type: "none" },
  rowOrder: "first_occurrence",
  maxPoints: 10000,
};

// OCDottedChartComponent: Dashboard wrapper for Object-Centric Dotted Chart
const OCDottedChartComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  const effectiveFileId = selectedFile?.id;
  const config = nodeToDottedChartConfig(node);

  const handleConfigChange = (nextConfig: DottedChartConfig) => {
    onUpdate?.({
      x_axis: axisOptionToPersistedValue(nextConfig.xAxis),
      y_axis: axisOptionToPersistedValue(nextConfig.yAxis),
      color_by: axisOptionToPersistedValue(nextConfig.colorBy),
      shape_by: axisOptionToPersistedValue(nextConfig.shapeBy),
      row_order: nextConfig.rowOrder,
      max_points: nextConfig.maxPoints,
    } as any);
  };

  if (isEditMode) {
    return (
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardTitle>OC Dotted Chart Settings</CardTitle>
          <CardDescription>Configure the dashboard widget.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 overflow-auto">
          <DottedChartControls
            fileId={effectiveFileId}
            config={config}
            onConfigChange={handleConfigChange}
          />
          {!effectiveFileId && (
            <p className="text-sm text-muted-foreground">
              Select an event log in the application sidebar to render this widget.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full h-full rounded-none overflow-auto">
      <CardContent className="h-full p-0">
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
          className="h-full"
        />
      </CardContent>
    </Card>
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


// NewOCDFGComponent: Dashboard wrapper for the new Object-Centric Directly Follows Graph (ELK layout)
const NewOCDFGComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [showControls, setShowControls] = useState(node.show_controls ?? true);
  const [initialInteractionLocked, setInitialInteractionLocked] = useState(node.initial_interaction_locked ?? true);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>(node.layout_direction ?? 'TB');

  useEffect(() => {
    setShowControls(node.show_controls ?? true);
    setInitialInteractionLocked(node.initial_interaction_locked ?? true);
    setLayoutDirection(node.layout_direction ?? 'TB');
  }, [node.show_controls, node.initial_interaction_locked, node.layout_direction]);

  const handleShowControlsChange = (checked: boolean) => {
    setShowControls(checked);
    onUpdate?.({ show_controls: checked } as any);
  };

  const handleInitialInteractionLockedChange = (checked: boolean) => {
    setInitialInteractionLocked(checked);
    onUpdate?.({ initial_interaction_locked: checked } as any);
  };

  const handleLayoutDirectionChange = (value: string) => {
    setLayoutDirection(value as 'TB' | 'LR');
    onUpdate?.({ layout_direction: value } as any);
  };

  if (isEditMode) {
    // EDIT MODE: Show configuration controls
    return (
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardTitle>New OCDFG (ELK) Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            New Object-Centric Directly Follows Graph (OCDFG) visualization with ELK layout.
          </p>
          <div className="flex items-center justify-between">
            <Label htmlFor="new-show-controls">Show Controls Panel</Label>
            <Switch
              id="new-show-controls"
              checked={showControls}
              onCheckedChange={handleShowControlsChange}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="new-initial-locked">Lock Interactions Initially</Label>
            <Switch
              id="new-initial-locked"
              checked={initialInteractionLocked}
              onCheckedChange={handleInitialInteractionLockedChange}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Layout Direction</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[180px] justify-between font-normal">
                  <span>{layoutDirection === 'TB' ? 'Top to Bottom' : 'Left to Right'}</span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[180px]">
                <DropdownMenuRadioGroup value={layoutDirection} onValueChange={handleLayoutDirectionChange}>
                  <DropdownMenuRadioItem value="TB">Top to Bottom</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="LR">Left to Right</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE: Render NewOCDFGVisualizer
  return (
    <div className="w-full h-full bg-white">
      <ReactFlowProvider>
        <NewOCDFGVisualizer
          height="100%"
          fileId={selectedFile?.id}
          showControls={showControls}
          initialInteractionLocked={initialInteractionLocked}
          layoutDirection={layoutDirection}
        />
      </ReactFlowProvider>
    </div>
  );
};


const NewOCDFGVariantsComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [showControls, setShowControls] = useState(node.show_controls ?? true);
  const [initialInteractionLocked, setInitialInteractionLocked] = useState(node.initial_interaction_locked ?? true);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>(node.layout_direction ?? 'TB');

  useEffect(() => {
    setShowControls(node.show_controls ?? true);
    setInitialInteractionLocked(node.initial_interaction_locked ?? true);
    setLayoutDirection(node.layout_direction ?? 'TB');
  }, [node.show_controls, node.initial_interaction_locked, node.layout_direction]);

  const handleShowControlsChange = (checked: boolean) => {
    setShowControls(checked);
    onUpdate?.({ show_controls: checked } as any);
  };

  const handleInitialInteractionLockedChange = (checked: boolean) => {
    setInitialInteractionLocked(checked);
    onUpdate?.({ initial_interaction_locked: checked } as any);
  };

  const handleLayoutDirectionChange = (value: string) => {
    setLayoutDirection(value as 'TB' | 'LR');
    onUpdate?.({ layout_direction: value } as any);
  };

  if (isEditMode) {
    // EDIT MODE: Show configuration controls
    return (
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardTitle>OCDFG (Variants) Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Object-Centric Directly Follows Graph (OCDFG) visualization with Variant/Trace filtering.
          </p>
          <div className="flex items-center justify-between">
            <Label htmlFor="variants-show-controls">Show Controls Panel</Label>
            <Switch
              id="variants-show-controls"
              checked={showControls}
              onCheckedChange={handleShowControlsChange}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="variants-initial-locked">Lock Interactions Initially</Label>
            <Switch
              id="variants-initial-locked"
              checked={initialInteractionLocked}
              onCheckedChange={handleInitialInteractionLockedChange}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Layout Direction</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[180px] justify-between font-normal">
                  <span>{layoutDirection === 'TB' ? 'Top to Bottom' : 'Left to Right'}</span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[180px]">
                <DropdownMenuRadioGroup value={layoutDirection} onValueChange={handleLayoutDirectionChange}>
                  <DropdownMenuRadioItem value="TB">Top to Bottom</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="LR">Left to Right</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE: Render NewOCDFGVariantsVisualizer
  return (
    <div className="w-full h-full bg-white">
      <ReactFlowProvider>
        <NewOCDFGVariantsVisualizer
          height="100%"
          fileId={selectedFile?.id}
          showControls={showControls}
          initialInteractionLocked={initialInteractionLocked}
          layoutDirection={layoutDirection}
        />
      </ReactFlowProvider>
    </div>
  );
};


// OCCNComponent: Dashboard wrapper for the Object-Centric Causal Net (ELK layout)
const OCCNComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [threshold, setThreshold] = useState(node.relative_occurrence_threshold ?? 0);
  const [objectTypes, setObjectTypes] = useState(node.object_types ?? '');
  const [showControls, setShowControls] = useState(node.show_controls ?? true);
  const [initialInteractionLocked, setInitialInteractionLocked] = useState(node.initial_interaction_locked ?? true);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>(node.layout_direction ?? 'LR');

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
    onUpdate?.({ relative_occurrence_threshold: next } as any);
  };

  const handleObjectTypesChange = (value: string) => {
    setObjectTypes(value);
    onUpdate?.({ object_types: value } as any);
  };

  const handleShowControlsChange = (checked: boolean) => {
    setShowControls(checked);
    onUpdate?.({ show_controls: checked } as any);
  };

  const handleInitialInteractionLockedChange = (checked: boolean) => {
    setInitialInteractionLocked(checked);
    onUpdate?.({ initial_interaction_locked: checked } as any);
  };

  const handleLayoutDirectionChange = (value: string) => {
    setLayoutDirection(value as 'TB' | 'LR');
    onUpdate?.({ layout_direction: value } as any);
  };

  if (isEditMode) {
    // EDIT MODE: Show configuration controls
    return (
      <Card className="w-full h-full rounded-none overflow-y-auto">
        <CardHeader>
          <CardTitle>OCCN Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Object-Centric Causal Net (OCCN) with activity bindings and automatic ELK layout.
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="occn-threshold">Frequency Threshold</Label>
              <span className="text-sm text-muted-foreground">{threshold.toFixed(2)}</span>
            </div>
            <Slider
              id="occn-threshold"
              min={0}
              max={1}
              step={0.05}
              value={[threshold]}
              onValueChange={handleThresholdChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="occn-object-types">Object Type Filter</Label>
            <Input
              id="occn-object-types"
              value={objectTypes}
              onChange={(e) => handleObjectTypesChange(e.target.value)}
              placeholder="e.g. orders, items (empty = all types)"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated object types to include; leave empty to use all.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="occn-show-controls">Show Controls Panel</Label>
            <Switch
              id="occn-show-controls"
              checked={showControls}
              onCheckedChange={handleShowControlsChange}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="occn-initial-locked">Lock Interactions Initially</Label>
            <Switch
              id="occn-initial-locked"
              checked={initialInteractionLocked}
              onCheckedChange={handleInitialInteractionLockedChange}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Layout Direction</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[180px] justify-between font-normal">
                  <span>{layoutDirection === 'TB' ? 'Top to Bottom' : 'Left to Right'}</span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[180px]">
                <DropdownMenuRadioGroup value={layoutDirection} onValueChange={handleLayoutDirectionChange}>
                  <DropdownMenuRadioItem value="TB">Top to Bottom</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="LR">Left to Right</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE: Render OCCNVisualizer
  return (
    <div className="w-full h-full bg-white">
      <ReactFlowProvider>
        <OCCNVisualizer
          height="100%"
          fileId={selectedFile?.id}
          showControls={showControls}
          initialInteractionLocked={initialInteractionLocked}
          initialLayoutDirection={layoutDirection}
          initialThreshold={threshold}
          objectTypes={objectTypes.split(',').map((t) => t.trim()).filter(Boolean)}
        />
      </ReactFlowProvider>
    </div>
  );
};


// OCPNComponent: Dashboard wrapper for the OC Petri Net discovery view.
// Settings: automatic loading (start discovery when the dashboard opens)
// and the discovery timeout in seconds.
const OCPNComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [automaticLoading, setAutomaticLoading] = useState(node.automatic_loading ?? false);
  const [timeoutS, setTimeoutS] = useState<number>(node.timeout_s ?? 30);

  // Sync with node when it changes (e.g. dashboard reloads with persisted values).
  useEffect(() => {
    setAutomaticLoading(node.automatic_loading ?? false);
    setTimeoutS(node.timeout_s ?? 30);
  }, [node.automatic_loading, node.timeout_s]);

  const handleAutomaticLoadingChange = (checked: boolean) => {
    setAutomaticLoading(checked);
    onUpdate?.({ automatic_loading: checked } as any);
  };

  const handleTimeoutChange = (raw: string) => {
    const n = Number(raw);
    const safe = Number.isFinite(n) && n > 0 ? n : 30;
    setTimeoutS(safe);
    onUpdate?.({ timeout_s: safe } as any);
  };

  if (isEditMode) {
    // EDIT MODE: Configuration form
    return (
      <Card className="w-full h-full rounded-none overflow-auto">
        <CardHeader>
          <CardTitle>OC Petri Net Settings</CardTitle>
          <CardDescription>
            Discovers an Object-Centric Petri Net from the selected event log.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Automatic loading */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="ocpn-auto-loading">Start discovery automatically</Label>
              <p className="text-xs text-muted-foreground">
                Run OCPN discovery as soon as the dashboard loads.
              </p>
            </div>
            <Switch
              id="ocpn-auto-loading"
              checked={automaticLoading}
              onCheckedChange={handleAutomaticLoadingChange}
            />
          </div>

          {/* Timeout (seconds) */}
          <div className="space-y-2">
            <Label htmlFor="ocpn-timeout-setting">Timeout (seconds)</Label>
            <Input
              id="ocpn-timeout-setting"
              type="number"
              min={1}
              max={600}
              step={1}
              value={timeoutS}
              onChange={(e) => handleTimeoutChange(e.target.value)}
              className="w-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Wall-clock budget for the discovery. Increase it for large logs.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE: Render the OCPN visualizer with stored settings
  return (
    <div className="w-full h-full bg-white">
      <OCPNVisualizer
        height="100%"
        fileId={selectedFile?.id}
        autoStart={automaticLoading}
        defaultTimeoutS={timeoutS}
        showControls={true}
        onTimeoutSChange={(t) => {
          setTimeoutS(t);
          onUpdate?.({ timeout_s: t } as any);
        }}
      />
    </div>
  );
};


// Component map for easy lookup
export const componentMap: Record<string, React.FC<ComponentProps>> = {
  TextBoxComponent,
  NumberOfEventsComponent,
  ImageComponent,
  VariantsComponent,
  ProcessAreaComponent,
  TotemMinerComponent,
  LogStatisticsComponent,
  OCDFGComponent,
  OCDottedChartComponent,
  NewOCDFGComponent,
  NewOCDFGVariantsComponent,
  OCPNComponent,
  SQLQueryComponent,
  PieChartComponent,
  OCCNComponent,
};
