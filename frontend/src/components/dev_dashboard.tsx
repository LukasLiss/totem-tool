import React, { useCallback, useContext, useEffect, useState } from "react";
import { RefreshCcw, ScanIcon, FlaskConicalIcon, BrainIcon, ZoomOut, ZoomIn } from "lucide-react";
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
import { Slider } from "./ui/slider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { processFile } from "@/api/fileApi";
import { ReactFlowProvider } from "@xyflow/react";
import OCDFGVisualizer from "@/react_component/OCDFGVisualizer";
import VariantsExplorer from "@/react_component/VariantsExplorer";
import TotemVisualizer, { type TotemVisualizerControls } from "@/react_component/TotemVisualizer";

export function DevDashboard() {
  const [processedResult, setProcessedResult] = useState(null);
  const [totemReloadSignal, setTotemReloadSignal] = useState(0);
  const [totemControls, setTotemControls] = useState<TotemVisualizerControls | null>(null);

  const { selectedFile } = useContext(SelectedFileContext);

  const handleTotemControlsReady = useCallback((controls: TotemVisualizerControls) => {
    setTotemControls(controls);
  }, []);

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
        <Card className="@container/card">
          <CardHeader className="items-center relative z-10 justify-between">
            <CardTitle>
              Totem Visualizer
            </CardTitle>
            <CardAction className="flex items-center gap-2">
              {totemControls && (
                <>
                  <div className="flex items-center gap-2">
                    <ZoomOut className="h-4 w-4 text-muted-foreground" />
                    <Slider
                      min={totemControls.minScale}
                      max={totemControls.maxScale}
                      step={totemControls.scaleStep}
                      value={[totemControls.processAreaScale]}
                      onValueChange={(values) => totemControls.onProcessAreaScaleChange(values?.[0] ?? totemControls.minScale)}
                      className="w-[120px]"
                    />
                    <ZoomIn className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Button
                    type="button"
                    variant={totemControls.autoZoomEnabled ? 'secondary' : 'outline'}
                    size="icon"
                    onClick={totemControls.onAutoZoomToggle}
                    className="rounded-full h-8 w-8"
                    title={totemControls.autoZoomEnabled ? 'Disable auto-zoom (enables panning)' : 'Enable auto-zoom'}
                  >
                    <ScanIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant={totemControls.useMockData ? 'secondary' : 'outline'}
                    size="icon"
                    onClick={totemControls.onUseMockDataToggle}
                    className="rounded-full h-8 w-8"
                    title={totemControls.useMockData ? 'Use backend data' : 'Use mock data'}
                  >
                    <FlaskConicalIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant={totemControls.useBackendMlpa ? 'secondary' : 'outline'}
                    size="icon"
                    onClick={totemControls.onUseBackendMlpaToggle}
                    className="rounded-full h-8 w-8"
                    title={totemControls.useBackendMlpa ? 'Using backend MLPA (ILP)' : 'Using frontend MLPA (greedy)'}
                  >
                    <BrainIcon className="h-4 w-4" />
                  </Button>
                  <div className="w-px h-6 bg-border" />
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTotemReloadSignal((value) => value + 1)}
                disabled={!selectedFile?.id}
                className="flex items-center gap-2"
              >
                <RefreshCcw className="h-4 w-4" />
                Reload
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="h-[600px] p-0">
            <ReactFlowProvider>
              <TotemVisualizer
                eventLogId={selectedFile?.id}
                height="100%"
                backendBaseUrl="http://localhost:8000"
                reloadSignal={totemReloadSignal}
                title="Totem Visualizer"
                embedded={true}
                onControlsReady={handleTotemControlsReady}
              />
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
