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

// Define props interface for components (extend as needed)
interface ComponentProps {
  node: GridStackNode & {
    component_name?: string;
    text?: string;
    font_size?: number;
    color?: string;
  };
  onUpdate?: (updates: Partial<GridStackNode>) => void;
  isEditMode?: boolean; // Now passed globally
}

// TextBoxComponent: Editable text with ShadCN UI
const TextBoxComponent: React.FC<ComponentProps> = ({ node, onUpdate, isEditMode = false }) => {
  console.log('TextBoxComponent render - isEditMode:', isEditMode, 'node.text:', node.text);
  const [text, setText] = React.useState(node.text || 'Enter text here');
  // Sync local state with node.text when it changes (e.g., from loading or updates)
  React.useEffect(() => {
    console.log('TextBoxComponent useEffect - updating text to:', node.text);
    setText(node.text || 'Enter text here');
  }, [node.text]);

  const handleTextChange = (value: string) => {
    console.log('TextBoxComponent handleTextChange - new value:', value);
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
          <CardHeader>
            <CardDescription>Total Revenue</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              $1,250.00
            </CardTitle>              
          </CardHeader>
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
const NumberOfEventsComponent: React.FC<ComponentProps> = ({ node, isEditMode = false }) => {
  const [processedResult, setProcessedResult] = useState(null);

  const { selectedFile } = useContext(SelectedFileContext);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    const handleProcessFile = async () => {
      console.log("NumberOfEventsComponent: Processing file for selectedFile:", selectedFile);
      
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

// Component map for easy lookup
export const componentMap: Record<string, React.FC<ComponentProps>> = {
  TextBoxComponent,
  NumberOfEventsComponent,
  // Add more as needed, e.g., ChartComponent: ChartComponent,
};