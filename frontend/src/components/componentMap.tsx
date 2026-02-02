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

// Define props interface for components (extend as needed)
interface ComponentProps {
  node: GridStackNode & {
    component_id: number;
    component_name?: string;
    text?: string;
    font_size?: number;
    color?: string;
    image?: string;
  };
  onUpdate?: (updates: Partial<GridStackNode>) => void;
  isEditMode?: boolean; // Now passed globally
  dashboardId: number;  // Added for API calls
  selectedFile?: any;  // Optional, for components that need it
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
          <CardHeader>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              Edit text
            </CardTitle>
             <CardDescription>Click the field below to change title text
                
             </CardDescription>
         
          </CardHeader>
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


const ImageComponent: React.FC<ComponentProps> = ({ node, onUpdate, isEditMode = false, dashboardId }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(node.image || null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (node.image) {
    setImageUrl(node.image);
    console.log("Resolved imageUrl:", node.image);
  }
  }, [node?.image]);

  console.log('imageUrl in ImageComponent:', node.image);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    console.log('Selected file for upload [componentMap.tsx]:', file);
    console.log('node component_id:', node.component_id);
    if (!file) return;

    setUploading(true);
    const token = localStorage.getItem('access_token');
    try {
      console.log('node:', node);
      console.log('Uploading file to component ID:', node.component_id, 'for dashboard:', dashboardId);
      const data = await uploadImageToComponent(dashboardId, node.component_id, file, token);  // Updated call
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
            console.log("http://localhost:8000" + imageUrl),
            <img src={"http://localhost:8000" + imageUrl} alt="Uploaded" className="w-full h-full object-cover" />
          ) : (
            <p>No image uploaded</p>
          )
        )}
      </CardContent>
    </Card>
  );
};


// Component map for easy lookup
export const componentMap: Record<string, React.FC<ComponentProps>> = {
  TextBoxComponent,
  NumberOfEventsComponent,
  ImageComponent,
  // Add more as needed, e.g., ChartComponent: ChartComponent,
};