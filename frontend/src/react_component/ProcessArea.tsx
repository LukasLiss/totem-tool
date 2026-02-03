import { useCallback, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  RefreshCcw,
  ScanIcon,
  ZoomOut,
  ZoomIn,
} from 'lucide-react';
import ProcessAreaVisualizer, { type ProcessAreaVisualizerControls } from './ProcessAreaVisualizer';

export type { ProcessAreaVisualizerControls } from './ProcessAreaVisualizer';

export type ProcessAreaProps = {
  fileId?: number | string | null;
  embedded?: boolean;
  backendBaseUrl?: string;
  height?: string | number;
};

export default function ProcessArea({
  fileId,
  embedded = false,
  backendBaseUrl = 'http://localhost:8000',
  height = 600,
}: ProcessAreaProps) {
  const [visualizerControls, setVisualizerControls] = useState<ProcessAreaVisualizerControls | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);

  const handleControlsReady = useCallback((controls: ProcessAreaVisualizerControls) => {
    setVisualizerControls(controls);
  }, []);

  const handleReload = useCallback(() => {
    setReloadSignal((prev) => prev + 1);
  }, []);

  const heightStyle = typeof height === 'number' ? `${height}px` : height;
  const fillContainer = height === "100%";

  const visualizerContent = (
    <ReactFlowProvider>
      <ProcessAreaVisualizer
        eventLogId={fileId}
        height="100%"
        backendBaseUrl={backendBaseUrl}
        reloadSignal={reloadSignal}
        title="Process Area Visualizer"
        embedded={true}
        onControlsReady={handleControlsReady}
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
        <CardTitle>Process Area Visualizer</CardTitle>
        <CardAction className="flex items-center gap-2">
          {visualizerControls && (
            <>
              <div className="flex items-center gap-2">
                <ZoomOut className="h-4 w-4 text-muted-foreground" />
                <Slider
                  min={visualizerControls.minScale}
                  max={visualizerControls.maxScale}
                  step={visualizerControls.scaleStep}
                  value={[visualizerControls.processAreaScale]}
                  onValueChange={(values) =>
                    visualizerControls.onProcessAreaScaleChange(values?.[0] ?? visualizerControls.minScale)
                  }
                  className="w-[120px]"
                />
                <ZoomIn className="h-4 w-4 text-muted-foreground" />
              </div>
              <Button
                type="button"
                variant={visualizerControls.autoZoomEnabled ? 'secondary' : 'outline'}
                size="icon"
                onClick={visualizerControls.onAutoZoomToggle}
                className="rounded-full h-8 w-8"
                title={visualizerControls.autoZoomEnabled ? 'Disable auto-zoom (enables panning)' : 'Enable auto-zoom'}
              >
                <ScanIcon className="h-4 w-4" />
              </Button>
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
    </Card>
  );
}
