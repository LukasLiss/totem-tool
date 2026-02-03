import React, { useState, useEffect, useContext } from "react";
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
import VariantsExplorer from '@/react_component/VariantsExplorer';
import ProcessArea from '@/react_component/ProcessArea';
import { ReactFlowProvider } from "@xyflow/react";
import OCDFGVisualizer from '@/react_component/OCDFGVisualizer';
import { Switch } from '@/components/ui/switch';
import LogStatistics from './LogStatistics';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import Totem from '@/react_component/Totem';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Define props interface for components (extend as needed)
interface ComponentProps {
  node: GridStackNode & {
    component_name?: string;
    text?: string;
    font_size?: number;
    color?: string;
    image?: string;
    automatic_loading?: boolean;
    leading_object_type?: string;
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
    // TotemModelComponent properties
    initial_tau?: number;
  };
  onUpdate?: (updates: Partial<GridStackNode>) => void;
  isEditMode?: boolean; // Now passed globally
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
      
      const token = localStorage.getItem("access_token");
      if (!token) {
        setError("No access token found");
        setIsLoading(false);
        return;
      }
      
      try {
        const result = await processFile(token, selectedFile.id);
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
    <div style={{ padding: '10px', color: node.color || 'blue', textAlign: 'center' }}>
      <h3>Number of Events</h3>
      {isEditMode ? (
        // Edit mode: Editable (example: input for value)
        
          <Button onClick={() => alert('Refresh data!')} className="mt-2" variant="primary">
            Refresh Data
          </Button>
        
      ) : (
        // Normal mode: Read-only
        <>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>{processedResult || 'Loading...'}</p>
          <Button onClick={() => alert('Refresh data!')} variant="primary">
            Refresh
          </Button>
        </>
      )}
    </div>
  );
};


const ImageComponent: React.FC<ComponentProps> = ({ node, onUpdate, isEditMode = false }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(node.image || null);
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const token = localStorage.getItem('access_token');
    try {
      const data = await uploadImageToComponent(node.id, file, token);
      setImageUrl(data.image);
      onUpdate?.({ image: data.image });
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  };
  return (
    <Card className="w-full h-full rounded-none">
      <CardHeader>
        <CardTitle>Image Component</CardTitle>
      </CardHeader>
      <CardContent>
        {isEditMode ? (
          <>
            <Input type="file" accept="image/*" onChange={handleFileUpload} disabled={uploading} />
            {uploading && <p>Uploading...</p>}
          </>
        ) : (
          imageUrl ? (
            <img src={imageUrl} alt="Uploaded" className="w-full h-full object-cover" />
          ) : (
            <p>No image uploaded</p>
          )
        )}
      </CardContent>
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
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);

  // Sync with node when it changes
  useEffect(() => {
    setAutomaticLoading(node.automatic_loading ?? false);
    setLeadingType(node.leading_object_type ?? '');
  }, [node.automatic_loading, node.leading_object_type]);

  // Fetch object types when file changes (for edit mode dropdown)
  useEffect(() => {
    if (!selectedFile?.id || !isEditMode) return;

    const fetchTypes = async () => {
      setLoadingTypes(true);
      const token = localStorage.getItem('access_token');
      try {
        const res = await fetch(`/api/files/${selectedFile.id}/object_types/`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        if (res.ok) {
          const types = await res.json();
          setAvailableTypes(types.sort());
        }
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

  if (isEditMode) {
    // EDIT MODE: Configuration form
    return (
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardTitle>Variants Explorer Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
                <Button variant="outline" className="w-full justify-between">
                  {leadingType || 'Select object type (optional)'}
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
        />
      </CardContent>
    </Card>
  );
};


// ProcessAreaComponent: Wrapper for ProcessArea (Totem Visualizer)
const ProcessAreaComponent: React.FC<ComponentProps> = ({
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
          <CardTitle>Process Area Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The Process Area visualizes the totem/MLPA structure of your event log.
          </p>
          <p className="text-sm text-muted-foreground">
            Select an event log file to see the visualization.
          </p>
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
        <OCDFGVisualizer
          height="100%"
          fileId={selectedFile?.id}
          showControls={showControls}
          initialInteractionLocked={initialInteractionLocked}
        />
      </ReactFlowProvider>
    </div>
  );
};


// TotemModelComponent: Dashboard wrapper for TOTeM Model visualization
const TotemModelComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [initialTau, setInitialTau] = useState(node.initial_tau ?? 0.9);

  useEffect(() => {
    setInitialTau(node.initial_tau ?? 0.9);
  }, [node.initial_tau]);

  const handleTauChange = (value: number) => {
    setInitialTau(value);
    onUpdate?.({ initial_tau: value } as any);
  };

  if (isEditMode) {
    // EDIT MODE: Show configuration controls
    return (
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardTitle>TOTeM Model Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Label className="whitespace-nowrap">Initial τ: {initialTau.toFixed(2)}</Label>
            <Slider
              value={[initialTau]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={(v) => handleTauChange(v[0])}
              className="flex-1"
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE: Render Totem with configured initial tau
  return (
    <div className="w-full h-full overflow-hidden bg-white">
      <Totem
        fileId={selectedFile?.id}
        height="100%"
        embedded={true}
        automaticLoading={true}
        initialTau={initialTau}
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
  LogStatisticsComponent,
  OCDFGComponent,
  TotemModelComponent,
};