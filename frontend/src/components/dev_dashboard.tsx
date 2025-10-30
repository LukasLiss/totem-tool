import React, { useContext, useEffect, useState } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Badge } from "./ui/badge";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { processFile } from "@/api/fileApi";
import { ReactFlowProvider } from "@xyflow/react";
import OCDFGVisualizer from "@/react_component/OCDFGVisualizer";
import TotemVisualizer from "@/react_component/TotemVisualizer";

export function DevDashboard() {
  const [processedResult, setProcessedResult] = useState(null);

  const { selectedFile } = useContext(SelectedFileContext);
  useEffect(() => {
    const handleProcessFile = async () => {
      if (!selectedFile?.id) {
        setProcessedResult(null);
        return;
      }

      const token = localStorage.getItem("access_token");

      try {
        const result = await processFile(token, selectedFile.id);
        setProcessedResult(result);
      } catch (err) {
        console.error("Failed to process file:", err);
      }
    };

    handleProcessFile();
  }, [selectedFile]);
  return (
    <div>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <Card className="@container/card">
          <CardHeader>
            <CardTitle>Totem Visualizer</CardTitle>
            <CardDescription>
              Explore temporal relations between object types discovered from the selected event log.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[600px] p-0">
            <ReactFlowProvider>
              <TotemVisualizer eventLogId={selectedFile?.id} height="100%" backendBaseUrl="http://localhost:8000" />
            </ReactFlowProvider>
          </CardContent>
        </Card>
        <div className="grid auto-rows-min gap-4 *:data-[slot=card]:bg-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:shadow-xs">
          <Card className="@container/card max-w-sm">
            <CardHeader>
              <CardDescription>Number of Events</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {processedResult ?? "—"}
              </CardTitle>
              <CardAction>
                <Badge variant="outline">
                  +12.5%
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                Trending up this month 
              </div>
              <div className="text-muted-foreground">
                Visitors for the last 6 months
              </div>
            </CardFooter>
          </Card>
          <Card className="@container/card">
            <CardHeader>
              <CardTitle>Object-Centric DFG</CardTitle>
              <CardDescription>
                Interactive visualization of the discovered object-centric DFG.
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[560px] p-0">
              <ReactFlowProvider>
                <OCDFGVisualizer height="100%" />
              </ReactFlowProvider>
            </CardContent>
          </Card>
        </div>
        <div className="bg-muted/50 min-h-[100vh] flex-1 rounded-xl md:min-h-min" />
      </div>
    </div>
  )
}

export default DevDashboard;
