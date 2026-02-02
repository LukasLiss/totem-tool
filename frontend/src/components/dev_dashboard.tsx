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
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { processFile } from "@/api/fileApi";
import OCDFGVisualizer from "@/react_component/OCDFGVisualizer";
import VariantsExplorer from "@/react_component/VariantsExplorer";
import ProcessArea from "@/react_component/ProcessArea";

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
        const result = await processFile(token ?? "", selectedFile.id);
        setProcessedResult(result);
      } catch (err) {
        console.error("Failed to process file:", err);
      }
    };

    handleProcessFile();
  }, [selectedFile]);

  return (
    <div>
      <SidebarTrigger/>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <ProcessArea fileId={selectedFile?.id} />
        <div className="grid auto-rows-min gap-4 *:data-[slot=card]:bg-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:shadow-xs">
          <Card className="@container/card max-w-sm">
            <CardHeader>
              <CardDescription>Number of Events</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {processedResult ?? "—"}
              </CardTitle>
              <CardAction>

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
          {/*
          <div className="relative h-[640px] overflow-hidden rounded-xl border bg-card shadow-sm">
            <ReactFlowProvider>
              <OCDFGVisualizer height="100%" fileId={selectedFile?.id} />
            </ReactFlowProvider>
          </div>
          */}
        </div>
        <Card className="@container/card">
          <CardHeader className="items-center relative z-10 justify-between">
            <CardTitle>
              Variants Explorer
            </CardTitle>
            <CardDescription>
              Object-centric variant analysis
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-0">
            <VariantsExplorer
              fileId={selectedFile?.id}
              colWidth={120}
              embedded={true}
            />
          </CardContent>
        </Card>
        <div className="bg-muted/50 min-h-[100vh] flex-1 rounded-xl md:min-h-min" />
      </div>
    </div>
  )
}

export default DevDashboard;
