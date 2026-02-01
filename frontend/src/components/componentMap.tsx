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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
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


// Component map for easy lookup
export const componentMap: Record<string, React.FC<ComponentProps>> = {
  TextBoxComponent,
  NumberOfEventsComponent,
  ImageComponent,
  VariantsComponent,
  // Add more as needed, e.g., ChartComponent: ChartComponent,
};