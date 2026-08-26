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
import { RefreshCcw } from 'lucide-react';
import { GlobalFilterToggle } from '@/components/ui/GlobalFilterToggle';
import TotemVisualizer, { type TotemVisualizerControls } from './TotemVisualizer';

export type { TotemVisualizerControls } from './TotemVisualizer';

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
  const [totemControls, setTotemControls] = useState<TotemVisualizerControls | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [filterEnabled, setFilterEnabled] = useState(false);

  const handleControlsReady = useCallback((controls: TotemVisualizerControls) => {
    setTotemControls(controls);
  }, []);

  const handleReload = useCallback(() => {
    setReloadSignal((prev) => prev + 1);
  }, []);

  const heightStyle = typeof height === 'number' ? `${height}px` : height;
  const fillContainer = height === "100%";

  const visualizerContent = (
    <ReactFlowProvider>
      <TotemVisualizer
        eventLogId={fileId}
        height="100%"
        backendBaseUrl={backendBaseUrl}
        reloadSignal={reloadSignal}
        title="Totem Visualizer"
        embedded={true}
        onControlsReady={handleControlsReady}
        filterEnabled={filterEnabled}
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
        <div className="flex items-center gap-2">
          <CardTitle>Process Area Visualizer</CardTitle>
          <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={() => setFilterEnabled(prev => !prev)} />
        </div>
        <CardAction className="flex items-center gap-2">
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
